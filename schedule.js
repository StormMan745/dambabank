'use strict';

const SavingsSchedule = (() => {
    const dayMs = 86_400_000;
    const rules = [
        { key: 'monday', amount: 500, label: 'Понедельник', applies: date => date.getUTCDay() === 1 },
        { key: 'thirteenth', amount: 1_000, label: '13-е число', applies: date => date.getUTCDate() === 13 },
    ];
    const dateKey = date => date.toISOString().slice(0, 10);

    function parseDate(key) {
        if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key) || Number(key.slice(0, 4)) < 1900) return null;
        const date = new Date(key + 'T00:00:00Z');
        return Number.isFinite(date.valueOf()) && dateKey(date) === key ? date : null;
    }

    function localToday(now = new Date()) {
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return now.getFullYear() + '-' + month + '-' + day;
    }

    function monthRange(month) {
        const year = month.getUTCFullYear();
        const index = month.getUTCMonth();
        return { from: dateKey(new Date(Date.UTC(year, index, 1))), to: dateKey(new Date(Date.UTC(year, index + 1, 0))) };
    }

    function plan(from, to) {
        const start = parseDate(from), end = parseDate(to);
        if (!start || !end || start > end) return null;

        const days = (end - start) / dayMs;
        const untilMonday = (8 - start.getUTCDay()) % 7;
        const mondays = days < untilMonday ? 0 : 1 + Math.floor((days - untilMonday) / 7);
        const startMonth = start.getUTCFullYear() * 12 + start.getUTCMonth();
        const endMonth = end.getUTCFullYear() * 12 + end.getUTCMonth();
        const thirteenths = Math.max(0, endMonth - startMonth + 1
            - Number(start.getUTCDate() > 13) - Number(end.getUTCDate() < 13));

        return { mondays, thirteenths, total: mondays * rules[0].amount + thirteenths * rules[1].amount };
    }

    function monthDeposits(month) {
        const { from, to } = monthRange(month);
        const days = [];
        for (let day = 1; day <= Number(to.slice(8)); day++) {
            const key = from.slice(0, 8) + String(day).padStart(2, '0');
            const date = parseDate(key);
            const entries = rules.filter(rule => rule.applies(date)).map(rule => ({
                id: key + '/' + rule.key, key: rule.key, amount: rule.amount, label: rule.label,
            }));
            if (entries.length) days.push({ date: key, entries });
        }
        return days;
    }

    function recordAmount(record) {
        const date = parseDate(record?.date);
        const rule = rules.find(item => item.key === record?.rule);
        return date && rule && rule.applies(date) && record.id === record.date + '/' + rule.key ? rule.amount : 0;
    }

    return Object.freeze({ parseDate, localToday, monthRange, plan, monthDeposits, recordAmount });
})();

if (typeof module !== 'undefined') module.exports = SavingsSchedule;
