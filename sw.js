'use strict';

const cacheName = 'dambabank-shell-v9-ledger';
const scope = self.registration.scope;
const index = new URL('index.html', scope).href;
const files = ['./', 'style.css?v=ledger-1', 'install.js', 'schedule.js', 'ledger.js?v=1', 'shared.js?v=1', 'app.js?v=ledger-1', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png']
    .map(file => new URL(file, scope).href);
const assets = new Set(files);

self.addEventListener('install', event => {
    event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(files.map(url => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(key => key.startsWith('dambabank-shell-') && key !== cacheName).map(key => caches.delete(key))))
        .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    const page = url.origin + url.pathname;
    if (request.mode === 'navigate' && (page === scope || page === index)) {
        event.respondWith(fetch(request).catch(async () => (await (await caches.open(cacheName)).match(scope)) || Response.error()));
    } else if (assets.has(request.url)) {
        event.respondWith(caches.open(cacheName).then(cache => cache.match(request)).then(hit => hit || fetch(request)));
    }
});
