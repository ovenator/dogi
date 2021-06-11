const should = require('should');
const debug = require('debug');
const fs = require('fs');
const fsp = fs.promises;
const ts = require('tail-stream');

debug.enable('simple-git,simple-git:*');

const api = require('../api');


describe('dogi', () => {
    const hour = 60 * 60 * 1000;
    beforeEach(async () => {
        await fsp.rmdir(__dirname + '/../instances/test', {recursive: true})
    })

    const sshUrl = 'git@github.com:docker-library/hello-world.git'
    const dockerfile = 'Dockerfile.build';

    it('should build', async function() {
        this.timeout(hour);

        await api.build({
            instanceId: 'test',
            sshUrl: 'git@github.com:docker-library/hello-world.git',
            dockerfile: 'Dockerfile.build',
            output: process.stdout
        });

        await api.run({instanceId: 'test', output: process.stdout});
    })

    it('should perform lifecycle', async function() {
        this.timeout(hour);
        const result = await api.lifecycle({sshUrl, dockerfile});
        const {delayed} = result;
        const buildLog = ts.createReadStream(result.buildLogFilename).pipe(process.stdout);
        const runLog = ts.createReadStream(result.runLogFilename).pipe(process.stdout);
        await delayed;
        buildLog.end();
        runLog.end();
        return;
    })
});