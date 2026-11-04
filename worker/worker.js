// Worker Cloudflare minimal : proxy CORS pour flux RSS (GET /?url=https://…/feed.xml).
// À déployer séparément du worker « sauvegarde ». ALLOW_ORIGIN (variable) = ex. https://toolsmaker2099.github.io
export default {
  async fetch(req, env) {
    const cors = { 'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Vary': 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const target = new URL(req.url).searchParams.get('url');
    if (!/^https?:\/\//.test(target || '')) return new Response('url invalide', { status: 400, headers: cors });
    const r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 podcast-reader' }, cf: { cacheTtl: 300 } });
    return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': r.headers.get('Content-Type') || 'text/xml' } });
  },
};
