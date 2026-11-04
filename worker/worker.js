// Worker Cloudflare minimal : proxy CORS pour flux RSS (GET /?url=https://…/feed.xml).
// À déployer séparément du worker « sauvegarde ». ALLOW_ORIGIN (variable) = ex. https://toolsmaker2099.github.io
export default {
  async fetch(req, env) {
    const cors = { 'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'X-Auth-Date, X-Auth-Key, Authorization', 'Vary': 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const u = new URL(req.url);
    // Relais Podcast Index (repli si le navigateur ne peut pas l'appeler directement) : /podcastindex/search/byterm?q=…
    if (u.pathname.startsWith('/podcastindex/')) {
      const h = {};
      for (const k of ['X-Auth-Date', 'X-Auth-Key', 'Authorization']) if (req.headers.get(k)) h[k] = req.headers.get(k);
      h['User-Agent'] = 'podcasts-pwa';
      const r = await fetch('https://api.podcastindex.org/api/1.0/' + u.pathname.slice('/podcastindex/'.length) + u.search, { headers: h });
      return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    const target = u.searchParams.get('url');
    if (!/^https?:\/\//.test(target || '')) return new Response('url invalide', { status: 400, headers: cors });
    const r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 podcast-reader' }, cf: { cacheTtl: 300 } });
    return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': r.headers.get('Content-Type') || 'text/xml' } });
  },
};
