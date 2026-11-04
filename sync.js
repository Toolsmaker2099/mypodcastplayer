// Couche de synchro des favoris. localStorage = base locale ; Cloudflare KV (via worker) = sauvegarde distante.
// Aucune progression de lecture n'est stockée ici ni ailleurs.
const Sync = (() => {
  const FAV_KEY = 'favs.v1', CFG_KEY = 'sync.cfg.v1';
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  // cfg: { url: 'https://worker...', key: 'ma-cle', token: '...' }
  // À ADAPTER selon le worker de Tom (format de clé / auth) : seulement remote* ci-dessous.
  const cfg = () => load(CFG_KEY, {});
  const setCfg = c => save(CFG_KEY, c);
  const favs = () => load(FAV_KEY, []);
  const enabled = () => { const c = cfg(); return !!(c.url && c.key); };

  const headers = c => ({ 'Content-Type': 'application/json', ...(c.token ? { Authorization: 'Bearer ' + c.token } : {}) });
  async function remoteGet(c) {
    const r = await fetch(`${c.url.replace(/\/$/, '')}/kv/${encodeURIComponent(c.key)}`, { headers: headers(c) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('KV GET ' + r.status);
    return r.json();
  }
  async function remotePut(c, data) {
    const r = await fetch(`${c.url.replace(/\/$/, '')}/kv/${encodeURIComponent(c.key)}`, { method: 'PUT', headers: headers(c), body: JSON.stringify(data) });
    if (!r.ok) throw new Error('KV PUT ' + r.status);
  }

  async function push() { if (enabled()) await remotePut(cfg(), { favs: favs(), t: Date.now() }); }
  function setFavs(list) { save(FAV_KEY, list); push().catch(() => {}); }
  async function pull() { // fusion par feedUrl, union locale + distante
    if (!enabled()) return favs();
    const remote = await remoteGet(cfg());
    if (!remote) { await push(); return favs(); }
    const map = new Map();
    [...(remote.favs || []), ...favs()].forEach(f => map.set(f.feedUrl, f));
    const merged = [...map.values()];
    save(FAV_KEY, merged);
    if (merged.length !== (remote.favs || []).length) await push();
    return merged;
  }
  return { favs, setFavs, pull, cfg, setCfg, enabled };
})();
