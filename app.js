const ts = require('tail-stream');
const Debug = require('debug');
Debug.enable('*');
const debug = Debug('app:http');

const express = require('express')
const app = express()
const port = 3001

const api = require('./api');
const {verify} = require('./crypto');

app.get('/ssh/:url(*)', wrap(async (req, res) => {
    const {params, query} = req;
    const {url:sshUrl} = params;
    const {df, iid, file, cmd} = query;
    const dockerfile = df || 'Dockerfile';

    if(!verify(req.url)) {
        res.send('Signature verification failed.');
        return;
    }

    const queryAction = query.action || 'run';
    const queryOutput = query.output || 'buildLog'

    validate('action', ['peek', 'run'], queryAction)
    validate('output', ['file', 'buildLog', 'runLog'], queryOutput)

    debug('starting lifecycle');
    const result = await api.lifecycle({sshUrl, dockerfile, action: queryAction, file, cmd});
    const {delayed, output} = result;
    debug('finished lifecycle')

    res.setHeader("Connection", "Keep-Alive");
    res.setHeader("Keep-Alive", "timeout=86400, max=1000");
    res.setHeader("Content-Type", "text/plain");
    const logStream = ts.createReadStream(output[queryOutput])
    const firstEofPromise = new Promise(res => logStream.on('eof', () => res()));
    logStream.pipe(res);

    if (debug.enabled) {
        const events = ['error', 'eof', 'end', 'move', 'truncate', 'replace'];
        events.forEach(en => {
            logStream.on(en, (e) => {
                debug('logStream emitted', en, e);
            })
        })
    }

    if (!delayed) {
        debug('delayed is not set');
    }

    await delayed;
    debug('finished delayed');
    await firstEofPromise;
    debug('finished log file');

    logStream.end();
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

app.listen(port, () => {
    console.log(`Dogi app listening at http://localhost:${port}`)
})

