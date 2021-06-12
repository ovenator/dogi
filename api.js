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
    const instanceRepoDir = path.join(__dirname, 'instances', instanceId, 'repo');
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

exports.run = async ({instanceId, mount, cmd, output}) => {
    let _cmd = null;
    if (cmd) {
        _cmd = ['bash', '-c', cmd];
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

exports.lifecycle = async ({sshUrl, dockerfile, action, file, cmd}) => {
    const instanceId = sha1(sshUrl);
    const instanceDir = path.join(__dirname, 'instances', instanceId);
    const buildLogFilename = path.join(instanceDir, 'dogi.build.log');
    const runLogFilename = path.join(instanceDir, 'dogi.run.log');
    const outputFilename = path.join(instanceDir, 'dogi.file.log');

    const result = {
        output: {
            buildLog: buildLogFilename,
            runLog: runLogFilename,
            file: outputFilename
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

    await fsp.writeFile(buildLogFilename, '');
    await fsp.writeFile(runLogFilename, '');
    await fsp.writeFile(outputFilename, '');

    let mount = null;

    if(file) {
        mount = {
            container: file,
            host: outputFilename
        }
    }

    async function build() {
        const buildLog = fs.createWriteStream(buildLogFilename);
        await exports.build({sshUrl, dockerfile, instanceId, output: buildLog});

        const runLog = fs.createWriteStream(runLogFilename);
        const {result, container} = await exports.run({instanceId, mount, cmd, output: runLog});
        const {StatusCode} = result;
        await container.remove({force: true});

        if(StatusCode !== 0) {
            throw new Error('Execution failed with code', StatusCode);
        }
    }

    const {delayed} = pending[instanceId] = {delayed: build()};
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