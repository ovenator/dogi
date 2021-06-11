const should = require('should');
const debug = require('debug');
const fsp = require('fs').promises;

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

    it('should lock', async function() {
        await api.lifecycle({sshUrl, dockerfile});
        return;
    })
});