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
const initialPeople = [
    { id: 'person-1', name: 'Человек 1' },
    { id: 'person-2', name: 'Человек 2' },
];
let people = initialPeople.map(person => ({ ...person }));
let selectedPerson = 'person-1', editingPerson, personToDelete, rememberedPerson;
try {
    rememberedPerson = localStorage.getItem('dambabank-person');
    if (people.some(person => person.id === rememberedPerson)) selectedPerson = rememberedPerson;
} catch { /* Selection still works when browser storage preferences are restricted. */ }
let ready = false, records = new Map(), readVersion = 0;
const saving = new Set();
let paymentFilter = 'all';
let rangeOwner;
let rangeSave = Promise.resolve();
const updates = (() => {
    try {
        return typeof BroadcastChannel === 'function' ? new BroadcastChannel('dambabank-deposits') : null;
    } catch {
        return null;
    }
})();

function setStorage(state, label) {
    byId('storage-badge').dataset.state = state;
    byId('storage-label').textContent = label;
}

function message(text, error = false) {
    const box = byId('save-message');
    delete box.dataset.source;
    box.hidden = !text;
    box.textContent = text;
    box.dataset.error = String(error);
}

function openDatabase() {
    return new Promise((resolve, reject) => {
        // Opening the current version lets this page work while older tabs are still using the database.
        const request = indexedDB.open('dambabank-savings');
        request.onupgradeneeded = () => {
            request.result.createObjectStore('deposits', { keyPath: 'id' });
        };
        request.onsuccess = () => {
            const connection = request.result;
            connection.onversionchange = () => connection.close();
            resolve(connection);
        };
        request.onerror = () => reject(request.error);
    });
}

