// Couche de synchro des favoris. localStorage = base locale ; worker « sauvegarde » (KV Cloudflare) = sauvegarde distante.
// Aucune progression de lecture n'est stockée ici ni ailleurs.
const Sync = (() => {
  const BASE = 'https://sauvegarde.toolsmaker.workers.dev/v1/podcasts/';
  const FAV_KEY = 'favs.v1', CFG_KEY = 'sync.cfg.v1', VER_KEY = 'sync.ver.v1';
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  // Proxy RSS imposé à tous les utilisateurs (non modifiable). Tant qu'il est vide, on garde l'ancien réglage local éventuel.
  const DEFAULT_PROXY = 'https://rss-proxy.toolsmaker.workers.dev';
  const cfg = () => load(CFG_KEY, {});          // { code: 'XXXX-XXXX-XXXX-XXXX', proxy: 'https://…' }
  const setCfg = c => save(CFG_KEY, c);
  const favs = () => load(FAV_KEY, []);
  // Réglages synchronisés (la clé/secret Podcast Index et l'état du lecteur propre à l'appareil n'en font pas partie).
  const SET_KEYS = ['epprefs.v2', 'skip.v1', 'skipend.v1', 'chain', 'night', 'pi.prefs', 'src', 'apple.genre', 'track.v1', 'lists.v1', 'playlists.v1'], AT_KEY = 'set.at.v1';
  const PROG_KEY = 'prog.v1';
  const rawSet = Storage.prototype.setItem;
  // Progression par épisode : fusion entrée par entrée, la plus récente l'emporte.
  const mergeProg = (a, b) => { const o = {}; [a, b].forEach(m => Object.entries(m || {}).forEach(([u, f]) => { const x = o[u] || (o[u] = {}); Object.entries(f).forEach(([k, v]) => { if (!x[k] || (v.at || 0) > (x[k].at || 0)) x[k] = v; }); })); return o; };
  const settings = () => { const s = {}; SET_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v !== null) s[k] = v; }); return s; };
  const setAt = () => +localStorage.getItem(AT_KEY) || 0;
  function applySettings(s) {
    SET_KEYS.forEach(k => { if (k in s) rawSet.call(localStorage, k, s[k]); else localStorage.removeItem(k); });
    
  }
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
    const r = await fetch(url(), { method: 'PUT', headers: h, body: JSON.stringify({ favs: list, settings: settings(), settingsAt: setAt(), progress: load(PROG_KEY, {}) }) });
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
    const rAt = remote ? +remote.data.settingsAt || 0 : 0, hasR = !!(remote && remote.data.settings);
    const rp = remote ? remote.data.progress || {} : {}, mp = mergeProg(rp, load(PROG_KEY, {}));
    rawSet.call(localStorage, PROG_KEY, JSON.stringify(mp));
    let pushIt = !remote || JSON.stringify(mp) !== JSON.stringify(rp) || merged.length !== (remote.data.favs || []).length;
    if (hasR && rAt > setAt()) { applySettings(remote.data.settings); rawSet.call(localStorage, AT_KEY, String(rAt)); if (Sync.onSettings) Sync.onSettings(); }
    else if (!hasR || setAt() > rAt) pushIt = pushIt || Object.keys(settings()).length > 0;
    if (pushIt) await put(merged, remote ? remote.ver : null);
    else localStorage.setItem(VER_KEY, remote.ver || '');
    return merged;
  }
  async function push() {
    if (!enabled()) return;
    const r = await put(favs(), localStorage.getItem(VER_KEY) || null);
    if (r.conflict) await pull();
  }
  // Tout changement d'un réglage synchronisé est daté puis envoyé (après une courte pause).
  let st = 0;
  const touch = () => { rawSet.call(localStorage, AT_KEY, String(Date.now())); clearTimeout(st); st = setTimeout(() => push().catch(() => {}), 1200); };
  touch.p = cfg().proxy || '';
  let pt = 0;
  Storage.prototype.setItem = function (k, v) { rawSet.call(this, k, v); if (this === localStorage && k === PROG_KEY && !pt) pt = setTimeout(() => { pt = 0; push().catch(() => {}); }, 30000); if (this === localStorage && (SET_KEYS.includes(k) || k === CFG_KEY)) { if (k === CFG_KEY) { const p = (() => { try { return JSON.parse(v).proxy || ''; } catch { return ''; } })(); if (p === (touch.p || '')) return; touch.p = p; } touch(); } };
  function setFavs(list) { save(FAV_KEY, list); push().catch(() => {}); }
  const fmt = v => (v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16).match(/.{1,4}/g) || []).join('-');
  // Crée une nouvelle sauvegarde à partir des favoris locaux.
  async function create() {
    const code = newCode(), c = cfg();
    setCfg({ ...c, code }); localStorage.removeItem(VER_KEY);
    try { await pull(); } catch (e) { setCfg(c); throw e; }
    return code;
  }
  // Récupère une sauvegarde existante (refuse un code inconnu, sans rien créer).
  async function restore(code) {
    const c = cfg();
    setCfg({ ...c, code }); localStorage.removeItem(VER_KEY);
    try {
      if (!(await get())) throw new Error('Code inconnu : aucune sauvegarde trouvée.');
      await pull();
    } catch (e) { setCfg(c); throw e; }
  }
  function leave() { const c = cfg(); delete c.code; setCfg(c); localStorage.removeItem(VER_KEY); }
  return { onSettings: null, proxy: () => (DEFAULT_PROXY || cfg().proxy || '').replace(/\/$/, ''), DEFAULT_PROXY, favs, setFavs, pull, cfg, setCfg, enabled, newCode, fmt, create, restore, leave };
})();
