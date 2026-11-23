'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { plan, parseDate, monthDeposits, recordAmount } = require('./schedule.js');

test('Two deposits apply independently when the 13th is Monday', () => {
    const day = monthDeposits(parseDate('2026-07-01')).find(item => item.date === '2026-07-13');
    assert.deepEqual(day.entries.map(entry => entry.amount), [500, 1000]);
    assert.deepEqual(plan(day.date, day.date), { mondays: 1, thirteenths: 1, total: 1500 });
    assert.equal(recordAmount({ id: day.entries[0].id, date: day.date, rule: 'monday' }), 500);
    assert.equal(recordAmount({ id: day.entries[0].id, date: day.date, rule: 'thirteenth' }), 0);
});

test('Both date boundaries are included across months and years', () => {
    assert.deepEqual(plan('2026-11-01', '2026-11-30'), { mondays: 5, thirteenths: 1, total: 3500 });
    assert.deepEqual(plan('2026-12-14', '2027-01-12'), { mondays: 5, thirteenths: 0, total: 2500 });
    assert.deepEqual(plan('2026-12-13', '2027-01-13'), { mondays: 5, thirteenths: 2, total: 4500 });
    assert.deepEqual(plan('2026-11-28', '2026-11-29'), { mondays: 0, thirteenths: 0, total: 0 });
});

test('Leap days are accepted and invalid or reversed dates rejected', () => {
    assert(parseDate('2028-02-29'));
    assert.equal(parseDate('2026-02-29'), null);
    assert.equal(plan('2028-02-29', '2028-02-13'), null);
    assert.equal(plan('', '2028-02-13'), null);
    assert.equal(plan('2020-02-30', '2028-02-13'), null);
    assert.equal(plan('1900-01-01', '9999-12-31').thirteenths, 8100 * 12);
});
