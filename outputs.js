const path = require('path');
const fsp = require('fs/promises')
const {forEach} = require('lodash');
const {getInternalSharedDir, getExternalSharedDir} = require('./common');


/**
 * @param {String} instanceId
 * @param {Object} fileOutputs - key value mapping of file_* to file paths inside container
 * @returns {Outputs}
 */
exports.createOutputs = async function createOutputs(instanceId, fileOutputs) {

    const instanceDir = getInternalSharedDir(instanceId);

    /**
     * @typedef {Object} FileOutput
     * @property {string} id - output id matching pattern file_*
     * @property {string} outputFilenameInternal - filename as seen by dogi
     * @property {string} outputFilenameExternal - filename as seen on docker host
     * @property {string} containerPath - filename as seen inside the created container
     * */

    /** @type {Array.<FileOutput>} */
    const fileObjects = [];

    forEach(fileOutputs, (containerPath, fileId) => {
        const tmpFileName = `dogi.out.${fileId}`
        fileObjects.push({
            id: fileId,
            containerPath: containerPath,
            outputFilenameExternal: path.join(getExternalSharedDir(instanceId), tmpFileName),
            outputFilenameInternal: path.join(instanceDir, tmpFileName)
        });
    })

    /**
     * @typedef {Object} FileMount
     * @property {string} host - filename as seen on docker host
     * @property {string} container - filename as seen inside the created container
     * */

    /** @type {Array.<FileMount>} */
    let mounts = [];

    const outputFilesById = {};

    for (const fileObj of fileObjects) {
        const {outputFilenameInternal, outputFilenameExternal, id, containerPath} = fileObj;
        outputFilesById[id] = outputFilenameInternal;

        await fsp.writeFile(outputFilenameInternal, '');

        mounts.push({
            container: containerPath,
            host: outputFilenameExternal
        })
    }

    const logFilename = path.join(instanceDir, 'dogi.out.log');
    outputFilesById['log'] = logFilename;
    await fsp.writeFile(logFilename, '');


    const advertisedUrl = process.env['ADVERTISED_URL'] || '';

    const outputUrls = {
        log:  exports.getOutputUrl({instanceId, outputId: 'log'})
    }

    fileObjects.forEach(fileObj => {
        const {id} = fileObj;
        outputUrls[id] = exports.getOutputUrl({instanceId, outputId: id});
    })

    /**
     * @typedef Outputs
     * @property {Object} outputFilesById
     * @property {Object} outputUrls
     * @property {Array.<FileMount>} mounts
     * @property {Array.<FileOutput>} fileObjects
     */

    return {outputFilesById, mounts, outputUrls, fileObjects}
}

exports.getOutputUrl = ({instanceId, outputId}) => {
    const advertisedUrl = process.env['ADVERTISED_URL'] || '';
    return `${advertisedUrl}/output/${instanceId}/${outputId}`
}