'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { once } = require('node:events');
const { chromium } = require(process.env.DAMBABANK_PLAYWRIGHT_MODULE || 'playwright');

test('adding, switching and removing people preserves other profiles and payments', { timeout: 90000 }, async t => {
    const port = process.env.DAMBABANK_TEST_PORT || '4072';
    const url = 'http://127.0.0.1:' + port + '/';
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'dambabank-profiles-'));
    const server = spawn(process.execPath, [path.join(__dirname, 'server.cjs')], {
        cwd: __dirname, env: { ...process.env, DAMBABANK_PORT: port, DAMBABANK_DB: path.join(folder, 'test.sqlite') }, windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(async () => {
        const stopped = once(server, 'exit');
        server.kill();
        await stopped;
        await fs.rm(folder, { recursive: true, force: true });
    });
    await new Promise((resolve, reject) => {
        server.on('error', reject);
        server.on('exit', code => reject(new Error('Preview server exited: ' + code)));
        server.stdout.on('data', chunk => { if (chunk.toString().includes(url)) resolve(); });
    });
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.DAMBABANK_CHROME_PATH ? { executablePath: process.env.DAMBABANK_CHROME_PATH } : {}),
    });
    t.after(() => browser.close());
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const text = (selector, value, target = page) => target.waitForFunction(
        ({ selector, value }) => document.querySelector(selector)?.textContent === value, { selector, value });
    const ready = (target = page) => target.waitForFunction(() => document.querySelector('#storage-badge')?.dataset.state === 'ready');
    const november = (target = page) => target.evaluate(() => selectMonth(SavingsSchedule.parseDate('2026-11-01')));
    const select = async id => {
        await page.locator('[data-person="' + id + '"]').click();
        await ready();
    };
    const add = async name => {
        await page.locator('#add-person').click();
        await page.locator('#person-name').fill(name);
        await page.locator('#save-person-name').click();
        await page.waitForFunction(() => !document.querySelector('#person-dialog').open);
        await ready();
        return page.locator('[data-person][aria-pressed="true"]').getAttribute('data-person');
    };
    const removeSelected = async () => {
        await page.locator('#delete-person').click();
        await page.locator('#confirm-delete-person').click();
        await page.waitForFunction(() => !document.querySelector('#delete-person-dialog').open);
        await ready();
    };

    // Keep the old database connection open like a tab running the previous app.
    const oldTab = await context.newPage();
    await oldTab.goto(url + 'icons/icon-192.png');
    await oldTab.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.open('dambabank-savings', 2);
        request.onupgradeneeded = () => {
            for (const name of ['deposits', 'deposits-person-2', 'people']) request.result.createObjectStore(name, { keyPath: 'id' });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(['deposits', 'deposits-person-2', 'people'], 'readwrite');
            tx.objectStore('deposits').put({ id: '2026-11-02/monday', date: '2026-11-02', rule: 'monday' });
            tx.objectStore('deposits-person-2').put({ id: '2026-11-13/thirteenth', date: '2026-11-13', rule: 'thirteenth' });
            tx.objectStore('people').put({ id: 'person-1', name: 'Первый' });
            tx.objectStore('people').put({ id: 'person-2', name: 'Второй' });
            tx.oncomplete = () => { window.oldDatabase = db; resolve(); };
            tx.onabort = () => reject(tx.error);
        };
    }));
    await page.goto(url);
    await page.waitForFunction(() => !document.querySelector('#add-person').disabled, null, { timeout: 5000 });
    await ready();
    await november();
    await text('#month-saved', '500 ₽');
    await select('person-2');
    await text('#month-saved', '1 000 ₽');
    await text('[data-person="person-1"]', 'Первый');
    await text('[data-person="person-2"]', 'Второй');

    const third = await add('Третий');
    await text('#month-saved', '0 ₽');
    await page.locator('[data-deposit="2026-11-02/monday"]').click();
    await text('#month-saved', '500 ₽');
    const fourth = await add('Четвёртый');
    assert.notEqual(third, fourth);
    assert.equal(await page.locator('[data-person]').count(), 4);
    await text('#month-saved', '0 ₽');
    await page.locator('[data-deposit="2026-11-13/thirteenth"]').click();
    await text('#month-saved', '1 000 ₽');
    await select(third);
    await text('#month-saved', '500 ₽');
    await page.locator('#rename-person').click();
    await page.locator('#person-name').fill('Третий переименован');
    await page.locator('#save-person-name').click();
    await text('[data-person="' + third + '"]', 'Третий переименован');
    await page.reload();
    await ready();
    await november();
    assert.equal(await page.locator('[data-person="' + third + '"]').getAttribute('aria-pressed'), 'true');
    await text('#month-saved', '500 ₽');
    await text('#range-saved', '500 ₽');
    assert.deepEqual(await page.locator('[data-person]').allTextContents(), ['Первый', 'Второй', 'Третий переименован', 'Четвёртый']);

    await page.locator('#add-person').click();
    await page.locator('#person-name').fill('   ');
    await page.locator('#save-person-name').click();
    assert.equal(await page.locator('[data-person]').count(), 4);
    await page.locator('#cancel-person-name').click();

    // Adding and switching also propagate to other tabs without changing their selection.
    const other = await context.newPage();
    await other.goto(url);
    await ready(other);
    await november(other);
    const fifth = await add('Пятый');
    await other.waitForFunction(id => Boolean([...document.querySelectorAll('[data-person]')].find(button => button.dataset.person === id)), fifth);
    assert.equal(await other.locator('[data-person="' + third + '"]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-deposit="2026-11-02/monday"]').click();
    await text('#month-saved', '500 ₽');
    await select(fourth);
    await text('#month-saved', '1 000 ₽');
    await page.locator('[data-deposit="2026-11-13/thirteenth"]').click();
    await text('#month-saved', '0 ₽');
    await select(third);
    await text('#month-saved', '500 ₽');

    for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    }
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('#storage-badge[data-sync=offline]');
    assert.equal(await page.locator('#add-person').isEnabled(), true);
    await context.setOffline(false);
    await ready();
    await november();
    await text('#month-saved', '500 ₽');
    await select('person-2');
    await text('#month-saved', '1 000 ₽');
    await page.locator('#delete-person').click();
    await text('#delete-person-name', 'Второй');
    await page.locator('#cancel-delete-person').click();
    await text('#month-saved', '1 000 ₽');
    await removeSelected();
    assert.equal(await page.locator('[data-person="person-2"]').count(), 0);
    await text('#month-saved', '500 ₽');
    assert.equal(await page.evaluate(async () => (await SharedLedger.current()).book.people.some(p => p.id === 'person-2')), false);

    await select(third);
    await removeSelected();
    await other.locator('[data-person="' + third + '"]').waitFor({ state: 'detached' });
    assert.equal(await other.locator('[data-person="person-1"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(async id => (await SharedLedger.current()).book.people.some(p => p.id === id), third), false);

    for (const id of [fourth, fifth]) {
        await select(id);
        await removeSelected();
    }
    await page.reload();
    await ready();
    await november();
    assert.deepEqual(await page.locator('[data-person]').allTextContents(), ['Первый']);
    assert(await page.locator('#delete-person').isDisabled());
    await text('#month-saved', '500 ₽');
    assert.deepEqual(errors, []);
});
