const express = require('express')
const app = express()
const port = 3001

const api = require('./api');

app.get('/ssh/:url(*)', async (req, res) => {
    const {url:sshUrl} = req.params;
    const {df, iid} = req.query;
    const dockerfile = df || 'Dockerfile.build';

    const idParts = [sha1(sshUrl), iid].filter(part => !!part);
    const instanceId = idParts.join('@');

    api.lifecycle()

    res.end();
})


app.listen(port, () => {
    console.log(`Dogi app listening at http://localhost:${port}`)
})