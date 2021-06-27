const should = require('should');
const debug = require('debug');
const fs = require('fs');
const fsp = fs.promises;
const ts = require('tail-stream');

debug.enable('*');

const docker = require('../docker');
const api = require('../api');
const {verifyInternal, sha1} = require("../crypto");

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
        const result = await api.lifecycle({sshUrl: 'git@github.com:ovenator/estates.git', bashc: 'pipenv run scrapy'});
        const {delayed, instanceId} = result;
        const buildLog = ts.createReadStream(result.output['log']).pipe(process.stdout);
        // let container = docker.getContainer(instanceId);
        // let info = await container.inspect();
        await delayed;
        buildLog.end();
        return;
    })

    it('should verify signed url with &sig', async function() {
        const url = '/ssh/git@github.com:ovenator/estates.git?action=peek&output=runLog';
        const secret = 'myLittleSecret';
        const sig = sha1(`${secret}:${url}`);

        const surl = `${url}&sig=${sig}`;
        verifyInternal(surl, secret).should.be.true();
        verifyInternal(surl, 'fakesecret').should.be.false();
    })

    it('should verify signed url with ?sig', async function() {
        const url = '/ssh/git@github.com:ovenator/estates.git';
        const secret = 'myLittleSecret';
        const sig = sha1(`${secret}:${url}`);

        const surl = `${url}?sig=${sig}`;
        verifyInternal(surl, secret).should.be.true();
        verifyInternal(surl, 'fakesecret').should.be.false();
    })
});



