const crypto = require('crypto');

exports.sha1 = function sha1(str) {
    const shasum = crypto.createHash('sha1');
    shasum.update(str);
    return shasum.digest('hex');
}

exports.verifyInternal = function verifyInternal(surl, secret) {
    let param = '?sig='
    if (surl.indexOf(param) === -1) {
        param = '&sig='
    }

    const [url, sig] = surl.split(param);
    return exports.sha1(`${secret}:${url}`) === sig;
}

exports.verify = function verify(surl) {
    if(process.env['BYPASS_SIGNATURES'] === 'true') {
        return true;
    }

    const secret = process.env['SIGNATURES_SECRET'];
    if (!secret || secret.length < 6) {
        throw new Error('env SIGNATURES_SECRET is missing or has less than 6 characters, set env BYPASS_SIGNATURES=true if you do not care about signatures');
    }

    return exports.verifyInternal(surl, secret);
};