'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.DAMBABANK_PLAYWRIGHT_MODULE || 'playwright');
const { handleLedger } = require('./ledger-api.mjs');

test('shared database isolates accounts and requires a same-origin write', async () => {
    const { DatabaseSync } = require('node:sqlite');
    const sql = new DatabaseSync(':memory:');
    sql.exec(await fs.readFile(path.join(__dirname,'drizzle/0000_ledgers.sql'),'utf8'));
    const db = { prepare: query => ({ bind: (...args) => ({
        first: () => sql.prepare(query).get(...args), run: () => ({ meta: sql.prepare(query).run(...args) }),
    }) }) };
    const url = 'https://example.test/api/ledger';
    const get = owner => handleLedger(new Request(url), db, owner);
    const write = (revision = 0, origin = 'https://example.test') => handleLedger(new Request(url, {
        method:'PUT', headers: {'Content-Type':'application/json', Origin:origin},
        body: JSON.stringify({ revision, book: {people: [{id:'person-1', name:'Тест', createdAt:0, marks:[]}]}}),
    }), db, 'first');
    assert.equal((await get(null)).status, 401);
    assert.equal((await write(0,'https://other.test')).status, 403);
    assert.equal((await write()).status, 200);
    assert.equal((await write()).status, 409);
    assert.equal((await (await get('first')).json()).revision, 1);
    assert.equal((await (await get('second')).json()).book, null);
    sql.close();
});

test('two devices share imported profiles, retain concurrent marks and survive restart', {timeout: 90000}, async t => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(),'dambabank-ledger-'));
    const port = process.env.DAMBABANK_LEDGER_TEST_PORT || '14073';
    const url = 'http://127.0.0.1:' + port + '/';
    async function start() {
        const server = spawn(process.execPath,[path.join(__dirname,'server.cjs')],{windowsHide:true, env:{...process.env,DAMBABANK_PORT:port,DAMBABANK_DB:path.join(folder,'test.sqlite')}});
        await new Promise((resolve,reject) => {
            server.once('error',reject);
            server.once('exit',code => reject(new Error('Server exited: '+code)));
            server.stdout.on('data',chunk => {if(chunk.toString().includes(url)) resolve();});
        });
        return server;
    }
    let server = await start();
    async function stop() { const done = once(server,'exit'); server.kill(); await done; }
    const browser = await chromium.launch({headless:true, executablePath:process.env.DAMBABANK_CHROME_PATH || undefined});
    t.after(async () => { await browser.close(); if (server.exitCode === null && !server.killed) await stop(); await fs.rm(folder,{recursive:true,force:true}); });
    const phone = await browser.newPage({viewport:{width:360,height:760}});
    const pc = await browser.newPage();
    async function open(page) {
        await page.goto(url);
        await page.waitForFunction(() => !document.querySelector('#add-person').disabled);
        assert.equal(await page.locator('#storage-label').textContent(), 'Общая база');
    }
    const isShared = page => page.waitForFunction(() => document.getElementById('storage-label').textContent === 'Общая база' && !document.getElementById('storage-dialog').open);
    await open(phone);
    const backup = {format:'dambabank-1',book:{people:[{id:'person-1',name:'Семья',createdAt:0,marks:['2026-11-02/monday']}]}};
    await phone.locator('#open-storage').click();
    await phone.locator('#import-book').setInputFiles({name:'family.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
    await phone.getByText('Записи из копии сохранены.').waitFor();
    await phone.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await isShared(phone);
    await open(pc);
    assert.equal(await pc.locator('#connect-database, #use-device').count(), 0);
    await isShared(pc);
    for (const page of [phone,pc]) {
        await page.evaluate(() => selectMonth(SavingsSchedule.parseDate('2026-11-01')));
        assert.equal(await page.locator('#month-saved').textContent(),'500 ₽');
        assert.equal(await page.locator('[data-person="person-1"]').textContent(),'Семья');
    }
    await Promise.all([phone.locator('[data-deposit="2026-11-09/monday"]').click(), pc.locator('[data-deposit="2026-11-13/thirteenth"]').click()]);
    for(const page of [phone,pc]) await page.waitForFunction(() => saving.size === 0);
    await phone.evaluate(() => refreshRecords());
    assert.equal(await phone.locator('#month-saved').textContent(),'2 000 ₽');
    await phone.locator('[data-filter="paid"]').click();
    assert.equal(await phone.locator('[data-deposit]').count(),3);
    await phone.locator('[data-filter="pending"]').click();
    assert.equal(await phone.locator('[data-deposit][aria-pressed="true"]').count(),0);
    await phone.locator('#add-person').click();
    await phone.locator('#person-name').fill('Второй');
    await phone.locator('#save-person-name').click();
    await phone.waitForFunction(() => !document.querySelector('#person-dialog').open);
    await pc.evaluate(() => refreshRecords());
    assert.equal(await pc.locator('[data-person]').count(),2);
    await phone.locator('#delete-person').click();
    await phone.locator('#confirm-delete-person').click();
    await phone.waitForFunction(() => !document.querySelector('#delete-person-dialog').open);
    await pc.locator('#range-start').fill('2026-10-01');
    await pc.locator('#range-start').dispatchEvent('change');
    await pc.evaluate(() => rangeSave);
    await stop();
    server = await start();
    await pc.reload();
    await isShared(pc);
    assert.equal(await pc.locator('#range-start').inputValue(), '2026-10-01');
    await pc.evaluate(() => selectMonth(SavingsSchedule.parseDate('2026-11-01')));
    assert.equal(await pc.locator('[data-person]').count(),1);
    assert.equal(await pc.locator('#month-saved').textContent(),'2 000 ₽');
    assert.equal(await pc.locator('#delete-person').isDisabled(),true);
});
