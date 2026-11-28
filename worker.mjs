import { handleLedger } from './ledger-api.mjs';
import { assets } from './generated-assets.mjs';

export default {
    async fetch(request, env) {
        const pathname = new URL(request.url).pathname;
        if (pathname === '/api/ledger') return handleLedger(request, env.DB, request.headers.get('oai-authenticated-user-id'));
        if (!['GET','HEAD'].includes(request.method)) return new Response(null, { status: 405 });
        const asset = assets[pathname === '/' ? '/index.html' : pathname];
        if (!Array.isArray(asset)) return new Response(null, { status: 404 });
        const [type, encoded] = asset;
        const bytes = request.method === 'HEAD' ? null : Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
        return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' } });
    }
};
