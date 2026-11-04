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
  // ---------- Synchro v2 : chaque élément (podcast favori, liste, playlist, réglage par podcast…) est daté séparément ----------
  // Fusion élément par élément : le plus récent l'emporte, les suppressions sont propagées (pierres tombales), rien n'est perdu quand deux appareils modifient des choses différentes.
  const KIND = {
    'favs.v1': 'favs', 'lists.v1': 'lists', 'playlists.v1': 'pls',
    'epprefs.v2': 'map', 'skip.v1': 'map', 'skipend.v1': 'map', 'track.v1': 'map', 'rate.v1': 'map', 'silence.v1': 'map', 'seen.v1': 'map', 'dl.auto.v1': 'map', 'pi.prefs': 'map',
    'chain': 'whole', 'night': 'whole', 'src': 'whole', 'apple.genre': 'whole', 'queue.v1': 'whole', 'sleep.fade': 'whole',
  };
  const SET_KEYS = Object.keys(KIND), LEGACY_AT = 'set.at.v1', META_KEY = 'sync.meta.v2', PROG_KEY = 'prog.v1';
  const rawSet = Storage.prototype.setItem, rawDel = Storage.prototype.removeItem;
  const mergeProg = (a, b) => { const o = {}; [a, b].forEach(m => Object.entries(m || {}).forEach(([u, f]) => { const x = o[u] || (o[u] = {}); Object.entries(f).forEach(([k, v]) => { if (!x[k] || (v.at || 0) > (x[k].at || 0)) x[k] = v; }); })); return o; };
  const jp = (raw, d) => { try { const v = JSON.parse(raw); return v == null ? d : v; } catch { return d; } };
  // Contenu d'une clé locale sous forme d'éléments { sous-clé: valeur }.
  function entriesOf(key, raw = localStorage.getItem(key)) {
    if (raw === null || raw === undefined) return {};
    const k = KIND[key], o = {};
    if (k === 'whole') { o[''] = raw; return o; }
    const v = jp(raw, null); if (v === null) return o;
    if (k === 'map') { if (typeof v === 'object' && !Array.isArray(v)) Object.entries(v).forEach(([a, b]) => { o[a] = b; }); }
    else if (k === 'favs') { (Array.isArray(v) ? v : []).forEach(f => { if (f && f.feedUrl) o[f.feedUrl] = f; }); }
    else if (k === 'pls') { (Array.isArray(v) ? v : []).forEach(p => { if (p && p.id) o[p.id] = p; }); }
    else if (k === 'lists') {
      (v.lists || []).forEach(l => { o['L:' + l.id] = l; });
      Object.entries(v.members || {}).forEach(([u, ids]) => { o['M:' + u] = ids; });
      Object.entries(v.pods || {}).forEach(([u, p]) => { o['P:' + u] = p; });
    }
    return o;
  }
  // Les fiches (métadonnées) de podcast se mettent à jour d'elles-mêmes : seule l'identité compte pour détecter un vrai changement.
  const hashOf = (key, sub, val) => { const k = KIND[key]; if (k === 'favs') return val.feedUrl; if (k === 'lists' && sub[0] === 'P') return 'p'; return JSON.stringify(val); };
  // Reconstruit une clé locale à partir des éléments non supprimés (triés par ordre de création).
  function writeKey(key, ents) { // ents : [[sous-clé, valeur], …]
    const k = KIND[key];
    if (k === 'whole') { const e = ents.find(x => x[0] === ''); if (e) rawSet.call(localStorage, key, e[1]); else rawDel.call(localStorage, key); return; }
    let out;
    if (k === 'map') { out = {}; ents.forEach(([a, b]) => { out[a] = b; }); }
    else if (k === 'favs' || k === 'pls') out = ents.map(x => x[1]);
    else { out = { lists: [], members: {}, pods: {} }; ents.forEach(([a, b]) => { if (a[0] === 'L') out.lists.push(b); else if (a[0] === 'M') out.members[a.slice(2)] = b; else out.pods[a.slice(2)] = b; }); }
    rawSet.call(localStorage, key, JSON.stringify(out));
  }
  let meta = jp(localStorage.getItem(META_KEY), null);
  const boot = !meta; if (boot) meta = {};
  const saveMeta = () => rawSet.call(localStorage, META_KEY, JSON.stringify(meta));
  const idOf = (key, sub) => key + '|' + sub, keyOf = id => id.slice(0, id.indexOf('|')), subOf = id => id.slice(id.indexOf('|') + 1);
  // Change local : compare avec les dates connues ; renvoie true si quelque chose a vraiment changé.
  function reconcile(key, at) {
    const cur = entriesOf(key), now = at == null ? Date.now() : at; let changed = false, i = 0;
    for (const [sub, val] of Object.entries(cur)) {
      const id = idOf(key, sub), h = hashOf(key, sub, val), m = meta[id];
      if (!m) { meta[id] = { at: now, h, c: at == null ? now + i / 1000 : i }; changed = true; }
      else if (m.del || m.h !== h) { meta[id] = { ...m, at: now, h, del: false }; changed = true; }
      i++;
    }
    for (const id of Object.keys(meta)) if (keyOf(id) === key && !(subOf(id) in cur) && !meta[id].del) { meta[id] = { ...meta[id], at: now, del: true }; changed = true; }
    if (changed) saveMeta();
    return changed;
  }
  if (boot) { const at = +localStorage.getItem(LEGACY_AT) || 0; SET_KEYS.forEach(k => reconcile(k, k === 'favs.v1' ? 0 : at)); saveMeta(); }
  // Document envoyé au serveur.
  function buildDoc() {
    const ent = {}; let maxAt = 0;
    SET_KEYS.forEach(key => { const cur = entriesOf(key); Object.entries(cur).forEach(([sub, v]) => { const m = meta[idOf(key, sub)]; if (m) { ent[idOf(key, sub)] = { v, at: m.at, h: m.h, c: m.c }; if (m.at > maxAt) maxAt = m.at; } }); });
    Object.entries(meta).forEach(([id, m]) => { if (m.del) ent[id] = { del: true, at: m.at, h: m.h, c: m.c }; });
    const settings = {}; SET_KEYS.forEach(k => { if (KIND[k] !== 'favs') { const v = localStorage.getItem(k); if (v !== null) settings[k] = v; } });
    return { v: 2, ent, favs: favs(), settings, settingsAt: maxAt, progress: load(PROG_KEY, {}) }; // champs historiques conservés pour les anciennes versions de l'app
  }
  // Ancien format (avant la v2) → éléments.
  function legacyEnt(d) {
    const ent = {}, at = +d.settingsAt || 0; let c = 0;
    Object.entries(d.settings || {}).forEach(([k, raw]) => { if (!KIND[k]) return; Object.entries(entriesOf(k, raw)).forEach(([sub, v]) => { ent[idOf(k, sub)] = { v, at, h: hashOf(k, sub, v), c: c++ }; }); });
    (d.favs || []).forEach((f, i) => { if (f && f.feedUrl) ent[idOf('favs.v1', f.feedUrl)] = { v: f, at: 0, h: f.feedUrl, c: i }; });
    return ent;
  }
  // Fusionne les éléments distants ; renvoie true si le distant doit être mis à jour ; remplit `applied` des clés locales modifiées.
  function mergeEnt(rent, applied) {
    let need = false; const adopt = {}; // key -> {sub: R}
    for (const id of new Set([...Object.keys(meta), ...Object.keys(rent)])) {
      const L = meta[id], R = rent[id];
      if (!R) { if (L) need = true; continue; }
      const key = keyOf(id); if (!KIND[key]) continue;
      const take = () => { (adopt[key] || (adopt[key] = {}))[subOf(id)] = R; meta[id] = { at: R.at, h: R.h, c: L ? Math.min(L.c, R.c) : R.c, del: !!R.del }; applied.add(key); };
      if (!L) { take(); continue; }
      if (L.h === R.h && !!L.del === !!R.del) { if (R.c < L.c) L.c = R.c; if (R.at > L.at) L.at = R.at; else if (L.at > R.at) need = true; continue; }
      if (R.at > L.at || (R.at === L.at && String(R.h) > String(L.h))) take(); else need = true;
    }
    applied.forEach(key => {
      const cur = entriesOf(key), a = adopt[key] || {};
      Object.entries(a).forEach(([sub, R]) => { if (R.del) delete cur[sub]; else cur[sub] = R.v; });
      const ents = Object.entries(cur).sort((x, y) => ((meta[idOf(key, x[0])] || {}).c || 0) - ((meta[idOf(key, y[0])] || {}).c || 0));
      writeKey(key, ents);
    });
    if (applied.size) saveMeta();
    return need;
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
  async function put(ver) {
    const h = { 'Content-Type': 'application/json' };
    h['X-Sauvegarde-Version'] = ver || 'new';
    const r = await fetch(url(), { method: 'PUT', headers: h, body: JSON.stringify(buildDoc()) });
    if (r.status === 409) return { conflict: true };
    if (!r.ok) throw new Error('Sauvegarde ' + r.status);
    rawSet.call(localStorage, VER_KEY, (await r.json()).version);
    return {};
  }
  // Récupère la version en ligne, fusionne élément par élément, renvoie les favoris.
  let pulling = null;
  function pull() { return pulling || (pulling = pullOnce().finally(() => { pulling = null; })); }
  async function pullOnce(tries = 3) {
    if (!enabled()) return favs();
    const remote = await get(), applied = new Set();
    let need = !remote;
    if (remote) {
      const d = remote.data || {};
      need = mergeEnt(d.ent || legacyEnt(d), applied) || !d.ent;
      const rp = d.progress || {}, lp = load(PROG_KEY, {}), mp = mergeProg(rp, lp), ps = JSON.stringify(mp);
      if (ps !== JSON.stringify(lp)) { rawSet.call(localStorage, PROG_KEY, ps); applied.add(PROG_KEY); }
      if (ps !== JSON.stringify(rp)) need = true;
    }
    if (need) { const r = await put(remote ? remote.ver : null); if (r.conflict && tries > 0) return pullOnce(tries - 1); }
    else rawSet.call(localStorage, VER_KEY, remote.ver || '');
    if (applied.size) { try { if ([...applied].some(k => k !== PROG_KEY) && Sync.onSettings) Sync.onSettings(); if (Sync.onChange) Sync.onChange(applied); } catch {} }
    return favs();
  }
  async function push() {
    if (!enabled()) return;
    const r = await put(localStorage.getItem(VER_KEY) || null);
    if (r.conflict) await pull();
  }
  // Tout changement local est envoyé après une courte pause ; la progression de lecture un peu moins souvent.
  let st = 0;
  const touch = () => { clearTimeout(st); st = setTimeout(() => push().catch(() => {}), 1200); };
  let pt = 0;
  Storage.prototype.setItem = function (k, v) { rawSet.call(this, k, v); if (this !== localStorage) return; if (k === PROG_KEY) { if (!pt) pt = setTimeout(() => { pt = 0; push().catch(() => {}); }, 15000); } else if (KIND[k] && reconcile(k)) touch(); };
  Storage.prototype.removeItem = function (k) { rawDel.call(this, k); if (this === localStorage && KIND[k] && reconcile(k)) touch(); };
  // Synchro régulière : au retour sur l'app, en ligne, et toutes les 45 s tant qu'elle est ouverte.
  const tick = () => { if (!document.hidden && enabled()) pull().catch(() => {}); };
  setInterval(tick, 45000); addEventListener('online', tick); addEventListener('focus', tick);
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
  // Partages (listes, playlists) : un enregistrement indépendant sous un code court.
  async function shareCreate(obj) {
    const code = newCode(), r = await fetch(BASE + code, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Sauvegarde-Version': 'new' }, body: JSON.stringify({ share: obj }) });
    if (!r.ok) throw new Error('Serveur ' + r.status);
    return code;
  }
  async function shareGet(code) {
    const r = await fetch(BASE + String(code).toUpperCase(), { cache: 'no-store' });
    if (r.status === 404) return null; if (!r.ok) throw new Error('Serveur ' + r.status);
    return (await r.json()).share || null;
  }
  function leave() { const c = cfg(); delete c.code; setCfg(c); localStorage.removeItem(VER_KEY); }
  return { shareCreate, shareGet, onSettings: null, onChange: null, proxy: () => (DEFAULT_PROXY || cfg().proxy || '').replace(/\/$/, ''), DEFAULT_PROXY, favs, setFavs, pull, cfg, setCfg, enabled, newCode, fmt, create, restore, leave };
})();
