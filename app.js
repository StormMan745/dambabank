'use strict';

const { parseDate, localToday, monthRange, plan, monthDeposits, recordAmount } = SavingsSchedule;
const byId = id => document.getElementById(id);
const numbers = new Intl.NumberFormat('ru-RU');
const money = amount => numbers.format(amount) + '\u00a0₽';
const monthNames = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const dayName = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' });
const plural = new Intl.PluralRules('ru-RU');

let month = parseDate(localToday());
let database, ready = false, records = new Map(), readVersion = 0;
const saving = new Set();
const updates = typeof BroadcastChannel === 'function' ? new BroadcastChannel('dambabank-deposits') : null;

function setStorage(state, label) {
    byId('storage-badge').dataset.state = state;
    byId('storage-label').textContent = label;
}

function message(text, error = false) {
    const box = byId('save-message');
    box.hidden = !text;
    box.textContent = text;
    box.dataset.error = String(error);
}

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('dambabank-savings', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('deposits', { keyPath: 'id' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Database upgrade blocked'));
    });
}

function readDeposits() {
    return new Promise((resolve, reject) => {
        const request = database.transaction('deposits').objectStore('deposits').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function writeDeposit(id, record) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction('deposits', 'readwrite');
        const store = transaction.objectStore('deposits');
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error || new Error('Write aborted'));
        if (record) store.put(record);
        else store.delete(id);
    });
}

async function refreshRecords() {
    if (!database) return;
    const version = ++readVersion;
    try {
        const rows = await readDeposits();
        if (version !== readVersion) return;
        records = new Map(rows.filter(record => recordAmount(record) > 0).map(record => [record.id, record]));
        ready = true;
        setStorage('ready', 'База на устройстве');
    } catch {
        if (version !== readVersion) return;
        ready = false;
        setStorage('error', 'База недоступна');
        message('Не удалось открыть отметки. Попробуйте открыть страницу в обычном окне браузера.', true);
    }
    renderMonth();
}

function savedBetween(from, to) {
    let total = 0;
    for (const record of records.values()) {
        if (record.date >= from && record.date <= to) total += recordAmount(record);
    }
    return total;
}

