const should = require('should');
const debug = require('debug');
const fs = require('fs');
const fsp = fs.promises;
const ts = require('tail-stream');

debug.enable('*');

const docker = require('../docker');
const api = require('../api');
const {extractEnvs} = require("../util");
const {verifyInternal, sha1} = require("../crypto");

describe('dogi', () => {
    const hour = 60 * 60 * 1000;
    beforeEach(async () => {
        await fsp.rmdir(api.getInternalSharedDir(''), {recursive: true})
    })


    // it('should build', async function() {
    //     this.timeout(hour);
    //
    //     await api.build({
    //         instanceId: 'test',
    //         sshUrl: 'git@github.com:docker-library/hello-world.git',
    //         dockerfile: 'Dockerfile.build',
    //         output: process.stdout
    //     });
    //
    //     await api.run({instanceId: 'test', output: process.stdout});
    // })

    // it('should perform lifecycle', async function() {
    //     this.timeout(hour);
    //     const result = await api.lifecycle({sshUrl: 'git@github.com:ovenator/estates.git', bashc: 'pipenv run scrapy'});
    //     const {delayed, instanceId} = result;
    //     const buildLog = ts.createReadStream(result.output['log']).pipe(process.stdout);
    //     // let container = docker.getContainer(instanceId);
    //     // let info = await container.inspect();
    //     await delayed;
    //     buildLog.end();
    //     return;
    // })

    it('should throw when restarted', async function() {
        this.timeout(hour);
        const instance1 = await api.lifecycle({sshUrl: 'git@github.com:ovenator/estates.git', bashc: 'pipenv run scrapy', file: '/app/data.jsonl'});
        const logStream1 = ts.createReadStream(instance1.output['log']);
        const fileStream1 = ts.createReadStream(instance1.output['file']);
        logStream1.pipe(process.stdout)
        fileStream1.pipe(process.stdout)

        await wait(2000);

        const instance2 = await api.lifecycle({sshUrl: 'git@github.com:ovenator/estates.git', bashc: 'pipenv run scrapy', file: '/app/data.jsonl', action: 'restart'});
        const logStream2 = ts.createReadStream(instance2.output['log']);
        const fileStream2 = ts.createReadStream(instance2.output['file']);
        logStream2.pipe(process.stdout)
        fileStream2.pipe(process.stdout)

        const fileStringPromise1 = streamToString(fileStream1);
        const fileStringPromise2 = streamToString(fileStream2);

        try {
            await instance1.delayed;
            should.fail('instance1 should fail when restarted');
        } catch (e) {
            e.message.should.match(/No such container/);
        }

        await instance2.delayed;
        logStream1.end();
        fileStream1.end();
        logStream2.end();
        fileStream2.end();

        let fileString1 = await fileStringPromise1;
        let fileString2 = await fileStringPromise2;
        fileString1.should.be.empty();
        fileString2.split('\n').length.should.equal(202);
    })

    it('should generate file', async function() {
        this.timeout(hour);
        const instance = await api.lifecycle({sshUrl: 'git@github.com:ovenator/estates.git', bashc: 'pipenv run scrapy', file: '/app/data.jsonl'});
        const {delayed} = instance;
        const logStream = ts.createReadStream(instance.output['log']);
        const fileStream = ts.createReadStream(instance.output['file']);

        logStream.pipe(process.stdout)
        fileStream.pipe(process.stdout)
        // let container = docker.getContainer(instanceId);
        // let info = await container.inspect();
        const fileStringPromise = streamToString(fileStream);

        await delayed;
        logStream.end();
        fileStream.end();

        let fileString = await fileStringPromise;
        fileString.split('\n').length.should.equal(202);
    })

    it('should pass env var', async function() {
        this.timeout(hour);
        const runInstance = await api.lifecycle({sshUrl: 'git@github.com:ovenator/dogi.git', cmd: 'npm run mock-env'.split(' '), file: '/app/mock/out/env.json', env: {foo: 'bar'}});
        const runLogStream =  ts.createReadStream(runInstance.output['log']);
        const runFileStream = ts.createReadStream(runInstance.output['file']);

        runLogStream.pipe(process.stdout)
        runFileStream.pipe(process.stdout)

        const runFileStringPromise = streamToString(runFileStream);

        await runInstance.delayed;
        await wait(1000);

        runFileStream.end();

        let runFileString = await runFileStringPromise;
        let env = JSON.parse(runFileString);
        should(env.foo).eql('bar');
        return;
    })

    it('should extract prefixed params', async function() {
        const query = {
            foo1: 'foo1',
            foo2_env_foo: 'foo2',
            Env_foo3: 'foo3',
            env_foo4: 'foo4',
            foo5: 'foo5',
        }

        extractEnvs('env', query).should.eql({foo3: 'foo3', foo4: 'foo4'});
        extractEnvs('foo2', query).should.eql({env_foo: 'foo2'});
    })

    it('should peek on finished', async function() {
        this.timeout(hour);
        const runInstance = await api.lifecycle({sshUrl: 'git@github.com:ovenator/estates.git', bashc: 'pipenv run scrapy', file: '/app/data.jsonl'});
        const runLogStream = ts.createReadStream(runInstance.output['log']);
        const runFileStream = ts.createReadStream(runInstance.output['file']);

        runLogStream.pipe(process.stdout)
        runFileStream.pipe(process.stdout)

        const runFileStringPromise = streamToString(runFileStream);

        await runInstance.delayed;
        runLogStream.end();
        runFileStream.end();

        await wait(1000);

        //PEEK
        const peekInstance = await api.lifecycle({sshUrl: 'git@github.com:ovenator/estates.git', bashc: 'pipenv run scrapy', file: '/app/data.jsonl', action: 'peek'});
        const peekLogStream =  ts.createReadStream(peekInstance.output['log']);
        const peekFileStream = ts.createReadStream(peekInstance.output['file']);

        const peekFileStringPromise = streamToString(peekFileStream);

        await peekInstance.delayed;
        await wait(1000);

        peekLogStream.end();
        peekFileStream.end();

        let runFileString = await runFileStringPromise;
        let peekFileString = await peekFileStringPromise;

        runFileString.split('\n').length.should.equal(202);
        runFileString.should.eql(peekFileString);
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


function streamToString (stream) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', (err) => reject(err));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  })
}

function wait(ms) {
    return new Promise(res => setTimeout(res, ms));
}