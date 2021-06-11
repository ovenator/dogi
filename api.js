const path = require('path');
const crypto = require('crypto');
const fsp = require('fs').promises;
const fs = require('fs');
const {nanoid} = require('nanoid');
const debug = require('debug');

var Docker = require('dockerode');
var docker = new Docker({socketPath: '/var/run/docker.sock'});

const simpleGit = require('simple-git');
const git = simpleGit();


exports.build = async ({sshUrl, instanceId, dockerfile: _dockerfile, output}) => {
    const dockerfile = _dockerfile || 'Dockerfile';
    const instanceDir = path.join(__dirname, 'instances', instanceId);
    await git.clone(sshUrl, instanceDir);
    let buildFiles = await fsp.readdir(instanceDir);
    const buildStream = await docker.buildImage({
        context: instanceDir,
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

async function acquireLock({instanceId}) {
    const instanceLock = path.join(__dirname, 'locks', `${instanceId}.lock`);
    const myId = nanoid();
    try {
        await fsp.readFile(instanceLock);
    } catch (e) {
        if(e.code === 'ENOENT') {
            await fsp.writeFile(instanceLock, myId);
        }
    }

    const lock = await fsp.readFile(instanceLock);
    return lock.toString() === myId;
}

async function releaseLock({instanceId}) {
    const instanceLock = path.join(__dirname, 'locks', `${instanceId}.lock`);
    try {
        await fsp.unlink(instanceLock);
    } catch (e) {
        if(e.code !== 'ENOENT') {
            throw e;
        }
    }
}

const pending = {};

exports.lifecycle = async ({sshUrl, dockerfile}) => {
    const instanceId = sha1(sshUrl);
    const instanceDir = path.join(__dirname, 'instances', instanceId);
    const buildLogFilename = path.join(instanceDir, 'dogi.build.log');
    const runLogFilename = path.join(instanceDir, 'dogi.run.log');

    const result = {
        buildLogFilename,
        runLogFilename
    }

    const hasLock = await acquireLock({instanceId});
    if(!hasLock) {
        return {
            ...result,
            started: false
        }
    }

    await fsp.writeFile(buildLogFilename, '');
    await fsp.writeFile(runLogFilename, '');

    try {
        const buildLog = fs.createWriteStream(buildLogFilename);
        await exports.build({sshUrl, dockerfile, instanceId, output: buildLog});

        const runLog = fs.createWriteStream(runLogFilename);
        const {result, container} = await exports.run({instanceId, output: runLog});
        const {StatusCode} = result;
        await container.remove({force: true});

        if(StatusCode !== 0) {
            throw new Error('Execution failed with code', StatusCode);
        }
    } finally {
        await releaseLock({instanceId});
    }

    return {
        ...result,
        started: true
    }

}