const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const debug = require('debug')('dogi:app:api');
const axios = require('axios');
const {forEach} = require('lodash')

const docker = require('./docker')
const {openPromise, toInstanceId, validateFilename} = require('./util');

const simpleGit = require('simple-git');
const git = simpleGit();


exports.build = async ({sshUrl, instanceId, dockerfile: _dockerfile, output}) => {
    const dockerfile = _dockerfile || 'Dockerfile';
    const instanceRepoDir = path.join(getInternalSharedDir(instanceId), 'repo');
    await git.clone(sshUrl, instanceRepoDir);
    let buildFiles = await fsp.readdir(instanceRepoDir);
    const buildStream = await docker.buildImage({
        context: instanceRepoDir,
        src: buildFiles
    }, {t: instanceId, dockerfile});

    buildStream.pipe(output);

    await new Promise((resolve, reject) => {
        docker.modem.followProgress(buildStream, (err, res) => err ? reject(err) : resolve(res));
    });
}


exports.run = async function({instanceId, bashc, cmd, mounts, env, output}) {

    const image = instanceId;

    let _cmd = null;

    if (cmd) {
        _cmd = cmd
    } else if (bashc) {
        _cmd = ['bash', '-c', bashc];
    }

    const envArr = [];
    if (env) {
        for (const kv of Object.entries(env)) {
            envArr.push(kv.join('='));
        }
    }

    let createOptions = {
        'name': instanceId,
        'Hostname': '',
        'User': '',
        'AttachStdin': false,
        'AttachStdout': true,
        'AttachStderr': true,
        'Tty': true,
        'OpenStdin': false,
        'StdinOnce': false,
        'Env': envArr,
        'Cmd': _cmd,
        'Image': image,
        'Volumes': {},
        'VolumesFrom': []
    };

    if (mounts) {
        const HostConfig = {
            Binds: mounts.map((mount) => `${mount.host}:${mount.container}`)
        };

        createOptions = {
            ...createOptions,
            HostConfig
        }
    }

    const containerCreated = openPromise();
    const containerFinished = openPromise();

    async function abort() {
        const container = await containerCreated;
        await silentKill(container);
    }

    async function start() {
        //cleanup possible dangling container from previous runs
        await silentKillByName(instanceId);

        const container = await docker.createContainer(createOptions);
        containerCreated.resolve(container);

        try {
            const stream = await container.attach({
                stream: true,
                stdout: true,
                stderr: true
            });

            stream.setEncoding('utf8');
            stream.pipe(output, {
                end: true
            });

            await container.start({});

            const result = await container.wait();
            containerFinished.resolve(result);

            return {result, container};
        } catch (e) {
            e.status = 500;
            throw e;
        } finally {
            await silentKill(container)
        }

    }

    start()
        .catch((e) => {
            containerCreated.reject(e);
            containerFinished.reject(e);
        });

    return {containerCreated, containerFinished, abort}

};

const instancesById = {};

exports.getRunningJobs = () => instancesById;

async function silentKill(container) {
    try {
        await container.remove({force: true});
    } catch (e) {
        debug('silently failed to remove container', e);
    }
}

async function silentKillByName(containerName) {
    let container = docker.getContainer(containerName);
    await silentKill(container);
}

