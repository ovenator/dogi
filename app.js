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
const {isEmpty} = require("lodash");
const {getInternalSharedDir} = require("./common");
const {extractPrefixed, validateFilename} = require("./util");
const {verify, verificationEnabled} = require('./crypto');

app.get('/output/:instanceId/:output', wrap(async (req, res) => {
    const {instanceId, output} = req.params;

    validateFilename(output)

    const file = path.join(getInternalSharedDir(instanceId), `dogi.out.${output}`);
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

/**
 *
 * @param req
 * @param res
 * @param {JobParams} params
 * @return {Promise<void>}
 */
async function processRequest (req, res, {params: _params}) {

    /**
     * @typedef JobParams
     * @property {string} url
     * @property {Protocol} protocol
     * @property {Action} action
     * @property {Output} output - log, status, file_*
     * @property {OutputType} output_type
     * @property {string} id
     * @property {string} df - dockerfile
     * @property {string} bashc
     * @property {string} cmd
     * @property {string} cb
     * @property {string} attach
     */

    /**
     * @readonly
     * @enum {string}
     */
    const Action = {
        run: 'run',
        peek: 'peek',
        restart: 'restart',
        abort: 'abort',
    }

    /**
     * @readonly
     * @enum {string}
     */
    const Output = {
        log: 'log',
        status: 'status'
    }

    /**
     * @readonly
     * @enum {string}
     */
    const OutputType = {
        async: 'async',
        wait: 'wait',
        stream: 'stream',
    }

    /**
     * @readonly
     * @enum {string}
     */
    const Protocol = {
        https: 'https',
        http: 'http',
        ssh: 'ssh'
    }

    const jobParams = {
        action: '',
        id: '',
        url: '',
        protocol: ''
    }

    const outputParams = {
        output: '',
        output_type: '',
    }

    const runParams = {
        df: '',
        bashc: '',
        cmd: '',
        cb: '',
        attach: ''
    }
    
     /** @type {JobParams} */
    const params = {
        output_type: 'stream',
        output: 'log',
        action: 'peek',
        df: 'Dockerfile',
        ..._params
    }

    const {action, output: outputId, output_type, url} = params;

    let splitCmd = null;
    if (params.cmd) {
        splitCmd = params.cmd.split(' ');
    }

    /** @type {DogiInstance} */
    const instance = await api.lifecycle({
        explicitId: params.id,
        urlProto: params.protocol,
        url,
        dockerfile: params.df,
        action,
        cmd: splitCmd,
        bashc: params.bashc,
        env: extractPrefixed('env', params),
        callbackUrl: params.cb,
        containerFiles: extractPrefixed('file', params, {keepPrefix: true}),
        outputId
    });


    if (['1', 'true', true].includes(params.attach)) {
        req.on('close', async function(err) {
            debug('connection closed, killing attached instance');
            await instance.abort();
        });
    }

    const outputTypeHandlers = {
        async wait() {
            await instance.instanceFinished;
            return this.async();
        },
        async async() {
            const status = isEmpty(instance.errors) ? 200 : 500;
            if (outputId === 'status') {
                res
                    .status(status)
                    .json(instanceToStatus(instance));
                return;
            }
            // await new Promise(res => setTimeout(res, 1000));
            res
                .status(status)
                .sendFile(instance.outputs.outputFilesById[outputId]);
        },
        async stream() {
            if (outputId === 'status') {
                return this.wait();
            }

            res.setHeader("Connection", "Keep-Alive");
            res.setHeader("Keep-Alive", "timeout=86400, max=1000");
            res.setHeader("Content-Type", "text/plain");
            const fileStream = ts.createReadStream(instance.outputs.outputFilesById[outputId])
            const firstEofPromise = new Promise(res => fileStream.on('eof', () => res()));
            fileStream.pipe(res);

            if (!instance.delayed) {
                debug('delayed is not set');
            }

            try {
                await instance.delayed;
                debug('finished delayed');
                await firstEofPromise;
                debug('finished log file');
            } catch (e) {
                throw e;
            } finally {
                fileStream.end();
                res.end();
            }

        }
    }

    await outputTypeHandlers[output_type]();
}

/**
 *
 * @param {DogiInstance} instance
 */
function instanceToStatus(instance) {
    const {explicitId, outputs: {outputUrls}, cb, env, errors} = instance;
    return {
        id: explicitId,
        env,
        output: outputUrls,
        cb,
        errors
    }
}

async function processRequest_old (req, res, {params}) {

    /**
     * @readonly
     * @enum {string}
     */
    const Action = {
        run: 'run',
        peek: 'peek',
        restart: 'restart',
        abort: 'abort',
    }

    /**
     * @readonly
     * @enum {string}
     */
    const Output = {
        log: 'log',
        status: 'status'
    }

    /**
     * @readonly
     * @enum {string}
     */
    const OutputType = {
        async: 'async',
        wait: 'wait',
        stream: 'stream',
    }

    /**
     * @readonly
     * @enum {string}
     */
    const Protocol = {
        https: 'https',
        http: 'http',
        ssh: 'ssh'
    }



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
        explicitId: id,
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

    const {delayed} = result;
    debug('finished lifecycle')

    if (queryOutput === 'status') {
        await delayed;
        res.json({output: result.outputs.outputUrls, cb: result.cb});
        return;
    }

    res.setHeader("Connection", "Keep-Alive");
    res.setHeader("Keep-Alive", "timeout=86400, max=1000");
    res.setHeader("Content-Type", "text/plain");
    const logStream = ts.createReadStream(result.outputs.outputFilesById[queryOutput])
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

app.get('/outputs', wrap(async (req, res) => {
    const outputs = await api.getOutputs();
     res.json(outputs);
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


