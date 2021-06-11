const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const {nanoid} = require('nanoid');
const debug = require('debug');

var Docker = require('dockerode');
var docker = new Docker({socketPath: '/var/run/docker.sock'});

const simpleGit = require('simple-git');
const git = simpleGit();


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

exports.run = async ({instanceId, output}) => {
    const resultTuple = await docker.run(instanceId, null, output);
    const [result, container] = resultTuple;
    return {result, container};
}

function sha1(str) {
    const shasum = crypto.createHash('sha1');
    shasum.update(str);
    return shasum.digest('hex');
}

const pending = {};

exports.lifecycle = async ({sshUrl, dockerfile, action}) => {
    const instanceId = sha1(sshUrl);
    const instanceDir = path.join(__dirname, 'instances', instanceId);
    const buildLogFilename = path.join(instanceDir, 'dogi.build.log');
    const runLogFilename = path.join(instanceDir, 'dogi.run.log');

    const result = {
        buildLogFilename,
        runLogFilename
    }

    const pendingInstance = pending[instanceId];

    if(pendingInstance) {
        return {
            ...result,
            started: false,
            delayed: pendingInstance
        }
    }

    await fsp.rmdir(instanceDir, {recursive: true});
    await fsp.mkdir(instanceDir, {recursive: true});
    await fsp.writeFile(buildLogFilename, '');
    await fsp.writeFile(runLogFilename, '');

    async function build() {
        const buildLog = fs.createWriteStream(buildLogFilename);
        await exports.build({sshUrl, dockerfile, instanceId, output: buildLog});

        const runLog = fs.createWriteStream(runLogFilename);
        const {result, container} = await exports.run({instanceId, output: runLog});
        const {StatusCode} = result;
        await container.remove({force: true});

        if(StatusCode !== 0) {
            throw new Error('Execution failed with code', StatusCode);
        }
    }

    const delayed = pending[instanceId] = build();
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