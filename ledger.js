'use strict';

const DambaLedger = (() => {
    function validMark(id) {
        if (typeof id !== 'string') return false;
        const [date, rule] = id.split('/');
        const day = /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(date + 'T00:00:00Z');
        return day && Number.isFinite(+day) && date >= '1900-01-01' && day.toISOString().slice(0, 10) === date
            && id === date + '/' + rule && ((rule === 'monday' && day.getUTCDay() === 1) || (rule === 'thirteenth' && day.getUTCDate() === 13));
    }

    function valid(book) {
        if (!Array.isArray(book?.people) || !book.people.length || book.people.length > 500) return false;
        const ids = new Set();
        return book.people.every(person => {
            if (!person || typeof person.id !== 'string' || !/^person-[a-z0-9-]{1,80}$/i.test(person.id) || ids.has(person.id)) return false;
            ids.add(person.id);
            return typeof person.name === 'string' && person.name.trim().length > 0 && person.name.length <= 32
                && Number.isSafeInteger(person.createdAt) && person.createdAt >= 0 && Array.isArray(person.marks)
                && person.marks.every(validMark) && new Set(person.marks).size === person.marks.length;
        });
    }

    function change(book, action) {
        const person = book.people.find(item => item.id === action.id);
        if (action.type === 'add') {
            if (!person) book.people.push({ ...action.profile, marks: [] });
        } else if (action.type === 'delete') {
            if (!person) return 'already-deleted';
            if (book.people.length === 1) return 'last-profile';
            book.people = book.people.filter(item => item.id !== person.id);
            return 'deleted';
        } else {
            if (!person) throw new Error('Этот профиль уже удалён на другом устройстве.');
            if (action.type === 'rename') person.name = action.name;
            if (action.type === 'mark') {
                const marks = new Set(person.marks);
                if (action.marked) marks.add(action.mark);
                else marks.delete(action.mark);
                person.marks = [...marks];
            }
        }
        return 'saved';
    }
    return { valid, change };
})();
if (typeof module !== 'undefined') module.exports = DambaLedger;
