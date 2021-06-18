const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const debug = require('debug');

var Docker = require('dockerode');
var docker = new Docker({socketPath: '/var/run/docker.sock'});

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

exports.run = async ({instanceId, mount, cmd, bashc, output}) => {
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

const pending = {};

exports.getRunningJobs = () => pending;

exports.lifecycle = async ({sshUrl, dockerfile, action, file, cmd, bashc}) => {
    const instanceId = sha1(sshUrl);
    const instanceDir = getInternalSharedDir(instanceId);
    const logFilename = path.join(instanceDir, 'dogi.log');
    const outputFilenameExternal = path.join(getExternalSharedDir(instanceId), 'dogi.file.log');
    const outputFilenameInternal = path.join(instanceDir, 'dogi.file.log');

    const result = {
        output: {
            log: logFilename,
            file: outputFilenameInternal
        }
    }

    if(action === 'peek') {
        return {
            ...result,
            delayed: (pending[instanceId] && pending[instanceId].delayed) || null
        };
    }

    const pendingInstance = pending[instanceId];

    if(pendingInstance) {
        return {
            ...result,
            delayed: pendingInstance.delayed
        }
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

    const jobData = {url: sshUrl, started: Date.now()}

    async function build() {
        const buildLog = fs.createWriteStream(logFilename);
        await exports.build({sshUrl, dockerfile, instanceId, output: buildLog});

        const runLog = fs.createWriteStream(logFilename, {flags: 'a'});
        const {result, container} = await exports.run({instanceId, mount, cmd, bashc, output: runLog});
        const {StatusCode} = result;
        await container.remove({force: true});

        if(StatusCode !== 0) {
            throw new Error('Execution failed with code', StatusCode);
        }
    }

    const {delayed} = pending[instanceId] = {delayed: build(), jobData};
    delayed
        .catch(e => {
            console.error(e);
        })
        .finally(() => {
            delete pending[instanceId];
        })

    return {
        ...result,
        started: true,
        delayed
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