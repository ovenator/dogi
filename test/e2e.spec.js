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
const {wait} = require('../util');
const {getInternalSharedDir} = require('../common');

process.env['BYPASS_SIGNATURES'] = 'true'

describe('dogi:e2e', function() {
    const hour = 60 * 60 * 1000;
    beforeEach(async () => {
        await fsp.rmdir(getInternalSharedDir(''), {recursive: true})
    })

    describe('callbacks', () => {
        it('should call callback on completion', async function() {
            this.timeout(hour);

            const scope = nock('http://example.com')
                .post('/test')
                .reply(200, (uri, body) => {
                    body.env.foo.should.equal('bar');
                    body.output.should.eql({
                        log: "/output/dogi_default_45d218fc28c14ec629065042c0de0ba6bc0c5a34/log",
                        file_1: "/output/dogi_default_45d218fc28c14ec629065042c0de0ba6bc0c5a34/file_1"
                    })
                })

            const req = request(app)
            let res = await req
                .get('/ssh/git@github.com:ovenator/dogi.git?action=run&output=status&env_foo=bar&cmd=npm run mock-env&cb=http://example.com/test&file_1=/app/mock/out/env.json')
                .expect(200);

            res.body.output.should.eql({
                log: "/output/dogi_default_45d218fc28c14ec629065042c0de0ba6bc0c5a34/log",
                file_1: "/output/dogi_default_45d218fc28c14ec629065042c0de0ba6bc0c5a34/file_1"
            })

            let fileRes = await req
                .get('/output/dogi_default_45d218fc28c14ec629065042c0de0ba6bc0c5a34/file_1')
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

        it('should include callback response in status for failure', async function() {
            this.timeout(hour);

            const scope = nock('http://example.com')
                .post('/test')
                .reply(500, {
                    callback: 'response'
                })

            let res = await request(app)
                .post('/ssh/git@github.com:ovenator/dogi.git')
                .send({
                    action: 'run',
                    output: 'status',
                    cmd: 'npm run mock-env',
                    cb: 'http://example.com/test'
                })
                .expect(500);

            res.text.should.containEql('{"callback":"response"}')

            scope.done();
        })

        it('should include callback response in status for success', async function() {
            this.timeout(hour);

            const scope = nock('http://example.com')
                .post('/test')
                .reply(200, {
                    callback: 'response'
                })

            let res = await request(app)
                .get('/ssh/git@github.com:ovenator/dogi.git?action=run&output=status&env_foo=bar&cmd=npm run mock-env&cb=http://example.com/test')
                .expect(200);

            res.body.cb.response.status.should.equal(200);
            res.body.cb.response.data.should.eql({"callback": "response"});

            scope.done();
        })

        it('should include callback response in log output', async function() {
            this.timeout(hour);

            const scope = nock('http://example.com')
                .post('/test')
                .reply(500, {
                    callback: 'responsePayload'
                })

            let res = await request(app)
                .post('/ssh/git@github.com:ovenator/dogi.git')
                .send({
                    action: 'run',
                    output: 'log',
                    output_type: 'wait',
                    cmd: 'npm run mock-env',
                    cb: 'http://example.com/test',
                    env_foo: 'bar'
                })
                .expect(500);

            res.text.should.match(/responsePayload/);

            scope.done();
        })

        it('should pass the headers to callback', async function() {
            this.timeout(hour);
            process.env['CB_HEADERS'] = '{"foo": "bar"}';

            const scope = nock('http://example.com', {
                reqheaders: {
                    'content-type': 'application/json;charset=utf-8',
                    'foo': 'bar'
                }
            })
                .post('/test')
                .reply(200)

            let res = await request(app)
                .get('/ssh/git@github.com:ovenator/dogi.git?action=run&output=status&env_foo=bar&cmd=npm run mock-env&cb=http://example.com/test')
                .expect(200);

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
    })

    describe('commands', () => {
        it('should execute via cmd', async function() {
            this.timeout(hour);

            let res = await request(app)
                .get('/ssh/git@github.com:ovenator/dogi.git?action=run&output=file_1&env_foo=bar&cmd=npm run mock-env&file_1=/app/mock/out/env.json');

            JSON.parse(res.text).should.have.property('foo').which.equals('bar');
        })

        it('should execute via bashc', async function() {
            this.timeout(hour);

            let res = await request(app)
                .get('/https/github.com/ovenator/dogi-scrapy-demo.git?action=run&output=file_data&file_data=/app/data.jsonl&bashc=pipenv%20run%20scrapy')
                .expect(200)
        })

        it('should execute with params via POST', async function() {
            this.timeout(hour);

            let res = await request(app)
                .post('/https/github.com/ovenator/dogi.git')
                .send({
                    action: 'run',
                    env_foo: 'bar',
                    cmd: 'npm run mock-env',
                    file_1: '/app/mock/out/env.json',
                    output: 'file_1'
                });

            JSON.parse(res.text).should.have.property('foo').which.equals('bar');
        })

        it.skip('should not stream output when turned off', async function() {
            this.timeout(hour);

            //output_type: stream|wait|async
            let res = await request(app)
                .post('/https/github.com/ovenator/dogi.git')
                .send({
                    action: 'run',
                    env_foo: 'bar',
                    output_type: 'wait',
                    cmd: 'npm run mock-env',
                    file_1: '/app/mock/out/env.json',
                    output: 'file_1'
                });

            JSON.parse(res.text).should.have.property('foo').which.equals('bar');
        })

        it('should not hang when error occurs during streaming', async function() {
            this.timeout(hour);

            let res = await request(app)
                .post('/https/github.com/ovenator/dogi.git')
                .send({
                    action: 'run',
                    output_type: 'stream',
                    cmd: 'npm run mock-fail',
                    output: 'log'
                });

        })
    })




    it('should return status 500 when process returns non zero', async function() {
        this.timeout(hour);

        let res = await request(app)
            .get('/ssh/git@github.com:ovenator/dogi.git?action=run&output=status&cmd=npm run mock-fail')
            .expect(500);

        res.text.should.containEql('Execution failed with code 1')
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

    it('should collect outputs', async function() {
        this.timeout(hour);

        let run1 = await request(app)
            .get('/ssh/git@github.com:ovenator/dogi.git?id=1&action=run&output=file_1&env_foo=bar1&cmd=npm run mock-env&file_1=/app/mock/out/env.json');

        let run2 = await request(app)
            .get('/ssh/git@github.com:ovenator/dogi.git?id=2&action=run&output=file_1&env_foo=bar2&cmd=npm run mock-env&file_1=/app/mock/out/env.json');

        let run3 = await request(app)
            .get('/ssh/git@github.com:ovenator/dogi.git?id=3&action=run&output=file_1&env_foo=bar3&cmd=npm run mock-env&file_1=/app/mock/out/env.json');

        let collect = await request(app)
            .get('/collect?output=file_1');

        const results = [];
        for (const line of collect.text.split('\n')) {
            if (line) {
                results.push(JSON.parse(line));
            }
        }

        results.should.have.length(3);
        const bars = results.map(({foo}) => foo);
        bars.should.containDeep(['bar1', 'bar2', 'bar3']);
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

    it('should kill the instance when request is aborted', async function () {
        this.timeout(hour);

        let appRun = request(app)
            .post('/ssh/git@github.com:ovenator/dogi.git')
            .send({
                action: 'run',
                output: 'status',
                output_type: 'wait',
                cmd: 'npm run mock-env',
                env_foo: 'bar1',
                file_1: '/app/mock/out/env.json',
                attach: true
            })
            .expect(500, () => {})

        await wait(3000);

        let peekStatusPromise = request(app)
            .post('/ssh/git@github.com:ovenator/dogi.git')
            .send({
                action: 'run',
                output: 'status',
                output_type: 'wait',
                cmd: 'npm run mock-env',
                env_foo: 'bar2',
                file_1: '/app/mock/out/env.json'
            })
            .expect(500);

        await wait(1000);

        try {
            await appRun.abort();
        } catch(e) {
            console.info(e.message);
        }

        let peekStatus = await peekStatusPromise;
        peekStatus.text.should.containEql('Killed by abort');

    })

})