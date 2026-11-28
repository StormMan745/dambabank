import DambaLedger from './ledger.js';

const maxBytes = 1024 * 1024;
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie' } });

export async function handleLedger(request, db, owner) {
    if (!owner) return json({ error: 'Войдите в Дамбабанк.' }, 401);
    if (request.method === 'GET') {
        const row = await db.prepare('SELECT revision, book FROM ledgers WHERE owner = ?').bind(owner).first();
        return json(row ? { revision: row.revision, book: JSON.parse(row.book) } : { revision: 0, book: null });
    }
    if (request.method !== 'PUT') return json({ error: 'Метод не поддерживается.' }, 405);
    if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: 'Недопустимый источник.' }, 403);
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({}, 415);
    if (Number(request.headers.get('Content-Length')) > maxBytes) return json({}, 413);
    const reader = request.body?.getReader();
    if (!reader) return json({}, 400);
    const chunks = [];
    let size = 0;
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); return json({}, 413); }
        chunks.push(value);
    }
    let payload;
    try { payload = JSON.parse(await new Blob(chunks).text()); } catch { return json({}, 400); }
    if (!Number.isSafeInteger(payload?.revision) || payload.revision < 0 || !DambaLedger.valid(payload.book)) return json({}, 422);
    const { revision, book } = payload;
    const data = JSON.stringify(book);
    const query = revision === 0
        ? db.prepare('INSERT INTO ledgers (owner, revision, book) VALUES (?, 1, ?) ON CONFLICT(owner) DO NOTHING').bind(owner, data)
        : db.prepare('UPDATE ledgers SET book = ?, revision = revision + 1 WHERE owner = ? AND revision = ?').bind(data, owner, revision);
    const result = await query.run();
    return result.meta.changes === 1 ? json({ revision: revision + 1 }) : json({ error: 'Данные уже изменились.' }, 409);
}
