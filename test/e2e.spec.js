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
const {toInstanceId, wait} = require('../util');

process.env['BYPASS_SIGNATURES'] = 'true'

describe('dogi:e2e', function() {
    const hour = 60 * 60 * 1000;
    beforeEach(async () => {
        await fsp.rmdir(api.getInternalSharedDir(''), {recursive: true})
    })


    it('should call callback on completion', async function() {
        this.timeout(hour);

        const scope = nock('http://example.com')
            .post('/test')
            .reply(200, (uri, body) => {
                body.env.foo.should.equal('bar');
                body.output.should.eql({
                    log: "http://localhost/output/dogi_45d218fc28c14ec629065042c0de0ba6bc0c5a34/log",
                    file: "http://localhost/output/dogi_45d218fc28c14ec629065042c0de0ba6bc0c5a34/file"
                })
            })

        const req = request(app)
        let res = await req
            .get('/ssh/git@github.com:ovenator/dogi.git?action=run&output=status&env_foo=bar&cmd=npm run mock-env&cb=http://example.com/test&file=/app/mock/out/env.json')
            .expect(200);


        let fileRes = await req
            .get('/output/dogi_45d218fc28c14ec629065042c0de0ba6bc0c5a34/file')
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
})