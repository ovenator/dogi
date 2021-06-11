const ts = require('tail-stream');

const express = require('express')
const app = express()
const port = 3001

const api = require('./api');

app.get('/ssh/:url(*)', async (req, res) => {
    const {url:sshUrl} = req.params;
    const {df, iid, action} = req.query;
    const dockerfile = df || 'Dockerfile.build';

    const result = await api.lifecycle({sshUrl, dockerfile, action});
    const {delayed} = result;

    res.setHeader("Content-Type", "text/plain");
    const logStream = ts.createReadStream(result.runLogFilename).pipe(res);

    await delayed;
    logStream.end();

    res.end();
})


app.listen(port, () => {
    console.log(`Dogi app listening at http://localhost:${port}`)
})

