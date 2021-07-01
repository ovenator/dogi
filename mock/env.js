const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

async function main() {
    console.log('printing env into env.json');
    await fsp.writeFile(path.join(__dirname, 'out', 'env.json'), JSON.stringify(process.env));
}

main()
    .then(res => console.log('finished with', res))
    .catch(e => console.error('failed with', e));