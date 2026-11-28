'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const port = Number(process.env.DAMBABANK_PORT || 4070);
const assets = {
    'index.html': 'text/html', 'style.css': 'text/css', 'schedule.js': 'text/javascript',
    'ledger.js': 'text/javascript', 'app.js': 'text/javascript', 'shared.js': 'text/javascript',
    'install.js': 'text/javascript', 'sw.js': 'text/javascript', 'manifest.webmanifest': 'application/manifest+json',
    'icons/icon-192.png': 'image/png', 'icons/icon-512.png': 'image/png',
};
let db;
function openLedger() {
    if (!db) {
        const { DatabaseSync } = require('node:sqlite');
        const file = process.env.DAMBABANK_DB || path.join(process.env.LOCALAPPDATA || os.homedir(), 'Dambabank', 'ledger.sqlite');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const sql = new DatabaseSync(file);
        sql.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
        if (!sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ledgers'").get()) {
            sql.exec(fs.readFileSync(path.join(__dirname, 'drizzle/0000_ledgers.sql'), 'utf8').replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS '));
        }
        db = { prepare: query => ({ bind: (...args) => {
            const stmt = sql.prepare(query);
            return { first: () => stmt.get(...args), run: () => ({ meta: stmt.run(...args) }) };
        } }) };
    }
    return db;
}

http.createServer(async (req, res) => {
    try {
        const allowed = ['127.0.0.1:' + port, 'localhost:' + port];
        if (!allowed.includes(req.headers.host)) { res.writeHead(403).end(); return; }
        const url = new URL(req.url, 'http://' + req.headers.host);
        if (url.pathname === '/api/ledger') {
            const init = { method: req.method, headers: req.headers };
            if (!['GET','HEAD'].includes(req.method)) Object.assign(init, { body: Readable.toWeb(req), duplex: 'half' });
            const { handleLedger } = await import('./ledger-api.mjs');
            const reply = await handleLedger(new Request(url, init), openLedger(), 'local-family');
            res.writeHead(reply.status, Object.fromEntries(reply.headers));
            res.end(Buffer.from(await reply.arrayBuffer()));
            return;
        }
        if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        if (!Object.hasOwn(assets, file)) { res.writeHead(404).end(); return; }
        let bytes = await fs.promises.readFile(path.join(__dirname, file));
        if (file === 'index.html') bytes = Buffer.from(bytes.toString().replace('<html lang="ru">','<html lang="ru" data-database="server">'));
        res.writeHead(200, { 'Content-Type': assets[file], 'Content-Length': bytes.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
        console.error('Ошибка Дамбабанка:', error.message);
        res.writeHead(500, { 'Cache-Control': 'no-store' }).end();
    }
}).on('error', error => { console.error(error.message); process.exitCode = 1; })
    .listen(port, '127.0.0.1', () => console.log('Дамбабанк — http://127.0.0.1:' + port + '/'));
