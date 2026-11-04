// Exemple de worker Cloudflare : proxy CORS pour flux RSS + accès KV.
// Liaisons : KV namespace "FAVS" ; secrets : TOKEN ; variable : ALLOW_ORIGIN (ex. https://toolsmaker2099.github.io)
export default {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(req.url);
    if (req.headers.get('Authorization') !== 'Bearer ' + env.TOKEN) return new Response('unauthorized', { status: 401, headers: cors });
    if (url.pathname === '/proxy') {
      const target = url.searchParams.get('url');
      if (!/^https?:\/\//.test(target || '')) return new Response('bad url', { status: 400, headers: cors });
      const r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 podcast-reader' } });
      return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': r.headers.get('Content-Type') || 'text/xml' } });
    }
    const m = url.pathname.match(/^\/kv\/(.+)$/);
    if (m) {
      const key = decodeURIComponent(m[1]);
      if (req.method === 'PUT') { await env.FAVS.put(key, await req.text()); return new Response('ok', { headers: cors }); }
      const v = await env.FAVS.get(key);
      return v === null ? new Response('nf', { status: 404, headers: cors }) : new Response(v, { headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404, headers: cors });
  },
};
