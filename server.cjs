'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const port = Number(process.env.DAMBABANK_PORT || 4070);
const publicAssets = new Map([
    ['/index.html', 'text/html; charset=utf-8'],
    ['/style.css', 'text/css; charset=utf-8'],
    ['/schedule.js', 'application/javascript; charset=utf-8'],
    ['/app.js', 'application/javascript; charset=utf-8'],
    ['/install.js', 'application/javascript; charset=utf-8'],
    ['/sw.js', 'application/javascript; charset=utf-8'],
    ['/manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
    ['/icons/icon-192.png', 'image/png'],
    ['/icons/icon-512.png', 'image/png'],
]);

http.createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
    }
    const url = new URL(request.url, 'http://127.0.0.1');
    const asset = url.pathname === '/' ? '/index.html' : url.pathname;
    const contentType = publicAssets.get(asset);
    if (!contentType) {
        response.writeHead(404).end();
        return;
    }
    try {
        const bytes = await fs.readFile(path.join(__dirname, asset.slice(1)));
        response.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': bytes.length,
            'Cache-Control': 'no-cache',
            'X-Content-Type-Options': 'nosniff',
        });
        response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
        response.writeHead(404).end();
    }
}).on('error', error => {
    console.error('Не удалось запустить калькулятор: ' + error.message);
    process.exitCode = 1;
}).listen(port, '127.0.0.1', () => console.log('Дамбабанк — http://127.0.0.1:' + port + '/'));
