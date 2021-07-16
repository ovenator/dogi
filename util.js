const {sha1} = require('./crypto');

exports.openPromise = function() {
    let resolve, reject;
    const p = new Promise((res, rej) => {
        [resolve, reject] = [res, rej];
    })
    p.resolve = resolve;
    p.reject = reject;
    return p;
}

exports.createLock = function(maxRunning, maxPending) {
    let currentCount = 0;
    const pending = [];

    return {
        acquire() {
            if (pending.length > maxPending) {
                return Promise.reject(new Error('Too many pending requests'));
            }

            const op = exports.openPromise();
            if (currentCount < maxRunning) {
                currentCount ++;
                op.resolve();
            } else {
                pending.push(op);
            }
            return op;
        },
        release() {
            const op = pending.shift();
            currentCount --;
            op.resolve();
        }
    }
}

exports.extractPrefixed = function(prefix, obj, opts) {
    const options = opts || {};
    const res = {};
    if (obj) {
        for (const [key, value] of Object.entries(obj)) {
            if ((new RegExp(`^${prefix}_`, 'i')).test(key)) {
                const newKey = options.keepPrefix ? key : key.substr(prefix.length + 1);
                res[newKey] = value;
            }
        }
    }

    return res;
}

exports.toInstanceId = ({repoName, customId}) => {
    let instanceId = `dogi_${sha1(repoName)}`;
    if(customId) {
        instanceId = `${instanceId}_${sha1(customId)}`;
    }
    return instanceId
}

exports.wait = function wait(ms) {
    return new Promise(res => setTimeout(res, ms));
}

exports.validateFilename = (filename) => {
    if(filename && !/^[a-zA-Z0-9_]+$/i.test(filename)) {
        throw new Error('filename can contain only alphanumeric characters and _');
    }
}