function renderForecast() {
    const from = byId('range-start').value, to = byId('range-end').value;
    const forecast = plan(from, to);
    const error = byId('range-error');
    error.hidden = Boolean(forecast);
    byId('forecast-result').hidden = !forecast;
    if (!forecast) {
        error.textContent = !parseDate(from) || !parseDate(to)
            ? 'Выберите обе даты с 1900 по 9999 год.'
            : 'Дата окончания должна быть позже даты начала или совпадать с ней.';
        return;
    }
    byId('range-total').textContent = money(forecast.total);
    byId('range-mondays').textContent = forecast.mondays + ' × 500 ₽';
    byId('range-thirteenths').textContent = forecast.thirteenths + ' × 1 000 ₽';
    byId('range-saved').textContent = ready ? money(savedBetween(from, to)) : '—';
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

async function toggleDeposit(entry, date) {
    if (!ready || saving.has(entry.id)) return;
    const record = records.has(entry.id) ? null : { id: entry.id, date, rule: entry.key };
    saving.add(entry.id);
    message('');
    const button = [...byId('deposit-list').querySelectorAll('button')].find(node => node.dataset.deposit === entry.id);
    button?.setAttribute('aria-busy', 'true');
    try {
        await writeDeposit(entry.id, record);
        ++readVersion;
        if (record) records.set(entry.id, record);
        else records.delete(entry.id);
        updates?.postMessage('saved');
    } catch {
        message('Не удалось сохранить отметку. Проверьте доступное место и попробуйте ещё раз.', true);
    } finally {
        saving.delete(entry.id);
        renderMonth();
    }
}

function createDay(day, today) {
    const date = parseDate(day.date);
    const row = element('li', 'deposit-day');
    const dateBadge = element('time', 'date-badge');
    dateBadge.dateTime = day.date;
    dateBadge.append(element('strong', '', String(date.getUTCDate())), element('span', '', dayName.format(date)));
    const details = element('div', 'day-details');
    const heading = day.date === today ? shortDate.format(date) + ' · сегодня' : shortDate.format(date);
    details.append(element('h3', '', heading));

    for (const entry of day.entries) {
        const marked = records.has(entry.id);
        const line = element('div', 'deposit-line');
        const category = element('span', 'deposit-category');
        category.append(element('span', 'rule-dot ' + entry.key + '-dot'), element('span', '', entry.label));
        const amount = element('strong', 'deposit-amount', money(entry.amount));
        const button = element('button', 'mark-button', marked ? 'Переведено' : 'Отметить');
        button.type = 'button';
        button.dataset.deposit = entry.id;
        button.disabled = !ready;
        if (saving.has(entry.id)) button.setAttribute('aria-busy', 'true');
        button.setAttribute('aria-pressed', String(marked));
        button.setAttribute('aria-label', (marked ? 'Отменить отметку о переводе' : 'Отметить перевод') + ' ' + money(entry.amount) + ' от мамы за ' + shortDate.format(date) + ' — ' + entry.label);
        button.addEventListener('click', () => toggleDeposit(entry, day.date));
        line.append(category, amount, button);
        details.append(line);
    }
    if (day.entries.length > 1) {
        const total = day.entries.reduce((sum, entry) => sum + entry.amount, 0);
        details.append(element('p', 'coincidence-total', 'Всего за день ' + money(total)));
    }

    row.append(dateBadge, details);
    return row;
}

function renderMonth() {
    const today = localToday();
    const { from, to } = monthRange(month);
    const planned = plan(from, to);
    const days = monthDeposits(month);
    const saved = savedBetween(from, to), percent = Math.round(100 * saved / planned.total);
    const title = monthNames.format(month).replace(/\s*г\.$/u, '');
    byId('month-label').textContent = title[0].toUpperCase() + title.slice(1);
    byId('month-planned').textContent = money(planned.total);
    const count = planned.mondays + planned.thirteenths;
    const term = { one: 'выплата', few: 'выплаты', many: 'выплат', other: 'выплаты' }[plural.select(count)];
    byId('month-count').textContent = count + ' ' + term + ' по графику';
    byId('month-saved').textContent = ready ? money(saved) : '—';
    byId('month-progress').value = percent;
    byId('month-percent').textContent = ready ? percent + '%' : '—';
    byId('month-remaining').textContent = !ready ? 'Ожидаю данные' : saved === planned.total
        ? 'Все выплаты переведены' : 'Осталось перевести ' + money(planned.total - saved);

    const upcoming = days.find(day => day.date >= today && day.entries.some(entry => !records.has(entry.id)));
    byId('next-deposit').textContent = upcoming && ready ? 'Ближайшая — ' + shortDate.format(parseDate(upcoming.date)) : '';
    byId('previous-month').disabled = from === '1900-01-01';
    byId('next-month').disabled = to === '9999-12-31';

    const focused = document.activeElement?.dataset.deposit;
    const list = byId('deposit-list');
    list.replaceChildren(...days.map(day => createDay(day, today)));
    if (focused) {
        [...list.querySelectorAll('button')].find(button => button.dataset.deposit === focused)?.focus({ preventScroll: true });
    }
    renderForecast();
}

function selectMonth(date) {
    month = date;
    const dates = monthRange(month);
    byId('range-start').value = dates.from;
    byId('range-end').value = dates.to;
    message('');
    renderMonth();
}

byId('previous-month').addEventListener('click', () => selectMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1))));
byId('next-month').addEventListener('click', () => selectMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1))));
byId('current-month').addEventListener('click', () => selectMonth(parseDate(localToday())));
for (const id of ['range-start', 'range-end']) byId(id).addEventListener('input', renderForecast);
updates?.addEventListener('message', refreshRecords);
window.addEventListener('focus', refreshRecords);

selectMonth(month);
openDatabase().then(async connection => {
    database = connection;
    await refreshRecords();
}).catch(() => {
    setStorage('error', 'База недоступна');
    message('Браузер не разрешил открыть локальную базу. Откройте калькулятор в обычном окне Chrome или Edge.', true);
});

if (window.isSecureContext && /^https?:$/.test(location.protocol) && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
}
