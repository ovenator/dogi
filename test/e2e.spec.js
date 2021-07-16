const should = require('should');
const debug = require('debug');
const fs = require('fs');
const fsp = fs.promises;
const ts = require('tail-stream');
const request = require('supertest');
const nock = require('nock');

debug.enable('*');

const docker = require('../docker');
const api = require('../api');
const app = require('../app');
const {toInstanceId, wait, openPromise} = require('../util');

process.env['BYPASS_SIGNATURES'] = 'true'

describe('dogi:e2e', function() {
    const hour = 60 * 60 * 1000;
    beforeEach(async () => {
        await fsp.rmdir(api.getInternalSharedDir(''), {recursive: true})
    })

    it('should get container', async function() {
        this.timeout(hour);
        docker.getContainer()
    })


    it('should call callback on completion', async function() {
        this.timeout(hour);

        const scope = nock('http://example.com')
            .post('/test')
            .reply(200, (uri, body) => {
                body.env.foo.should.equal('bar');
                body.output.should.eql({
                    log: "/output/dogi_45d218fc28c14ec629065042c0de0ba6bc0c5a34/log",
                    file_1: "/output/dogi_45d218fc28c14ec629065042c0de0ba6bc0c5a34/file_1"
                })
            })

        const req = request(app)
        let res = await req
            .get('/ssh/git@github.com:ovenator/dogi.git?action=run&output=status&env_foo=bar&cmd=npm run mock-env&cb=http://example.com/test&file_1=/app/mock/out/env.json')
            .expect(200);

        res.body.output.should.eql({
            log: "/output/dogi_45d218fc28c14ec629065042c0de0ba6bc0c5a34/log",
            file_1: "/output/dogi_45d218fc28c14ec629065042c0de0ba6bc0c5a34/file_1"
        })

        let fileRes = await req
            .get('/output/dogi_45d218fc28c14ec629065042c0de0ba6bc0c5a34/file_1')
            .expect(200, );


        const obj = JSON.parse(fileRes.body.toString());
        obj.foo.should.eql('bar');
        scope.done();

    })

    it('should fail the run when callback fails', async function() {
        this.timeout(hour);

        const scope = nock('http://example.com')
            .post('/test')
            .reply(500)

        let res = await request(app)
            .get('/ssh/git@github.com:ovenator/dogi.git?action=run&output=status&env_foo=bar&cmd=npm run mock-env&cb=http://example.com/test')
            .expect(500);

        scope.done();
    })

    it('should not call callback on error', async function() {
        this.timeout(hour);

        const scope = nock('http://example.com')
            .post('/test')
            .reply(200)

        let res = await request(app)
            .get('/ssh/git@github.com:ovenator/dogi.git?action=run&output=status&env_foo=bar&cmd=npm run mock-fail&cb=http://example.com/test')
            .expect(500);

        scope.pendingMocks().should.have.length(1);
        nock.cleanAll();
        scope.done()
    })

    it('should return status 500 when process returns non zero', async function() {
        this.timeout(hour);

        let res = await request(app)
            .get('/ssh/git@github.com:ovenator/dogi.git?action=run&output=status&cmd=npm run mock-fail')
            .expect(500);

        res.text.should.containEql('Execution failed with code 1')
    })

    it('should execute via cmd', async function() {
        this.timeout(hour);

        let res = await request(app)
            .get('/ssh/git@github.com:ovenator/dogi.git?action=run&output=file_1&env_foo=bar&cmd=npm run mock-env&file_1=/app/mock/out/env.json');

        JSON.parse(res.text).should.have.property('foo').which.equals('bar');
    })


    it('should run in parallel if id is provided', async function() {
        this.timeout(hour);

        let run1 = request(app)
            .get('/ssh/git@github.com:ovenator/dogi.git?id=1&action=run&output=file_1&env_foo=bar1&cmd=npm run mock-env&file_1=/app/mock/out/env.json');
        run1.then(() => console.log('run1 finished'));

        let run2 = request(app)
            .get('/ssh/git@github.com:ovenator/dogi.git?id=2&action=run&output=file_1&env_foo=bar2&cmd=npm run mock-env&file_1=/app/mock/out/env.json');
        run2.then(() => console.log('run2 finished'));

        const run1Res = await run1;
        const run2Res = await run2;

        JSON.parse(run1Res.text).should.have.property('foo').which.equals('bar1');
        JSON.parse(run2Res.text).should.have.property('foo').which.equals('bar2');
    })

    it('should execute via bashc', async function() {
        this.timeout(hour);

        let res = await request(app)
            .get('/https/github.com/ovenator/dogi-scrapy-demo.git?action=run&output=file_data&file_data=/app/data.jsonl&bashc=pipenv%20run%20scrapy')
            .expect(200)
    })

    it('should only finish last restart', async function() {
        this.timeout(hour);

        let appRun = request(app)
            .get('/ssh/git@github.com:ovenator/dogi.git?action=run&output=status&env_foo=0&cmd=npm run mock-env&file_1=/app/mock/out/env.json')
            .expect(500);
            appRun.then(() => console.log('appRun finished'))

         await wait(1000);

        let appRestart1 = request(app)
            .get('/ssh/git@github.com:ovenator/dogi.git?action=restart&output=status&env_foo=1&cmd=npm run mock-env&file_1=/app/mock/out/env.json')
            .expect(500);
        appRestart1.then(() => console.log('appRestart1 finished'))

        await wait(1000);

        let appRestart2 = request(app)
            .get('/ssh/git@github.com:ovenator/dogi.git?action=restart&output=status&env_foo=2&cmd=npm run mock-env&file_1=/app/mock/out/env.json')
            .expect(500);
        appRestart2.then(() => console.log('appRestart2 finished'))

        await wait(1000);

        let appRestart3 = request(app)
            .get('/ssh/git@github.com:ovenator/dogi.git?action=restart&output=file_1&env_foo=3&cmd=npm run mock-env&file_1=/app/mock/out/env.json')
            .expect(200);
        appRestart3.then(() => console.log('appRestart3 finished'))

        await appRun;
        await appRestart1;
        await appRestart2;
        await appRestart3;

        let resultPeek = await request(app)
            .get('/ssh/git@github.com:ovenator/dogi.git?action=peek&output=file_1')

        JSON.parse(resultPeek.text).should.have.property('foo').which.equals('3');
    })
})