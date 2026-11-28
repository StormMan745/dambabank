'use strict';

const cloudHome = 'https://dambabank.rustygeranium64.chatgpt.site/';
const oldOrigin = 'https://stormman745.github.io';
const migrationKey = 'dambabank-migrated-v2';
const defaults = () => ({ people: initialPeople.map(p => ({ ...p, createdAt: 0, marks: [] })) });
function preference(key) { try { return localStorage.getItem(key); } catch { return null; } }
function migrated() { try { localStorage.setItem(migrationKey, 'yes'); } catch { /* The server also records imports. */ } }
function hasHistory(book) {
    return book.people.length !== 2 || book.people.some((p, i) => p.id !== initialPeople[i].id || p.name !== initialPeople[i].name || p.marks.length);
}


const SharedLedger = (() => {
    const available = document.documentElement.dataset.database === 'server';
    let opening, activeSync, viewedAccount, network = 'unknown', needsSignIn = false;
    const notify = () => window.dispatchEvent(new Event('dambabank-sync'));

    function openCache() {
        if (!opening) opening = new Promise((resolve, reject) => {
            const req = indexedDB.open('dambabank-sync', 1);
            req.onupgradeneeded = () => req.result.createObjectStore('state');
            req.onsuccess = () => {
                req.result.onversionchange = () => { req.result.close(); opening = null; };
                resolve(req.result);
            };
            req.onerror = () => { opening = null; reject(req.error); };
        });
        return opening;
    }

    async function cache(mode, visit, selectedAccount) {
        const db = await openCache();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('state', mode, { durability: 'strict' });
            const store = tx.objectStore('state');
            let result, error;
            function read(key, next) {
                const req = store.get(key);
                req.onsuccess = () => {
                    try { next(req.result); } catch (err) { error = err; tx.abort(); }
                };
            }
            read('active', account => {
                const key = selectedAccount || account || 'missing';
                read(key, state => { result = visit(store, state, account); });
            });
            tx.oncomplete = () => resolve(result);
            tx.onabort = () => reject(error || tx.error);
        });
    }

    async function request(payload) {
        const options = { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(10000) };
        if (payload) Object.assign(options, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const response = await fetch('./api/ledger', options);
        if (response.status === 409) return null;
        if (response.status === 401 || response.redirected) {
            needsSignIn = true;
            throw new Error('Откройте сайт и войдите в свой аккаунт.');
        }
        if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) {
            throw new Error('Не удалось подключиться к общей базе.');
        }
        return response.json();
    }

    async function importAction(source) {
        if (!DambaLedger.valid(source)) throw new Error('В копии некорректные данные.');
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(source.people)));
        const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        return { type: 'import', key, people: source.people };
    }

    function apply(book, action, revision) {
        if (action.type !== 'import') {
            if (!['add', 'delete'].includes(action.type) && !book.people.some(p => p.id === action.id)) return 'discarded';
            return DambaLedger.change(book, action);
        }
        if (book.imports?.includes(action.key)) return 'saved';
        if (revision <= 1 && !hasHistory(book) && !book.imports?.length && !book.people.some(p => p.period)) book.people = [];
        for (const [index, item] of action.people.entries()) {
            const match = book.people.find(person => person.id === item.id);
            const original = initialPeople.find(person => person.id === item.id);
            if (!match) book.people.push(structuredClone(item));
            else if (match.name === item.name || item.name === original?.name || match.name === original?.name) {
                if (match.name === original?.name) match.name = item.name;
                match.marks = [...new Set([...match.marks, ...item.marks])];
                if (!match.period && item.period) match.period = item.period;
            } else book.people.push({ ...structuredClone(item), id: 'person-import-' + action.key + '-' + index });
        }
        book.imports = [...(book.imports || []), action.key];
        return 'saved';
    }

    function confirmed(state) {
        return state.book.deviceRevisions?.[state.device] || 0;
    }

    function project(state) {
        const book = structuredClone(state.book);
        for (const item of state.queue) apply(book, item.action, state.revision);
        return book;
    }

    async function readOrCreateRemote() {
        for (let attempt = 0; attempt < 6; attempt++) {
            const remote = await request();
            if (!/^[0-9a-f]{64}$/.test(remote.account)) throw new Error('База недоступна.');
            needsSignIn = false;
            if (remote.book && !DambaLedger.valid(remote.book)) throw new Error('База недоступна.');
            let book = remote.book ? structuredClone(remote.book) : defaults();
            if (preference(migrationKey) !== 'yes') {
                const previousShared = preference('dambabank-storage-mode') === 'shared';
                const local = !previousShared || !remote.book ? await snapshotDevice().catch(() => null) : null;
                if (local && hasHistory(local)) apply(book, await importAction(local), remote.revision);
                if (remote.book && JSON.stringify(book) === JSON.stringify(remote.book)) { migrated(); return remote; }
            } else if (remote.book) return remote;
            const saved = await request({ account: remote.account, revision: remote.revision, book });
            if (saved) { migrated(); return { account: remote.account, revision: saved.revision, book }; }
        }
        throw new Error('Данные уже изменились. Повторяем синхронизацию.');
    }

    function storeRemote(remote) {
        return cache('readwrite', (store, state) => {
            state ??= { device: crypto.randomUUID(), counter: 0, queue: [], revision: 0 };
            if (remote.revision >= state.revision) {
                Object.assign(state, { book: remote.book, revision: remote.revision });
                const ack = confirmed(state);
                state.queue = state.queue.filter(item => item.counter > ack);
                store.put(state, remote.account);
            }
            store.put(remote.account, 'active');
            return state;
        }, remote.account);
    }

    async function flush() {
        let conflicts = false;
        try {
            if (!navigator.onLine) { network = 'offline'; return; }
            for (let attempt = 0; attempt < 8; attempt++) {
                const remote = await readOrCreateRemote();
                const state = await storeRemote(remote);
                network = 'online';
                if (!state.queue.length) return;
                const book = structuredClone(state.book);
                let batchConflict = false;
                for (const { action } of state.queue) {
                    const result = apply(book, action, state.revision);
                    batchConflict ||= result === 'discarded' || result === 'last-profile';
                }
                const counter = state.queue.at(-1).counter;
                book.deviceRevisions = { ...book.deviceRevisions, [state.device]: counter };
                const saved = await request({ account: remote.account, revision: state.revision, book });
                if (saved) {
                    conflicts ||= batchConflict;
                    await storeRemote({ account: remote.account, revision: saved.revision, book });
                }
            }
        } catch {
            network = needsSignIn ? 'signin' : 'offline';
        } finally {
            if (conflicts) window.dispatchEvent(new Event('dambabank-sync-conflict'));
            notify();
        }
    }

    function sync() {
        if (!available) return Promise.resolve();
        activeSync ||= flush().finally(() => { activeSync = null; });
        return activeSync;
    }

    async function current() {
        if (network === 'unknown' && navigator.onLine) await activeSync;
        if (needsSignIn) throw new Error('Войдите в свой аккаунт для синхронизации.');
        let cached = await cache('readonly', (_store, state, account) => ({ state, account }));
        if (!cached.state) {
            await activeSync;
            cached = await cache('readonly', (_store, state, account) => ({ state, account }));
        }
        if (!cached.state || needsSignIn) throw new Error('Подключитесь к интернету, чтобы открыть общую базу.');
        viewedAccount = cached.account;
        return { book: project(cached.state), pending: cached.state.queue.length, online: network === 'online' && navigator.onLine };
    }

    async function enqueue(action) {
        const account = viewedAccount;
        const result = await cache('readwrite', (store, state, active) => {
            if (needsSignIn || !state || account !== active) throw new Error('Откройте данные своего аккаунта ещё раз.');
            const book = project(state);
            const result = apply(book, action, state.revision);
            if (result === 'discarded') throw new Error('Этот профиль уже удалён.');
            if (result === 'last-profile' || result === 'already-deleted') return result;
            if (!DambaLedger.valid(book) || new TextEncoder().encode(JSON.stringify(book)).byteLength > 1000 * 1024) {
                throw new Error('Слишком много данных для одной базы.');
            }
            state.queue.push({ counter: ++state.counter, action });
            store.put(state, account);
            return result;
        });
        void sync();
        return result;
    }

    async function merge(book) {
        await current();
        return enqueue(await importAction(book));
    }

    return { available, current, change: enqueue, merge, sync };
})();
async function snapshotDevice() {
    const database = await openDatabase();
    const stores = [...database.objectStoreNames];
    let data;
    try { data = await new Promise((resolve, reject) => {
        const tx = database.transaction(stores);
        const reads = stores.map(key => [key, tx.objectStore(key).getAll()]);
        tx.oncomplete = () => resolve(Object.fromEntries(reads.map(([key, query]) => [key, query.result])));
        tx.onabort = () => reject(tx.error);
    });
    } finally { database.close(); }
    const profiles = collectPeople(data.deposits, data.people);
    const people = profiles.map(profile => {
        const old = profile.id === 'person-2' ? data['deposits-person-2'] || []
            : (data['person-deposits'] || []).filter(row => row.personId === profile.id);
        const current = data.deposits.filter(row => row.personId === profile.id).map(row => row.record);
        if (profile.id === 'person-1') current.push(...data.deposits);
        const marks = new Set([...old, ...current].filter(row => recordAmount(row) > 0).map(row => row.id));
        return { ...profile, marks: [...marks] };
    });
    return { people };
}


