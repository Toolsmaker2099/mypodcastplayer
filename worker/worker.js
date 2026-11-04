// Worker Cloudflare minimal : proxy CORS pour flux RSS (GET /?url=https://…/feed.xml).
// À déployer séparément du worker « sauvegarde ». ALLOW_ORIGIN (variable) = ex. https://toolsmaker2099.github.io
export default {
  async fetch(req, env) {
    const cors = { 'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'X-Auth-Date, X-Auth-Key, Authorization', 'Vary': 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const u = new URL(req.url);
    // Refuse les appels venant d'un autre site que le tien (si ALLOW_ORIGIN est défini)
    const origin = req.headers.get('Origin');
    if (env.ALLOW_ORIGIN && origin && origin !== env.ALLOW_ORIGIN) return new Response('site non autorisé', { status: 403, headers: cors });
    // Relais Podcast Index (repli si le navigateur ne peut pas l'appeler directement) : /podcastindex/search/byterm?q=…
    if (u.pathname.startsWith('/podcastindex/')) {
      const h = {};
      for (const k of ['X-Auth-Date', 'X-Auth-Key', 'Authorization']) if (req.headers.get(k)) h[k] = req.headers.get(k);
      h['User-Agent'] = 'podcasts-pwa';
      const r = await fetch('https://api.podcastindex.org/api/1.0/' + u.pathname.slice('/podcastindex/'.length) + u.search, { headers: h });
      return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    // Carte de partage (WhatsApp, Instagram…) : /p?add=<flux>&to=<lien de l'app>. Les robots lisent les balises og:*, les personnes sont redirigées vers l'app.
    if (u.pathname === '/p') return share(u, env);
    const target = u.searchParams.get('url');
    if (!/^https?:\/\//.test(target || '')) return new Response('url invalide', { status: 400, headers: cors });
    const r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 podcast-reader' }, cf: { cacheTtl: 300 } });
    return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': r.headers.get('Content-Type') || 'text/xml' } });
  },
};

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tag = (xml, name) => { const m = xml.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>', 'i')); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : ''; };
async function share(u, env) {
  const feed = u.searchParams.get('add') || '', to = u.searchParams.get('to') || '';
  const okTo = /^https:\/\//.test(to) && (!env.ALLOW_ORIGIN || to.startsWith(env.ALLOW_ORIGIN + '/'));
  let title = u.searchParams.get('n') || 'Podcast', desc = 'Podcast à écouter dans l\'app Podcasts.', img = '';
  if (/^https?:\/\//.test(feed)) {
    try {
      const xml = (await (await fetch(feed, { headers: { 'User-Agent': 'Mozilla/5.0 podcast-reader' }, cf: { cacheTtl: 3600 } })).text()).slice(0, 400000);
      const ch = xml.split(/<item[\s>]/i)[0];
      title = tag(ch, 'title') || title; desc = (tag(ch, 'description') || tag(ch, 'itunes:summary') || desc).slice(0, 200);
      img = (ch.match(/<itunes:image[^>]*href=["']([^"']+)["']/i) || ch.match(/<image>[\s\S]*?<url>([^<]+)<\/url>/i) || [])[1] || '';
    } catch {}
  }
  const dest = okTo ? to : '';
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta property="og:type" content="website"><meta property="og:site_name" content="Podcasts"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">${img ? `<meta property="og:image" content="${esc(img)}"><meta name="twitter:image" content="${esc(img)}">` : ''}${dest ? `<meta property="og:url" content="${esc(dest)}">` : ''}
<meta name="twitter:card" content="summary"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui;background:#0b0d14;color:#fff;text-align:center;padding:40px">${img ? `<img src="${esc(img)}" width="160" style="border-radius:16px">` : ''}<h2>${esc(title)}</h2>${dest ? `<p><a style="color:#9bb0ff" href="${esc(dest)}">Ouvrir dans l'app Podcasts</a></p><script>location.replace(${JSON.stringify(dest)})</script>` : ''}</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
