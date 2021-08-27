const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const debug = require('debug')('dogi:app:api');
const glob = require("glob");

const docker = require('./docker')
const {openPromise, toInstanceId, validateFilename, getNamespace} = require('./util');

const simpleGit = require('simple-git');
const git = simpleGit();

const {processCallback} = require("./callbacks");
const {createOutputs} = require('./outputs');
const {getInternalSharedDir} = require('./common');

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




/**
 * @typedef {Object} ContainerParams
 * @property {string} cmd
 * @property {string} bashc
 * @property {string} env
 * */

exports.lifecycle = async ({url, urlProto, explicitId, dockerfile, action, cmd, env, bashc, callbackUrl, containerFiles: containerFilesById, outputId}) => {

    let urlWithProto = url;

    if (urlProto !== 'ssh') {
        urlWithProto = `${urlProto}://${url}`;
    }

    if (outputId) {
        validateFilename(outputId);
    }

    let instanceId = toInstanceId({repoName: urlWithProto, explicitId});

    /** @type {DogiInstance} */
    const currentInstance = instancesById[instanceId];
    const instance = currentInstance;

    if(!currentInstance) {
        debug('no instance');
    }

    if (action === 'restart') {
        if (instance) {
            /*
                We want to keep only the most recent restart, because restart is the only way user can change call params,
                if this 'lock' would not be where, it would not be clear which restart won and the instance could have unexpected params
            */
            if(instance.pendingRestart) {
                instance.pendingRestart.reject('Killed by subsequent restart');
            }

            instance.pendingRestart = openPromise()

            await Promise.race([instance.abort(), instance.pendingRestart]);
        }
    }

    if (action === 'abort') {
        if (instance) {
            if(instance.pendingRestart) {
                instance.pendingRestart.reject('Killed by abort');
            }
            await instance.abort();
        }

        throw new Error('[abort] Instance not found');
    }

    const instanceDir = getInternalSharedDir(instanceId);

    if (action === 'peek') {
        const outputFilename = path.join(instanceDir, `dogi.out.${outputId}`);
        await fsp.access(outputFilename);

        /** @type {Outputs} */
        const outputs =  {
            outputFilesById: {
                [outputId]: outputFilename,
            }
        };

        return {outputs}
    }

    return withoutInstance();

    async function withoutInstance() {

        await fsp.rmdir(instanceDir, {recursive: true});
        await fsp.mkdir(instanceDir, {recursive: true});
        const outputs = await createOutputs(instanceId, containerFilesById);

        /**
         * @typedef {Object} DogiInstance
         * @property {string} instanceId - dogi_{namespace}_{repoHash}_{explicitIdHash} used for container, image and file naming
         * @property {string} explicitId - user provided id
         * @property {date} started
         * @property {Promise.<any>} pendingRestart - this is never resolved, only rejected for subsequent restarts
         *                                            to ensure that only the most recent restart wins
         *                                            the idea is, that on successful restart instance object will be recreated
         *                                            and this set back to null
         * @property {Promise.<any>} runHandleCreated - resolved when container is started
         * @property {Promise.<any>} instanceFinished - resolved when instance is finished no matter if successful
         * @property {Promise.<any>} delayed - resolved when instance is finished, throws if error occurs
         * @property {boolean} isBeingDestroyed - set when abort is called
         * @property {Outputs} outputs
         * @property {CallbackResult} cb
         * @property {Object} env
         * @property {Function} abort - abort the instance by force removing the container
         * */

        /** @type {DogiInstance} */
        const newInstance = instancesById[instanceId] = {
            instanceId,
            explicitId,
            started: Date.now(),
            url: urlWithProto,
            runHandleCreated: openPromise(),
            instanceFinished: openPromise(),
            isBeingDestroyed: false,
            delayed: null,
            outputs,
            env
        };

        newInstance.abort = async function() {
            if (newInstance.isBeingDestroyed) {
                return this.instanceFinished;
            }
            newInstance.isBeingDestroyed = true;
            const runHandle = await this.runHandleCreated
            await runHandle.abort();
            await this.instanceFinished;
        }

        async function buildAndRun() {
            const logFilename = newInstance.outputs.outputFilesById['log'];
            const buildLog = fs.createWriteStream(logFilename);
            await exports.build({sshUrl: urlWithProto, dockerfile, instanceId, output: buildLog});

            const runLog = fs.createWriteStream(logFilename, {flags: 'a'});

            const runHandle = await exports.run({instanceId, mounts: newInstance.outputs.mounts, cmd, bashc, env, output: runLog});

            newInstance.runHandleCreated.resolve(runHandle);
            const result = await runHandle.containerFinished;
            const {StatusCode} = result;

            if(StatusCode !== 0) {
                throw new Error(`Execution failed with code ${StatusCode}`);
            }

            if (callbackUrl) {
                const result = await processCallback(newInstance, callbackUrl);
                newInstance.cb = result;
                const {response: {status}} = result;
                const isSuccess = status >= 200 && status < 300;
                if (!isSuccess) {
                    throw new Error('Callback failed')
                }
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

exports.collectOutputs = async ({output, stream}) => {
    validateFilename(output);
    const baseDir = getInternalSharedDir();
    const files = await new Promise((res, rej) => {
        glob(path.join(baseDir, `dogi_${getNamespace()}_*/dogi.out.${output}`), (err, files) => {
            if (err) {
                return rej(err);
            }
            res(files);
        })
    })

    for (const fn of files) {
        await new Promise((res, rej) => {
            const rs = fs.createReadStream(fn);
            rs.pipe(stream, {end: false})
            rs.on('error', (e) => rej(e));
            rs.on('end', () => res());
        })
        stream.write('\n');
    }

    stream.end();
}

