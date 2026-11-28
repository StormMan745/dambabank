import fs from 'node:fs/promises';

const files = ['index.html','app.js','ledger.js','shared.js','schedule.js','style.css','install.js','manifest.webmanifest','sw.js','icons/icon-192.png','icons/icon-512.png'];
const types = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', webmanifest: 'application/manifest+json', png: 'image/png' };
const assets = {};
for (const file of files) {
    let bytes = await fs.readFile(file);
    if (file === 'index.html') bytes = Buffer.from(bytes.toString().replace('<html lang="ru">', '<html lang="ru" data-database="server">'));
    assets['/' + file] = [types[file.split('.').pop()], bytes.toString('base64')];
}
const model = await fs.readFile('ledger.js', 'utf8');
const api = (await fs.readFile('ledger-api.mjs', 'utf8')).replace("import DambaLedger from './ledger.js';", '').replace('export async function handleLedger', 'async function handleLedger');
const worker = (await fs.readFile('worker.mjs', 'utf8'))
    .replace("import { handleLedger } from './ledger-api.mjs';", '')
    .replace("import { assets } from './generated-assets.mjs';", 'const assets = ' + JSON.stringify(assets) + ';');
await fs.mkdir('dist/server', { recursive: true });
await fs.mkdir('dist/.openai', { recursive: true });
await fs.copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
await fs.writeFile('dist/server/index.js', [model, api, worker].join('\n'));
