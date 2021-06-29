const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const debug = require('debug');

const docker = require('./docker')

const simpleGit = require('simple-git');
const git = simpleGit();

const {sha1} = require('./crypto');


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

exports.runOld = async ({instanceId, mount, cmd, bashc, output}) => {
    let _cmd = null;
    if (bashc) {
        _cmd = ['bash', '-c', bashc];
    }
    let _createOptions = null;

    if (mount) {
        _createOptions = {
            HostConfig: {
                Binds: [
                    `${mount.host}:${mount.container}`
                ]
            }
        }
    }

    const resultTuple = await docker.run(instanceId, _cmd, output, _createOptions);
    const [result, container] = resultTuple;
    return {result, container};
}

exports.run = async function({instanceId, bashc, mount, output}) {

    const image = instanceId;

    let cmd = null;

    if (bashc) {
        cmd = ['bash', '-c', bashc];
    }

    let createOptions = {
        'Hostname': '',
        'User': '',
        'AttachStdin': false,
        'AttachStdout': true,
        'AttachStderr': true,
        'Tty': true,
        'OpenStdin': false,
        'StdinOnce': false,
        'Env': null,
        'Cmd': cmd,
        'Image': image,
        'Volumes': {},
        'VolumesFrom': []
    };

    if (mount) {
        const HostConfig = {
            Binds: [
                `${mount.host}:${mount.container}`
            ]
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
        await container.remove({force: true});
    }

    async function start() {
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
            throw e;
        } finally {
            await container.remove({force: true});
        }

    }

    start()
        .catch((e) => {
            containerCreated.reject(e);
            containerFinished.reject(e);
        });

    return {containerCreated, containerFinished, abort}

};

function openPromise() {
    let resolve, reject;
    const p = new Promise((res, rej) => {
        [resolve, reject] = [res, rej];
    })
    p.resolve = resolve;
    p.reject = reject;
    return p;
}

const instancesById = {};

exports.getRunningJobs = () => instancesById;

exports.lifecycle = async ({sshUrl, dockerfile, action, file, cmd, bashc}) => {
    const instanceId = sha1(sshUrl);
    const currentInstance = instancesById[instanceId];

    if(currentInstance) {
        return withInstance(currentInstance);
    }

    return withoutInstance();

    async function withInstance(instance) {

        if (action === 'restart') {
            const {pendingRestart} = instance;
            if (pendingRestart) {
                pendingRestart.reject(new Error('Killed by subsequent restart'));
            }

            instance.pendingRestart = openPromise();

            const pendingRun = await Promise.race([instance.pendingRun, instance.pendingRestart]);
            await pendingRun.abort();
            return withoutInstance();
        }

        if (action === 'abort') {
            const pendingRun = await instance.pendingRun;
            await pendingRun.abort();
        }

        return instance;
    }

    async function withoutInstance() {
        const instanceDir = getInternalSharedDir(instanceId);
        const logFilename = path.join(instanceDir, 'dogi.log');
        const outputFilenameExternal = path.join(getExternalSharedDir(instanceId), 'dogi.file.log');
        const outputFilenameInternal = path.join(instanceDir, 'dogi.file.log');

        if (action === 'peek') {
            fsp.access(logFilename);

            const output =  {
                log: logFilename,
            };

            try {
                fsp.access(outputFilenameInternal);
                output.file = outputFilenameInternal;
            } catch (e) {
                debug('output file', outputFilenameInternal, 'is not available');
            }

            return {output}
        }

        if (action === 'abort') {
            throw new Error(`[abort] No existing jobs for ${sshUrl}`);
        }

        const newInstance = instancesById[instanceId] = {
            instanceId,
            started: Date.now(),
            url: sshUrl,
            pendingRun: openPromise(),
            pendingRestart: null,
            delayed: null,
            output: {
                log: logFilename
            }
        };

        if (file) {
            newInstance.file = file;
            newInstance.output.file = outputFilenameInternal;
        }

        await fsp.rmdir(instanceDir, {recursive: true});
        await fsp.mkdir(instanceDir, {recursive: true});

        await fsp.writeFile(logFilename, '');
        await fsp.writeFile(outputFilenameInternal, '');

        let mount = null;

        if(file) {
            mount = {
                container: file,
                host: outputFilenameExternal
            }
        }

        async function buildAndRun() {
            const buildLog = fs.createWriteStream(logFilename);
            await exports.build({sshUrl, dockerfile, instanceId, output: buildLog});

            const runLog = fs.createWriteStream(logFilename, {flags: 'a'});

            const pendingRun = await exports.run({instanceId, mount, cmd, bashc, output: runLog});

            newInstance.pendingRun.resolve(pendingRun);
            const result = await pendingRun.containerFinished;
            const {StatusCode} = result;

            if(StatusCode !== 0) {
                throw new Error('Execution failed with code', StatusCode);
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
            })

        return newInstance;
    }
}

//this necessary workaround until https://github.com/moby/moby/issues/32582 is implemented
const internalSharedDir = '/tmp/dogi-shared/instances';
fs.mkdirSync(internalSharedDir, {recursive: true});

function getInternalSharedDir(instanceId) {
    return path.join(internalSharedDir, instanceId)
}

const externalSharedDir = path.join(process.env['HOST_SHARED_DIR'] || '/tmp', 'dogi-shared/instances');
function getExternalSharedDir(instanceId) {
    return path.join(externalSharedDir, instanceId);
}