function collectPeople(entries, legacyNames = []) {
    const profiles = new Map(initialPeople.map(person => [person.id, { ...person, createdAt: 0 }]));
    const names = [...legacyNames, ...entries.filter(entry => entry.profile).map(entry => entry.profile)];
    for (const profile of names) {
        if (typeof profile.id !== 'string' || !profile.id || typeof profile.name !== 'string' || !profile.name.trim()) continue;
        profiles.set(profile.id, {
            id: profile.id,
            name: profile.name.trim().slice(0, 32),
            createdAt: Number.isFinite(profile.createdAt) ? profile.createdAt : 0,
        });
    }
    // A deletion must also hide profiles that older pages used to create automatically.
    for (const entry of entries) {
        if (entry.deletedPersonId) profiles.delete(entry.deletedPersonId);
    }
    return [...profiles.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

async function readCurrent(personId) {
    const { book } = await SharedLedger.current();
    if (!book || !DambaLedger.valid(book)) throw new Error('Общая база недоступна.');
    const profile = book.people.find(person => person.id === personId);
    const rows = (profile?.marks || []).map(id => {
        const [date, rule] = id.split('/');
        return { id, date, rule };
    });
    return { rows, profiles: book.people.map(({ marks, ...person }) => person) };
}

async function refreshRecords() {
    if (!SharedLedger.available) return;
    const version = ++readVersion;
    const personId = selectedPerson;
    try {
        const { rows, profiles } = await readCurrent(personId);
        if (version !== readVersion || personId !== selectedPerson) return;
        people = profiles;
        if (!people.some(person => person.id === personId)) {
            rememberSelection(people[0].id);
            ready = false;
            records = new Map();
            renderMonth();
            return refreshRecords();
        }
        if (rangeOwner !== personId) {
            rangeOwner = personId;
            const range = profiles.find(person => person.id === personId).period || monthRange(month);
            byId('range-start').value = range.from;
            byId('range-end').value = range.to;
        }
        records = new Map(rows.filter(record => recordAmount(record) > 0).map(record => [record.id, record]));
        ready = true;
        setStorage('ready', 'Общая база');
        if (byId('save-message').dataset.source === 'read') message('');
    } catch {
        if (version !== readVersion) return;
        ready = false;
        setStorage('error', 'База недоступна');
        message('Нет связи с базой. Проверьте интернет и повторите попытку.', true);
        byId('save-message').dataset.source = 'read';
    }
    renderMonth();
}

function renderPeople() {
    const list = byId('people-list');
    const buttons = new Map([...list.querySelectorAll('[data-person]')].map(button => [button.dataset.person, button]));
    for (const [id, button] of buttons) {
        if (!people.some(person => person.id === id)) button.remove();
    }
    for (const person of people) {
        let button = buttons.get(person.id);
        if (!button) {
            button = element('button', 'person-button');
            button.type = 'button';
            button.dataset.person = person.id;
            list.append(button);
        }
        if (button.textContent !== person.name) button.textContent = person.name;
        button.setAttribute('aria-pressed', String(person.id === selectedPerson));
        button.disabled = !ready;
    }
    const person = people.find(item => item.id === selectedPerson);
    byId('plan-title').textContent = 'План на месяц · ' + (person?.name || '…');
    byId('range-start').disabled = byId('range-end').disabled = !ready;
    byId('rename-person').disabled = !ready;
    byId('add-person').disabled = !ready;
    const remove = byId('delete-person');
    remove.disabled = !ready || people.length < 2;
    remove.title = ready && people.length < 2 ? 'Оставьте хотя бы одного человека' : '';
}

function rememberSelection(personId) {
    selectedPerson = personId;
    try { localStorage.setItem('dambabank-person', personId); } catch { /* Optional selection memory. */ }
}

function selectPerson(personId) {
    if (personId === selectedPerson || !people.some(person => person.id === personId)) return;
    rememberSelection(personId);
    ready = false;
    records = new Map();
    message('');
    renderMonth();
    refreshRecords();
}

async function savePersonName(event) {
    event.preventDefault();
    const input = byId('person-name');
    const name = input.value.trim();
    input.setCustomValidity(name ? '' : 'Введите имя.');
    if (!input.reportValidity()) return;
    const adding = !editingPerson;
    const personId = editingPerson || 'person-' + (crypto.randomUUID?.()
        || [...crypto.getRandomValues(new Uint32Array(4))].map(value => value.toString(16)).join('-'));
    const profile = { id: personId, name, createdAt: adding ? Date.now() : people.find(person => person.id === personId)?.createdAt || 0 };
    const button = byId('save-person-name');
    if (button.disabled || !ready) return;
    button.disabled = true;
    byId('person-name-error').hidden = true;
    try {
        await SharedLedger.change({ type: adding ? 'add' : 'rename', id: personId, profile, name });
        if (adding) {
            people.push(profile);
            selectPerson(personId);
        } else {
            const person = people.find(item => item.id === personId);
            if (person) Object.assign(person, profile);
            renderPeople();
        }
        updates?.postMessage({ type: 'person' });
        byId('person-dialog').close();
    } catch {
        byId('person-name-error').textContent = adding ? 'Не удалось добавить человека. Попробуйте ещё раз.' : 'Не удалось сохранить имя. Попробуйте ещё раз.';
        byId('person-name-error').hidden = false;
    } finally {
        button.disabled = false;
    }
}

async function deletePerson(event) {
    event.preventDefault();
    const button = byId('confirm-delete-person');
    const cancel = byId('cancel-delete-person');
    const error = byId('delete-person-error');
    if (button.disabled || !personToDelete || !ready) return;
    button.disabled = true;
    cancel.disabled = true;
    error.hidden = true;
    try {
        const outcome = await SharedLedger.change({ type: 'delete', id: personToDelete });
        await refreshRecords();
        if (outcome === 'last-profile') {
            error.textContent = 'Оставьте хотя бы одного человека.';
            error.hidden = false;
            return;
        }
        updates?.postMessage({ type: 'person' });
        byId('delete-person-dialog').close();
        byId('people-list').querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
    } catch {
        error.textContent = 'Не удалось удалить человека. Попробуйте ещё раз.';
        error.hidden = false;
    } finally {
        button.disabled = false;
        cancel.disabled = false;
    }
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
    const saved = savedBetween(from, to);
    byId('range-saved').textContent = ready ? money(saved) : '—';
    byId('range-left').textContent = ready ? money(forecast.total - saved) : '—';
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

async function toggleDeposit(entry, date) {
    const personId = selectedPerson;
    const savingKey = personId + ':' + entry.id;
    if (!ready || saving.has(savingKey)) return;
    const record = records.has(entry.id) ? null : { id: entry.id, date, rule: entry.key };
    saving.add(savingKey);
    message('');
    const button = [...byId('deposit-list').querySelectorAll('button')].find(node => node.dataset.deposit === entry.id);
    button?.setAttribute('aria-busy', 'true');
    try {
        await SharedLedger.change({ type: 'mark', id: personId, mark: entry.id, marked: Boolean(record) });
        updates?.postMessage({ type: 'deposit', personId });
        if (personId === selectedPerson) await refreshRecords();
    } catch {
        if (personId === selectedPerson) message('Не удалось подтвердить сохранение отметки. Проверьте соединение и обновите данные.', true);
    } finally {
        saving.delete(savingKey);
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
        if (saving.has(selectedPerson + ':' + entry.id)) button.setAttribute('aria-busy', 'true');
        button.setAttribute('aria-pressed', String(marked));
        button.setAttribute('aria-label', (marked ? 'Отменить отметку о переводе' : 'Отметить перевод') + ' ' + money(entry.amount) + ' от мамы за ' + shortDate.format(date) + ' — ' + entry.label);
        const personId = selectedPerson;
        button.addEventListener('click', () => {
            if (personId === selectedPerson) toggleDeposit(entry, day.date);
        });
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
    renderPeople();
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
    const nextAmount = upcoming?.entries.reduce((sum, entry) => sum + (records.has(entry.id) ? 0 : entry.amount), 0);
    byId('next-deposit').textContent = upcoming && ready ? 'Ближайшая · ' + shortDate.format(parseDate(upcoming.date)) + ' · ' + money(nextAmount) : '';
    byId('previous-month').disabled = from === '1900-01-01';
    byId('next-month').disabled = to === '9999-12-31';

    const focused = document.activeElement?.dataset.deposit;
    const list = byId('deposit-list');
    const visible = days.map(day => ({ ...day, entries: day.entries.filter(entry =>
        paymentFilter === 'all' || (ready && records.has(entry.id) === (paymentFilter === 'paid'))) })).filter(day => day.entries.length);
    list.replaceChildren(...visible.map(day => createDay(day, today)));
    byId('empty-list').hidden = visible.length > 0 || !ready;
    byId('empty-list').textContent = paymentFilter === 'paid' ? 'За этот месяц ещё нет отмеченных переводов.' : 'Все выплаты за месяц переведены.';
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
for (const id of ['range-start', 'range-end']) {
    byId(id).addEventListener('input', renderForecast);
    byId(id).addEventListener('change', () => {
        const period = { from: byId('range-start').value, to: byId('range-end').value };
        if (!ready || !plan(period.from, period.to)) return;
        const personId = selectedPerson;
        rangeSave = rangeSave.then(() => SharedLedger.change({ type: 'period', id: personId, period }))
            .catch(() => message('Период не сохранён. Проверьте соединение и повторите ввод.', true));
    });
}
byId('people-list').addEventListener('click', event => {
    const button = event.target.closest('[data-person]');
    if (button && !button.disabled) selectPerson(button.dataset.person);
});
function openPersonDialog(personId = null) {
    editingPerson = personId;
    byId('person-dialog-title').textContent = personId ? 'Изменить имя' : 'Добавить человека';
    byId('save-person-name').textContent = personId ? 'Сохранить' : 'Добавить';
    byId('person-name').value = personId ? people.find(person => person.id === personId).name : '';
    byId('person-name').setCustomValidity('');
    byId('person-name-error').hidden = true;
    byId('person-dialog').showModal();
    byId('person-name').focus();
    byId('person-name').select();
}
byId('rename-person').addEventListener('click', () => openPersonDialog(selectedPerson));
byId('add-person').addEventListener('click', () => openPersonDialog());
byId('person-name').addEventListener('input', () => byId('person-name').setCustomValidity(''));
byId('person-name-form').addEventListener('submit', savePersonName);
byId('cancel-person-name').addEventListener('click', () => byId('person-dialog').close());
byId('delete-person').addEventListener('click', () => {
    const person = people.find(item => item.id === selectedPerson);
    if (!ready || !person || people.length < 2) return;
    personToDelete = person.id;
    byId('delete-person-name').textContent = person.name;
    byId('delete-person-error').hidden = true;
    byId('delete-person-dialog').showModal();
});
byId('delete-person-form').addEventListener('submit', deletePerson);
byId('cancel-delete-person').addEventListener('click', () => byId('delete-person-dialog').close());
byId('delete-person-dialog').addEventListener('cancel', event => {
    if (byId('confirm-delete-person').disabled) event.preventDefault();
});
updates?.addEventListener('message', event => {
    if (event.data?.type !== 'deposit' || event.data.personId === selectedPerson) refreshRecords();
});
window.addEventListener('focus', refreshRecords);

document.querySelector('.payment-filters').addEventListener('click', event => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    paymentFilter = button.dataset.filter;
    for (const item of document.querySelectorAll('[data-filter]')) item.setAttribute('aria-pressed', String(item === button));
    renderMonth();
});
setupStorageDialog();
window.addEventListener('online', refreshRecords);
setInterval(() => {
    if (!document.hidden && !saving.size && !document.querySelector('dialog[open]')) refreshRecords();
}, 20000);
selectMonth(month);
if (SharedLedger.available) {
    if (rememberedPerson) selectedPerson = rememberedPerson;
    refreshRecords();
} else openHostedSite();

if (window.isSecureContext && /^https?:$/.test(location.protocol) && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
}
