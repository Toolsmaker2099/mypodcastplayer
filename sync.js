// Couche de synchro des favoris. localStorage = base locale ; worker « sauvegarde » (KV Cloudflare) = sauvegarde distante.
// Aucune progression de lecture n'est stockée ici ni ailleurs.
const Sync = (() => {
  const BASE = 'https://sauvegarde.toolsmaker.workers.dev/v1/podcasts/';
  const FAV_KEY = 'favs.v1', CFG_KEY = 'sync.cfg.v1', VER_KEY = 'sync.ver.v1';
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const cfg = () => load(CFG_KEY, {});          // { code: 'XXXX-XXXX-XXXX-XXXX', proxy: 'https://…' }
  const setCfg = c => save(CFG_KEY, c);
  const favs = () => load(FAV_KEY, []);
  const enabled = () => /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3,7}$/.test((cfg().code || '').toUpperCase());
  const url = () => BASE + cfg().code.toUpperCase();

  function newCode() {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = crypto.getRandomValues(new Uint8Array(16));
    return [0, 4, 8, 12].map(i => [...b.slice(i, i + 4)].map(x => a[x % a.length]).join('')).join('-');
  }
  const merge = (a, b) => { const m = new Map(); [...a, ...b].forEach(f => m.set(f.feedUrl, f)); return [...m.values()]; };

  async function get() {
    const r = await fetch(url(), { cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('Sauvegarde ' + r.status);
    return { data: await r.json(), ver: r.headers.get('X-Sauvegarde-Version') };
  }
  async function put(list, ver) {
    const h = { 'Content-Type': 'application/json' };
    h['X-Sauvegarde-Version'] = ver || 'new';
    const r = await fetch(url(), { method: 'PUT', headers: h, body: JSON.stringify({ favs: list }) });
    if (r.status === 409) return { conflict: true };
    if (!r.ok) throw new Error('Sauvegarde ' + r.status);
    localStorage.setItem(VER_KEY, (await r.json()).version);
    return {};
  }
  // Récupère la version en ligne, fusionne (union par flux) et renvoie le résultat.
  async function pull() {
    if (!enabled()) return favs();
    const remote = await get();
    const merged = remote ? merge(remote.data.favs || [], favs()) : favs();
    save(FAV_KEY, merged);
    if (!remote) await put(merged, null);
    else if (merged.length !== (remote.data.favs || []).length) await put(merged, remote.ver);
    else localStorage.setItem(VER_KEY, remote.ver || '');
    return merged;
  }
  async function push() {
    if (!enabled()) return;
    const r = await put(favs(), localStorage.getItem(VER_KEY) || null);
    if (r.conflict) await pull();
  }
  function setFavs(list) { save(FAV_KEY, list); push().catch(() => {}); }
  return { favs, setFavs, pull, cfg, setCfg, enabled, newCode };
})();
