const should = require('should');

const {extractPrefixed} = require("../util");
const {verifyInternal, sha1} = require("../crypto");

describe('dogi:unit', function() {

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

    it('should extract prefixed params', async function() {
        const query = {
            foo1: 'foo1',
            foo2_env_foo: 'foo2',
            Env_foo3: 'foo3',
            env_foo4: 'foo4',
            foo5: 'foo5',
        }

        extractPrefixed('env', query).should.eql({foo3: 'foo3', foo4: 'foo4'});
        extractPrefixed('foo2', query).should.eql({env_foo: 'foo2'});
    })
})