function downloadBook(book) {
    const data = JSON.stringify({ format: 'dambabank-1', book: { people: book.people } }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'dambabank-' + localToday() + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function openHostedSite() {
    const landing = byId('old-site');
    document.querySelector('main').hidden = true;
    byId('storage-badge').hidden = true;
    document.querySelector('footer').hidden = true;
    landing.hidden = false;
    if (preference(migrationKey) === 'yes') return location.replace(cloudHome);
    let book;
    try { book = await snapshotDevice(); } catch {
        byId('transfer-status').textContent = 'Браузер не разрешил прочитать старые записи. Можно продолжить в облачном Дамбабанке.';
        return;
    }
    if (!hasHistory(book)) return location.replace(cloudHome);
    byId('legacy-export').hidden = false;
    byId('legacy-export').onclick = () => downloadBook(book);
    if (location.origin !== oldOrigin) {
        byId('transfer-status').textContent = 'Скачайте копию старых данных и загрузите её в облачном Дамбабанке.';
        return;
    }
    byId('transfer-status').textContent = 'Здесь остались прежние записи. Откройте Дамбабанк для переноса или скачайте копию.';
    let popup;
    byId('continue-cloud').onclick = event => {
        event.preventDefault();
        popup = window.open(cloudHome, '_blank');
        if (!popup) byId('transfer-status').textContent = 'Разрешите открытие вкладки или скачайте копию для переноса.';
    };
    window.addEventListener('message', event => {
        if (event.origin !== new URL(cloudHome).origin || !popup || event.source !== popup) return;
        if (event.data === 'dambabank-ready') popup.postMessage({ type: 'dambabank-import', book }, event.origin);
        if (event.data === 'dambabank-imported') {
            migrated();
            byId('transfer-status').textContent = 'Записи сохранены в облачной вкладке.';
            byId('continue-cloud').onclick = null;
        }
    });
}

function setupStorageDialog() {
    const dialog = byId('storage-dialog');
    const status = byId('database-message');
    function report(text) { status.textContent = text; status.hidden = !text; }
    for (const id of ['open-storage','storage-badge']) byId(id).onclick = () => { report(''); dialog.showModal(); };
    byId('export-book').onclick = async () => {
        try { downloadBook((await SharedLedger.current()).book); } catch { report('Не удалось скачать данные. Проверьте соединение.'); }
    };
    byId('import-book').onchange = async event => {
        const file = event.target.files[0];
        event.target.value = '';
        if (!file) return;
        try {
            if (file.size > 4 * 1024 * 1024) throw new Error();
            const copy = JSON.parse(await file.text());
            if (copy?.format !== 'dambabank-1') throw new Error();
            await SharedLedger.current();
            await SharedLedger.merge(copy.book);
            await refreshRecords();
            report('Записи из копии сохранены. Они отправятся в общую базу при подключении.');
        } catch { report('Не удалось загрузить копию. Проверьте файл и соединение.'); }
    };
    if (!SharedLedger.available || !window.opener) return;
    const opener = window.opener;
    window.addEventListener('message', async event => {
        if (event.source !== opener || event.origin !== oldOrigin || event.data?.type !== 'dambabank-import') return;
        try {
            await SharedLedger.current();
            await SharedLedger.merge(event.data.book);
            await SharedLedger.sync();
            if ((await SharedLedger.current()).pending) throw new Error('Перенос ожидает синхронизации.');
            await refreshRecords();
            opener.postMessage('dambabank-imported', oldOrigin);
        } catch { message('Не удалось перенести старые записи. Они доступны по прежнему адресу.', true); }
    });
    opener.postMessage('dambabank-ready', oldOrigin);
}
