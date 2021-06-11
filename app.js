const ts = require('tail-stream');

const express = require('express')
const app = express()
const port = 3001

const api = require('./api');

app.get('/ssh/:url(*)', async (req, res) => {
    const {params, query} = req;
    const {url:sshUrl} = params;
    const {df, iid, action, file, cmd} = query;
    const dockerfile = df || 'Dockerfile';

    const result = await api.lifecycle({sshUrl, dockerfile, action, file, cmd});
    const {delayed, output} = result;

    res.setHeader("Content-Type", "text/plain");
    const logStream = ts.createReadStream(output[query.output || 'buildLog']).pipe(res);

    await delayed;
    logStream.end();

    res.end();
})


app.listen(port, () => {
    console.log(`Dogi app listening at http://localhost:${port}`)
})

