const ts = require('tail-stream');
const mergeStream = require('merge-stream');
const Debug = require('debug');
Debug.enable('*');
const debug = Debug('app:http');
const path = require('path');

const express = require('express');
const app = express();
const port = 3001;

const bodyParser = require('body-parser');
app.use(bodyParser.json());

const api = require('./api');
const {extractPrefixed, validateFilename} = require("./util");
const {verify, verificationEnabled} = require('./crypto');
const {pick} = require('lodash');

app.get('/output/:instanceId/:output', wrap(async (req, res) => {
    const {instanceId, output} = req.params;

    validateFilename(output)

    const file = path.join(api.getInternalSharedDir(instanceId), `dogi.out.${output}`);
    res.sendFile(file)
}))

app.post('/:protocol/:url(*)', wrap(async (req, res) => {
    if (verificationEnabled()) {
        throw new Error('Cannot use POST when url signatures are required');
    }

    const params = {...req.body, ...req.query, ...req.params};
    await processRequest(req, res, {params});
}))

app.get('/:protocol/:url(*)', wrap(async (req, res) => {
    const params = {...req.query, ...req.params}
    await processRequest(req, res, {params});
}))

async function processRequest (req, res, {params}) {
    const {url, protocol} = params;
    const {df, id, bashc, cb} = params;

    const dockerfile = df || 'Dockerfile';

    if(!verify(req.url)) {
        res.send('Signature verification failed.');
        return;
    }

    const queryAction = params.action || 'peek';
    const queryOutput = params.output || 'log';

    let queryCmd = null;
    if (params.cmd) {
        queryCmd = params.cmd.split(' ');
    }

    validate('protocol', ['ssh', 'http', 'https'], protocol);
    validate('action', ['peek', 'run', 'abort', 'restart'], queryAction)
    // validate('output', ['file', 'log', 'status'], queryOutput)

    debug('starting lifecycle');
    const result = await api.lifecycle({
        instanceDuplicateId: id,
        urlProto: protocol,
        url,
        dockerfile,
        action: queryAction,
        cmd: queryCmd,
        bashc,
        env: extractPrefixed('env', params),
        callbackUrl: cb,
        containerFiles: extractPrefixed('file', params, {keepPrefix: true}),
        outputId: queryOutput
    });

    const {delayed, output} = result;
    debug('finished lifecycle')

    if (queryOutput === 'status') {
        await delayed;
        res.json({output: result.fileUrls});
        return;
    }

    res.setHeader("Connection", "Keep-Alive");
    res.setHeader("Keep-Alive", "timeout=86400, max=1000");
    res.setHeader("Content-Type", "text/plain");
    const logStream = ts.createReadStream(output[queryOutput])
    const firstEofPromise = new Promise(res => logStream.on('eof', () => res()));
    logStream.pipe(res);

    // const logStream = mergeStream(
    //     ts.createReadStream(output['buildLog']),
    //     ts.createReadStream(output['runLog']),
    // )

    // if (debug.enabled) {
    //     // const events = ['error', 'eof', 'end', 'move', 'truncate', 'replace'];
    //     const events = ['close', 'end', 'error', 'pause', 'readable', 'resume'];
    //     events.forEach(en => {
    //         logStream.on(en, (e) => {
    //             debug('logStream emitted', en, e);
    //         })
    //     })
    // }

    if (!delayed) {
        debug('delayed is not set');
    }

    await delayed;
    debug('finished delayed');
    await firstEofPromise;
    debug('finished log file');

    logStream.end();
    res.end()
}

app.get('/jobs', wrap(async (req, res) => {
    res.json(api.getRunningJobs());
}))

app.get('/collect', wrap(async (req, res) => {
    const {query} = req;
    const {output} = query;
    await api.collectOutputs({output, stream: res});
    return;
}))

function validate(param, allowed, actual) {
    if (!allowed.includes(actual)) {
        throw new Error(`Invalid value '${actual}' of '${param}', allowed values are ${JSON.stringify(allowed)}`)
    }
}

function wrap(fn) {
    return async (req, res, next) => {
        try {
            // run controllers logic
            await fn(req, res, next)
        } catch (e) {
            // if an exception is raised, do not send any response
            // just continue performing the middleware chain
            next(e)
        }
    }
}



if(!module.parent) {
    app.listen(port, () => {
        console.log(`Dogi app listening at http://localhost:${port}`)
    })
} else {
    module.exports = app;
}


