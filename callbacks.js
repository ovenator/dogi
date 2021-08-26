const axios = require('axios');
const fs = require('fs');

/**
 * @param {DogiInstance} instance
 * @param {string} callbackUrl
 * @returns {CallbackResult}
 */
exports.processCallback = async function processCallback(instance, callbackUrl) {
    const logFilename = instance.outputs.outputFilesById['log'];
    const requestLog = fs.createWriteStream(logFilename, {flags: 'a'});
    requestLog.write(`Calling POST ${callbackUrl}`);

    let result = await axios.post(callbackUrl, {
        id: instance.explicitId,
        env: instance.env,
        output: instance.outputs.outputUrls
    }, {
        headers: JSON.parse(process.env['CB_HEADERS'] || '{}'),
        validateStatus() {
            return true;
        }
    });
    const {config: {url, method, data: requestData}, data, status} = result;

    /**
     * @typedef {Object} CallbackResult
     * @property {any} request
     * @property {{status:number, data: {any}}} response
     * */

    /** @type {CallbackResult} */
    const cbResult = {
        request: {url, method, data: requestData},
        response: {status, data}
    };

    requestLog.write(JSON.stringify(cbResult));
    requestLog.close();

    return cbResult;
}