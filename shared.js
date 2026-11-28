'use strict';

const SharedLedger = (() => {
    const available = document.documentElement.dataset.database === 'server';
    let active = false;
    if (available) {
        try { active = localStorage.getItem('dambabank-storage-mode') === 'shared'; } catch { /* Optional preference. */ }
    }
    function choose(shared) {
        active = shared;
        try { localStorage.setItem('dambabank-storage-mode', shared ? 'shared' : 'device'); } catch { /* Optional preference. */ }
    }
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
    async function connect(seed, fromFile) {
        let current = await request();
        if (fromFile && current.book) throw new Error('Общая база уже создана. Файл можно загрузить только при первом подключении.');
        if (!current.book) {
            const book = await seed();
            if (!DambaLedger.valid(book)) throw new Error('В копии некорректные профили или отметки.');
            const created = await request({ revision: 0, book });
            if (!created && fromFile) throw new Error('Общую базу уже создали на другом устройстве.');
        }
        choose(true);
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
    return { available, get active() { return active; }, choose, connect, change, read: request };
})();

async function snapshotDevice() {
    if (!database) throw new Error('База этого устройства недоступна.');
    const stores = [...database.objectStoreNames];
    const data = await new Promise((resolve, reject) => {
        const tx = database.transaction(stores);
        const reads = stores.map(key => [key, tx.objectStore(key).getAll()]);
        tx.oncomplete = () => resolve(Object.fromEntries(reads.map(([key, query]) => [key, query.result])));
        tx.onabort = () => reject(tx.error);
    });
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

function setupStorageDialog() {
    const dialog = byId('storage-dialog');
    let busy = false;
    const report = (text = '') => {
        byId('database-message').textContent = text;
        byId('database-message').hidden = !text;
    };
    function controls() {
        const shared = SharedLedger.active;
        byId('database-explanation').textContent = shared
            ? 'Вы работаете с общей базой. На другом устройстве откройте сайт под тем же аккаунтом. Для изменения данных нужен интернет или соединение с сервером.'
            : SharedLedger.available ? 'Сейчас открыты профили этого устройства. При первом подключении мы скопируем их в общую базу. Если база уже есть, откроются сохранённые в ней профили.'
            : 'Профили сохранены в этом браузере. В облачном Дамбабанке их можно открывать с телефона и компьютера под одним аккаунтом.';
        byId('storage-static').hidden = SharedLedger.available;
        byId('storage-server').hidden = !SharedLedger.available;
        byId('connect-database').hidden = shared;
        byId('import-label').hidden = shared;
        byId('use-device').hidden = !shared;
        for (const id of ['connect-database','use-device','export-book','import-book']) byId(id).disabled = busy;
    }
    for (const id of ['storage-badge','open-storage']) byId(id).addEventListener('click', () => {
        report(); controls(); dialog.showModal();
    });
    async function run(task) {
        if (busy) return;
        busy = true;
        report(); controls();
        try { await task(); } catch (error) {
            report(error instanceof TypeError || error.name === 'TimeoutError' ? 'Проверьте соединение и попробуйте ещё раз.' : error.message);
        } finally { busy = false; controls(); }
    }
    function changed() {
        ready = false;
        records = new Map();
        message('');
        renderMonth();
        return refreshRecords();
    }
    byId('connect-database').addEventListener('click', () => run(async () => {
        await SharedLedger.connect(snapshotDevice, false);
        await changed();
        if (ready) dialog.close();
    }));
    byId('use-device').addEventListener('click', () => run(async () => {
        SharedLedger.choose(false);
        if (!database) await initializeDatabase();
        await changed();
        dialog.close();
    }));
    byId('export-book').addEventListener('click', () => run(async () => {
        const book = SharedLedger.active ? (await SharedLedger.read()).book : await snapshotDevice();
        const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'dambabank-1', book }, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'dambabank-' + localToday() + '.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        report('Копия подготовлена для скачивания.');
    }));
    byId('import-book').addEventListener('change', event => {
        const file = event.target.files[0];
        event.target.value = '';
        if (!file) return;
        run(async () => {
            if (file.size > 4 * 1024 * 1024) throw new Error('Выберите файл копии Дамбабанка до 4 МБ.');
            let backup;
            try { backup = JSON.parse(await file.text()); } catch { throw new Error('Выберите JSON-копию Дамбабанка.'); }
            if (backup?.format !== 'dambabank-1' || !DambaLedger.valid(backup.book)) throw new Error('Этот файл не похож на копию Дамбабанка.');
            await SharedLedger.connect(() => backup.book, true);
            await changed();
            if (ready) dialog.close();
        });
    });
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.querySelector('.dialog-heading').addEventListener('submit', event => { if (busy) event.preventDefault(); });
}
