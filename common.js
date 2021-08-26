const path = require('path');
const fs = require('fs');
const {validateFilename} = require('./util');

//this necessary workaround until https://github.com/moby/moby/issues/32582 is implemented
const internalSharedDir = '/tmp/dogi-shared/instances';
fs.mkdirSync(internalSharedDir, {recursive: true});
exports.getInternalSharedDir = getInternalSharedDir;
function getInternalSharedDir(instanceId) {
    instanceId = instanceId || '';
    validateFilename(instanceId);
    return path.join(internalSharedDir, instanceId)
}

const externalSharedDir = path.join(process.env['HOST_SHARED_DIR'] || '/tmp', 'dogi-shared/instances');
exports.getExternalSharedDir = function getExternalSharedDir(instanceId) {
    validateFilename(instanceId);
    return path.join(externalSharedDir, instanceId);
}