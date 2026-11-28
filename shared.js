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
    let boot, initialized = false;
    async function request(payload) {
        const options = { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(12000) };
        if (payload) Object.assign(options, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const response = await fetch('./api/ledger', options);
        if (response.status === 409) return null;
        if (response.status === 401 || response.redirected) throw new Error('Откройте сайт и войдите в свой аккаунт.');
        if (response.status === 413 || response.status === 422) throw new Error('Проверьте содержимое и размер копии.');
        if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new Error('Не удалось подключиться к общей базе.');
        return response.json();
    }

    async function merge(source, existing) {
        if (!DambaLedger.valid(source)) throw new Error('В копии некорректные данные.');
        const bytes = new TextEncoder().encode(JSON.stringify(source.people));
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        for (let attempt = 0; attempt < 6; attempt++) {
            const { revision, book } = existing || await request();
            existing = null;
            if (book?.imports?.includes(key)) return;
            const merged = !book || (revision === 1 && !hasHistory(book) && !book.imports?.length && !book.people.some(p => p.period)) ? { people: [] } : book;
            for (const item of source.people) {
                const p = merged.people.find(person => person.id === item.id);
                const original = initialPeople.find(person => person.id === item.id);
                if (!p) merged.people.push(structuredClone(item));
                else if (p.name === item.name || item.name === original?.name || p.name === original?.name) {
                    if (p.name === original?.name) p.name = item.name;
                    p.marks = [...new Set([...p.marks, ...item.marks])];
                    if (!p.period && item.period) p.period = item.period;
                } else merged.people.push({ ...item, id: 'person-' + crypto.randomUUID() });
            }
            merged.imports = [...(merged.imports || []), key];
            if (await request({ revision, book: merged })) return;
        }
        throw new Error('Не удалось завершить перенос. Повторите попытку.');
    }
    async function initialize() {
        const current = await request();
        const done = preference(migrationKey) === 'yes';
        const previousShared = preference('dambabank-storage-mode') === 'shared';
        if (!done && !(previousShared && current.book)) {
            let local;
            try { local = await snapshotDevice(); } catch {
                // Database-only browsers can still save online. Retry legacy access on the next visit.
                if (!current.book) await request({ revision: 0, book: defaults() });
                return;
            }
            if (hasHistory(local)) { await merge(local, current); migrated(); return; }
        }
        if (!current.book) await request({ revision: 0, book: defaults() });
        migrated();
    }
    async function current() {
        if (!initialized) {
            boot ||= initialize().then(() => { initialized = true; }).finally(() => { boot = null; });
            await boot;
        }
        return request();
    }
    async function change(action) {
        for (let attempt = 0; attempt < 5; attempt++) {
            const { book, revision } = await request();
            if (!book) throw new Error('Подключите общую базу.');
            const result = DambaLedger.change(book, action);
            if (result === 'last-profile' || result === 'already-deleted') return result;
            if (await request({ revision, book })) return result;
        }
        throw new Error('Базу сейчас редактируют. Повторите действие.');
    }

    return { available, current, change, merge };
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
            report('Записи из копии сохранены.');
        } catch { report('Не удалось загрузить копию. Проверьте файл и соединение.'); }
    };
    if (!SharedLedger.available || !window.opener) return;
    const opener = window.opener;
    window.addEventListener('message', async event => {
        if (event.source !== opener || event.origin !== oldOrigin || event.data?.type !== 'dambabank-import') return;
        try {
            await SharedLedger.current();
            await SharedLedger.merge(event.data.book);
            await refreshRecords();
            opener.postMessage('dambabank-imported', oldOrigin);
        } catch { message('Не удалось перенести старые записи. Они доступны по прежнему адресу.', true); }
    });
    opener.postMessage('dambabank-ready', oldOrigin);
}