exports.lifecycle = async ({url, urlProto, instanceDuplicateId, dockerfile, action, cmd, env, bashc, callbackUrl, containerFiles, outputId}) => {

    let urlWithProto = url;

    if (urlProto !== 'ssh') {
        urlWithProto = `${urlProto}://${url}`;
    }

    if (outputId) {
        validateFilename(outputId);
    }

    let instanceId = toInstanceId({repoName: urlWithProto, customId: instanceDuplicateId});

    const currentInstance = instancesById[instanceId];

    if(currentInstance) {
        debug('calling withInstance with instance, env', currentInstance, env);
        return withInstance(currentInstance);
    }

    debug('calling without instance with env', env)
    return withoutInstance();

    async function withInstance(instance) {

        if (action === 'restart') {
            /*
             We want to keep only the most recent restart, because restart is the only way user can change call params
             */
            if(instance.pendingRestart) {
                instance.pendingRestart.reject('Killed by subsequent restart');
            }

            instance.pendingRestart = openPromise()

            await Promise.race([instance.abort(), instance.pendingRestart]);
            return withoutInstance();
        }

        if (action === 'abort') {
            if(instance.pendingRestart) {
                instance.pendingRestart.reject('Killed by abort');
            }
            await instance.abort();
        }

        return instance;
    }

    async function withoutInstance() {
        const instanceDir = getInternalSharedDir(instanceId);
        const logFilename = path.join(instanceDir, 'dogi.out.log');

        const fileObjects = [];
        forEach(containerFiles, (containerPath, fileId) => {
            const tmpFileName = `dogi.out.${fileId}`
            fileObjects.push({
                id: fileId,
                containerPath: containerPath,
                outputFilenameExternal: path.join(getExternalSharedDir(instanceId), tmpFileName),
                outputFilenameInternal: path.join(instanceDir, tmpFileName)
            });
        })

        if (action === 'peek') {
            const outputFilename = path.join(instanceDir, `dogi.out.${outputId}`);
            await fsp.access(outputFilename);

            const output =  {
                [outputId]: outputFilename,
            };

            return {output}
        }

        if (action === 'abort') {
            throw new Error(`[abort] No existing jobs for ${urlWithProto}`);
        }

        const newInstance = instancesById[instanceId] = {
            instanceId,
            started: Date.now(),
            url: urlWithProto,
            runHandleCreated: openPromise(),
            instanceFinished: openPromise(),
            delayed: null,
            files: fileObjects,
            output: {
                log: logFilename
            }
        };

        newInstance.fileUrls = fileObjsToFileUrls({instanceId, files: fileObjects});

        newInstance.abort = async function() {
            if (newInstance.isBeingDestroyed) {
                return this.instanceFinished;
            }
            newInstance.isBeingDestroyed = true;
            const runHandle = await this.runHandleCreated
            await runHandle.abort();
            await this.instanceFinished;
        }


        await fsp.rmdir(instanceDir, {recursive: true});
        await fsp.mkdir(instanceDir, {recursive: true});

        let mounts = [];

        for (const fileObj of fileObjects) {
            const {outputFilenameInternal, outputFilenameExternal, id, containerPath} = fileObj;
            newInstance.output[id] = outputFilenameInternal;

            await fsp.writeFile(outputFilenameInternal, '');

            mounts.push({
                container: containerPath,
                host: outputFilenameExternal
            })
        }

        await fsp.writeFile(logFilename, '');


        async function buildAndRun() {
            const buildLog = fs.createWriteStream(logFilename);
            await exports.build({sshUrl: urlWithProto, dockerfile, instanceId, output: buildLog});

            const runLog = fs.createWriteStream(logFilename, {flags: 'a'});

            const runHandle = await exports.run({instanceId, mounts, cmd, bashc, env, output: runLog});

            newInstance.runHandleCreated.resolve(runHandle);
            const result = await runHandle.containerFinished;
            const {StatusCode} = result;

            if(StatusCode !== 0) {
                throw new Error(`Execution failed with code ${StatusCode}`);
            }

            if (callbackUrl) {
                await axios.post(callbackUrl, {
                    env,
                    output: newInstance.fileUrls
                });
            }

        }

        const delayed = buildAndRun();

        newInstance.delayed = delayed;

        delayed
            .catch(e => {
                console.error(e);
            })
            .finally(() => {
                delete instancesById[instanceId];
                newInstance.instanceFinished.resolve();
            })

        return newInstance;
    }
}

function fileObjsToFileUrls({instanceId, files}) {

    const advertisedUrl = process.env['ADVERTISED_URL'] || '';

    const output = {
        log:  `${advertisedUrl}/output/${instanceId}/log`
    }

    files.forEach(fileObj => {
        const {id} = fileObj;
        output[id] = `${advertisedUrl}/output/${instanceId}/${id}`;
    })

    return output;
}

//this necessary workaround until https://github.com/moby/moby/issues/32582 is implemented
const internalSharedDir = '/tmp/dogi-shared/instances';
fs.mkdirSync(internalSharedDir, {recursive: true});
exports.getInternalSharedDir = getInternalSharedDir;
function getInternalSharedDir(instanceId) {
    validateFilename(instanceId);
    return path.join(internalSharedDir, instanceId)
}

const externalSharedDir = path.join(process.env['HOST_SHARED_DIR'] || '/tmp', 'dogi-shared/instances');
function getExternalSharedDir(instanceId) {
    validateFilename(instanceId);
    return path.join(externalSharedDir, instanceId);
}