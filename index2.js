var Docker = require('dockerode');
var docker = new Docker({socketPath: '/var/run/docker.sock'});
const path = require('path');
const fsp = require('fs').promises;
const fs = require('fs');
const simpleGit = require('simple-git');
const git = simpleGit();
const crypto = require('crypto');
const debug = require('debug');
debug.enable('simple-git,simple-git:*');

function sha1(str) {
    const shasum = crypto.createHash('sha1');
    shasum.update(str);
    return shasum.digest('hex');
}


const express = require('express')
const app = express()
const port = 3001

app.get('/ssh/:url(*)', async (req, res) => {
    const {url:sshUrl} = req.params;
    const {df, iid} = req.query;
    const dockerfile = df || 'Dockerfile.build';

    const idParts = [sha1(sshUrl), iid].filter(part => !!part);
    const instanceId = idParts.join('@');

    const instanceDirAccess = await fsp.stat(path.join(__dirname, instanceId))
    await fsp.rmdir(instanceId, {recursive: true});

    const cloneResult = await git.clone(sshUrl, instanceId);
    let buildFiles = await fsp.readdir(instanceId);
    const buildStream = await docker.buildImage({
        context: path.join(__dirname, instanceId),
        src: buildFiles
    }, {t: instanceId, dockerfile});

    const buildLogFilename = path.join(__dirname, instanceId, 'dogi.build.log')
    const buildLog = fs.createWriteStream(buildLogFilename);
    buildStream.pipe(buildLog);

    res.setHeader("Content-Type", "text/plain");
    fs.createReadStream(buildLogFilename).pipe(res);

    await new Promise((resolve, reject) => {
        docker.modem.followProgress(buildStream, (err, res) => err ? reject(err) : resolve(res));

    });

    const runLog = fs.createWriteStream(path.join(__dirname, instanceId, 'dogi.run.log'));
    const r = await docker.run(instanceId, null, runLog);
    const [output, container] = r;

    console.log(output.StatusCode);
    await container.remove({force: true});

    res.end();
})

app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`)
})

exports.lifecycle = async () => {

}

exports.build = async ({sshUrl, instanceId, dockerfile: _dockerfile, output}) => {
    const dockerfile = _dockerfile || 'Dockerfile';
    await git.clone(sshUrl, instanceId);
    let buildFiles = await fsp.readdir(instanceId);
    const buildStream = await docker.buildImage({
        context: path.join(__dirname, instanceId),
        src: buildFiles
    }, {t: instanceId, dockerfile});

    const buildLogFilename = path.join(__dirname, instanceId, 'dogi.build.log')
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

exports.instanceLifecycle = async ({instanceId, output}) => {
    const {container} = await exports.run({instanceId, output})
    await await container.remove({force: true});
}


async function run({sshUrl, dockerfile}) {
    const hash = sha1(sshUrl);
    await fsp.rmdir(hash, {recursive: true});

    const cloneResult = await git.clone(sshUrl, hash);
    let buildFiles = await fsp.readdir(hash);
    const buildStream = await docker.buildImage({
        context: path.join(__dirname, hash),
        src: buildFiles
    }, {t: hash, dockerfile: dockerfile});

    const buildLog = fs.createWriteStream(path.join(__dirname, hash, 'dogi.build.log'));
    buildStream.pipe(buildLog);
    await new Promise((resolve, reject) => {
        docker.modem.followProgress(buildStream, (err, res) => err ? reject(err) : resolve(res));
    });

    const runLog = fs.createWriteStream(path.join(__dirname, hash, 'dogi.run.log'));
    const r = await docker.run(hash, null, runLog);
    const [output, container] = r;

    console.log(output.StatusCode);
    await container.remove({force: true});
}


async function main() {
    await run({sshUrl: 'git@github.com:docker-library/hello-world.git', dockerfile: 'Dockerfile.build'});
}

// main()
//     .then(res => console.log('Finished with', res))
//     .catch(res => console.error('Failed with', res))
//
