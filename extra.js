// Fonctions complémentaires : file « À écouter », épisodes hors ligne, nouveautés, chapitres/notes, vitesse, silences, OPML.
// Chargé avant app.js : uniquement des déclarations (les variables de app.js ne sont lues qu'à l'appel).
const xget = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
const xset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const xbtn = (cls, attrs, label) => `<button type="button" class="${cls}" ${attrs}>${label}</button>`;
const epTime = e => Date.parse(e.date) || 0;
const snapToEp = s => ({ title: s.title, url: s.url, dur: s.dur, image: s.image, date: s.date, _show: s.show, _art: s.art, _feed: s.feed });
const fmtSize = b => b > 1e9 ? (b / 1e9).toFixed(1) + ' Go' : Math.max(1, Math.round(b / 1e6)) + ' Mo';

// ---------- 1. File « À écouter » (synchronisée) ----------
const qGet = () => xget('queue.v1', []);
function qAdd(snap) {
  const q = qGet(); if (q.some(x => x.url === snap.url)) { toast('Déjà dans la file'); return; }
  q.push(snap); xset('queue.v1', q); syncNav(); toast('Ajouté à la file « À écouter »');
}
function qPlayNext(idx = 0) { // joue le prochain épisode de la file, puis reprend la liste en cours
  const q = qGet(); if (idx >= q.length) return false;
  const [s] = q.splice(idx, 1); xset('queue.v1', q);
  queue.splice(qi + 1, 0, snapToEp(s)); if (!qCtx) qCtx = { show: '', art: '', feedUrl: '' };
  playAt(qi + 1); return true;
}

// ---------- 2. Épisodes hors ligne (IndexedDB, lecture depuis le fichier local) ----------
let dlP = null;
const dlDB = () => dlP || (dlP = new Promise((ok, ko) => { const r = indexedDB.open('dl', 1); r.onupgradeneeded = () => r.result.createObjectStore('eps', { keyPath: 'url' }); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); }));
const dlTx = async (mode, fn) => { const db = await dlDB(); return new Promise((ok, ko) => { const t = db.transaction('eps', mode), r = fn(t.objectStore('eps')); t.oncomplete = () => ok(r && r.result); t.onerror = () => ko(t.error); t.onabort = () => ko(t.error); }); };
const dlObj = new Map(), dlBusy = new Map(), dlMeta = new Map(); // url -> blob URL | progression | fiche
async function dlInit() {
  try { const all = await dlTx('readonly', s => s.getAll()); all.forEach(r => { dlObj.set(r.url, URL.createObjectURL(r.blob)); const { blob, ...m } = r; dlMeta.set(r.url, m); }); dlRefresh(); } catch {}
}
const dlLabel = u => dlBusy.has(u) ? '⏳ ' + Math.round(dlBusy.get(u) * 100) + ' %' : dlObj.has(u) ? '✓ Téléchargé · supprimer' : '⬇ Télécharger';
const dlIcon = u => dlBusy.has(u) ? Math.round(dlBusy.get(u) * 100) + '%' : dlObj.has(u) ? '✓' : '⬇';
function dlRefresh(u) { document.querySelectorAll('[data-dl][data-u]').forEach(b => { if (u && b.dataset.u !== u) return; const x = b.dataset.u; b.innerHTML = b.classList.contains('dlb') ? dlIcon(x) : dlLabel(x); b.classList.toggle('on', dlObj.has(x)); b.title = dlObj.has(x) ? 'Téléchargé : touche pour supprimer' : 'Télécharger pour écouter hors ligne'; }); }
async function dlFetch(u, onProg) {
  const px = Sync.proxy(), tries = [u, px ? px + '/?url=' + encodeURIComponent(u) : null].filter(Boolean); let last;
  for (const t of tries) {
    try {
      const r = await fetch(t); if (!r.ok) throw new Error('HTTP ' + r.status);
      const total = +r.headers.get('content-length') || 0, rd = r.body.getReader(), parts = []; let got = 0;
      for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; onProg(total ? got / total : 0); }
      return new Blob(parts, { type: r.headers.get('content-type') || 'audio/mpeg' });
    } catch (e) { last = e; }
  }
  throw last || new Error('échec');
}
async function dlAdd(snap, auto) {
  if (!auto && wifiOnly() && onCellular() && !confirm('Tu es en données mobiles. Télécharger quand même ?')) return;
  if (dlObj.has(snap.url) || dlBusy.has(snap.url)) return;
  dlBusy.set(snap.url, 0); dlRefresh(snap.url);
  try {
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
    let last = 0; const blob = await dlFetch(snap.url, p => { dlBusy.set(snap.url, p); if (Date.now() - last > 400) { last = Date.now(); dlRefresh(snap.url); } });
    const rec = { ...snap, size: blob.size, at: Date.now(), auto: !!auto, blob };
    await dlTx('readwrite', s => s.put(rec));
    dlObj.set(snap.url, URL.createObjectURL(blob)); const { blob: _b, ...m } = rec; dlMeta.set(snap.url, m);
    if (!auto) toast('Épisode téléchargé : disponible hors ligne');
  } catch (e) { if (!auto) toast('Téléchargement impossible : ' + (e && e.name === 'QuotaExceededError' ? 'espace insuffisant' : 'ce serveur refuse le téléchargement')); }
  dlBusy.delete(snap.url); dlRefresh(snap.url);
}
async function dlRemove(url) {
  try { await dlTx('readwrite', s => s.delete(url)); } catch {}
  const o = dlObj.get(url); if (o) URL.revokeObjectURL(o); dlObj.delete(url); dlMeta.delete(url); dlRefresh(url);
}
function dlToggle(snap) { if (dlObj.has(snap.url)) { dlRemove(snap.url); toast('Téléchargement supprimé'); } else if (!dlBusy.has(snap.url)) dlAdd(snap); }
// Téléchargement automatique des N derniers épisodes d'un podcast (réglage synchronisé ; chaque appareil télécharge pour lui-même).
let dlAutoRunning = false;
async function dlAutoRun() {
  if (dlAutoRunning) return; dlAutoRunning = true;
  try {
    if (wifiOnly() && onCellular()) return; // réglage « Wi-Fi seulement » (activable / désactivable dans Réglages)
    const auto = xget('dl.auto.v1', {});
    for (const [fu, n] of Object.entries(auto)) {
      const feed = feedCache.get(fu); if (!feed || !n) continue;
      const since = n && n.new ? n.new : 0; // « nouveaux épisodes » : ceux parus après l'activation
      const newest = feed.episodes.slice().sort((a, b) => epTime(b) - epTime(a)).filter(e => !since || epTime(e) > since).slice(0, since ? 10 : +n);
      for (const e of newest) await dlAdd(epSnap(e, feed), true);
      const keep = new Set(newest.map(e => e.url));
      for (const [u, m] of dlMeta) if (m.auto && m.feed === fu && !keep.has(u)) await dlRemove(u);
    }
  } finally { dlAutoRunning = false; }
}

// ---------- Listes « À écouter », « Nouveautés », « Hors ligne » (onglet Favoris) ----------
const rowHtml = (s, btns) => `<div class="item xrow"><img src="${esc(s.image || s.art || '')}" alt=""><div class="t"><b>${esc(s.title)}</b><small class="m">${esc([s.show, fmtDate(s.date), fmtDur(s.dur)].filter(Boolean).join(' · '))}</small>${s.extra || ''}</div>${btns}</div>`;
const playList = (snaps, i) => { queue = snaps.map(snapToEp); qCtx = { show: '', art: '', feedUrl: '', auto: true }; playAt(i); };
function renderQueue(head) {
  const q = qGet();
  view.innerHTML = head + (q.length ? `<p class="dim sm">Ces épisodes se jouent dans l'ordre, après l'épisode en cours.</p>` + q.map((s, i) => rowHtml(s, `<button class="ibtn" data-up aria-label="Monter">▲</button><button class="ibtn" data-dn aria-label="Descendre">▼</button><button class="ibtn" data-rm aria-label="Retirer">✕</button><button class="ibtn playb" data-play aria-label="Lire">${IC.play}</button>`)).join('') : '<p class="dim">La file est vide. Dans la liste d\'épisodes d\'un podcast, ouvre un épisode (flèche) puis touche « À la suite ».</p>');
  bindFavSeg();
  view.querySelectorAll('.xrow').forEach((el, i) => el.onclick = ev => {
    const l = qGet(), mv = (a, b) => { [l[a], l[b]] = [l[b], l[a]]; xset('queue.v1', l); renderQueue(head); };
    if (ev.target.closest('[data-up]')) { if (i > 0) mv(i, i - 1); return; }
    if (ev.target.closest('[data-dn]')) { if (i < l.length - 1) mv(i, i + 1); return; }
    if (ev.target.closest('[data-rm]')) { l.splice(i, 1); xset('queue.v1', l); syncNav(); renderQueue(head); return; }
    qPlayNext(i); renderQueue(head);
  });
}
const newTotal = () => Sync.favs().reduce((n, f) => { const fd = feedCache.get(f.feedUrl); return n + (fd ? newEps(fd).length : 0); }, 0);
const seenMap = () => xget('seen.v1', {});
const newEps = feed => { const s = seenMap()[feed.feedUrl]; return s == null ? [] : feed.episodes.filter(e => epTime(e) > s); };
function markSeen(feed) { const m = seenMap(), mx = Math.max(0, ...feed.episodes.map(epTime)); if (m[feed.feedUrl] !== mx) { m[feed.feedUrl] = mx; xset('seen.v1', m); } }
function seenInit() { const m = seenMap(); let ch = false; Sync.favs().forEach(f => { const fd = feedCache.get(f.feedUrl); if (fd && m[f.feedUrl] == null) { m[f.feedUrl] = Math.max(0, ...fd.episodes.map(epTime)); ch = true; } }); if (ch) xset('seen.v1', m); }
const newBadge = f => { const fd = feedCache.get(f.feedUrl), n = fd ? newEps(fd).length : 0; return n ? `<span class="newpill">${n} nouveau${n > 1 ? 'x' : ''}</span>` : ''; };
function refreshNewBadge() {
  const b = document.querySelector('nav [data-tab=home]'); if (!b) return;
  const n = newTotal(); let i = b.querySelector('.bdg');
  if (!n) { if (i) i.remove(); return; }
  if (!i) { i = document.createElement('i'); i.className = 'bdg'; b.appendChild(i); } i.textContent = n > 99 ? '99+' : n;
}
function renderNew(head) {
  const all = []; Sync.favs().forEach(f => { const fd = feedCache.get(f.feedUrl); if (fd) newEps(fd).forEach(e => all.push(epSnap(e, fd))); });
  all.sort((a, b) => epTime(b) - epTime(a)); const l = all.slice(0, 80);
  view.innerHTML = head + (l.length ? `<div class="tglrow"><button type="button" class="tgl" id="seenall">Tout marquer comme vu</button></div>` + l.map(s => rowHtml(s, `<button class="ibtn" data-q aria-label="À la suite">☰＋</button><button class="ibtn" data-pladd aria-label="Ajouter à une playlist">＋</button><button class="ibtn playb" data-play aria-label="Lire">${IC.play}</button>`)).join('') : '<p class="dim">Aucun nouvel épisode depuis ta dernière visite.</p>');
  bindFavSeg();
  const sa = $('#seenall'); if (sa) sa.onclick = () => { Sync.favs().forEach(f => { const fd = feedCache.get(f.feedUrl); if (fd) markSeen(fd); }); refreshNewBadge(); renderFavs(); };
  view.querySelectorAll('.xrow').forEach((el, i) => el.onclick = ev => {
    if (ev.target.closest('[data-q]')) { qAdd(l[i]); return; }
    if (ev.target.closest('[data-pladd]')) { playlistPicker([l[i]], ev.target.closest('[data-pladd]')); return; }
    playList(l, i);
  });
}
function renderDownloads(head) {
  const l = [...dlMeta.values()].sort((a, b) => b.at - a.at);
  const tot = l.reduce((n, x) => n + (x.size || 0), 0);
  view.innerHTML = head + (l.length ? `<p class="dim sm">${l.length} épisode${l.length > 1 ? 's' : ''} · ${fmtSize(tot)} · disponibles sans connexion.</p>` + l.map(s => rowHtml({ ...s, extra: `<small class="m">${fmtSize(s.size || 0)}${s.auto ? ' · auto' : ''}</small>` }, `<button class="ibtn" data-rm aria-label="Supprimer">🗑</button><button class="ibtn playb" data-play aria-label="Lire">${IC.play}</button>`)).join('') : '<p class="dim">Aucun épisode téléchargé. Ouvre un épisode (flèche) puis touche « Télécharger ».</p>');
  bindFavSeg();
  view.querySelectorAll('.xrow').forEach((el, i) => el.onclick = ev => {
    if (ev.target.closest('[data-rm]')) { dlRemove(l[i].url).then(() => renderDownloads(head)); return; }
    playList(l, i);
  });
}

// ---------- 6. Chapitres et notes d'épisode ----------
const hms = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0'); };
const tsec = t => t.split(':').reverse().reduce((a, v, i) => a + (+v) * 60 ** i, 0);
function chaptersFromNotes(txt) {
  const out = []; (txt || '').split('\n').forEach(line => { const m = line.match(/^\s*[-–•*]?\s*\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*[-–—:.]?\s*(.{2,})$/); if (m) out.push({ t: tsec(m[1]), title: m[2].trim() }); });
  return out.length >= 3 ? out : [];
}
async function getChapters(ep) {
  if (ep._chap) return ep._chap;
  let ch = [];
  if (ep.chapUrl) { try { const j = JSON.parse(await fetchText(ep.chapUrl)); ch = (j.chapters || []).map(c => ({ t: +c.startTime || 0, title: c.title || '' })).filter(c => c.title); } catch {} }
  if (!ch.length) ch = chaptersFromNotes(ep.notes);
  return (ep._chap = ch.sort((a, b) => a.t - b.t));
}
const linkify = h => h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
function epInfo(ep, show, art, feedUrl) {
  withShare(async () => {
    const m = modal(`<h3>${esc(ep.title)}</h3><p class="dim sm">${esc(show || '')}</p><div id="chl" class="lbody"><p class="dim sm">Chargement des chapitres…</p></div><div class="notes">${ep.notes || ep.desc ? linkify(esc(ep.notes || ep.desc)).replace(/\n/g, '<br>') : '<span class="dim">Pas de notes pour cet épisode.</span>'}</div><button data-close class="ghost">Fermer</button>`);
    const ch = await getChapters(ep), box = m.querySelector('#chl'); if (!box) return;
    const here = curEp && curEp.url === ep.url, now = here ? audio.currentTime : -1;
    box.innerHTML = ch.length ? '<div class="phead">Chapitres</div>' + ch.map((c, i) => `<button type="button" class="prow${now >= c.t && (!ch[i + 1] || now < ch[i + 1].t) ? ' cur' : ''}" data-t="${c.t}"><span>${esc(c.title)}</span><small class="dim">${hms(c.t)}</small></button>`).join('') : '';
    box.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
      const t = +b.dataset.t; m.close();
      if (here) { audio.currentTime = t; if (audio.paused) audio.play().catch(() => {}); }
      else { playStartOverride = t; play(ep, show, art, feedUrl); }
    });
  });
}
let curChaps = [];
function chapTick() { // nom du chapitre en cours sous le titre du lecteur
  const el = document.getElementById('np-chap'); if (!el) return;
  if (!curChaps.length) { if (el.textContent) el.textContent = ''; return; }
  const t = audio.currentTime; let c = null; for (const x of curChaps) if (x.t <= t) c = x; else break;
  const s = c ? c.title : ''; if (el.textContent !== s) el.textContent = s;
}

// ---------- 3. Minuteur : durées, fin d'épisode, fondu ----------
const SLEEP_FADE = 60;
function sleepMenu(anchor) {
  const fade = xget('sleep.fade', true) !== false, act = typeof sleepEnd !== 'undefined' && (sleepEnd || sleepEp);
  const el = popover(anchor, `<div class="phead">Minuteur d'arrêt</div><div class="lbody">${[15, 30, 45, 60, 90].map(m => `<button type="button" class="prow" data-m="${m}"><span>${m} minutes</span></button>`).join('')}<button type="button" class="prow" data-m="ep"><span>À la fin de l'épisode</span></button>${act ? '<button type="button" class="prow" data-m="0"><span>Désactiver</span></button>' : ''}</div><label class="lrow"><input type="checkbox" id="fadeck"${fade ? ' checked' : ''}><span>Fondu du volume avant l'arrêt</span></label>`);
  if (!el) return;
  el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { const v = b.dataset.m; setSleep(v === 'ep' ? 'ep' : +v); closePop(); });
  el.querySelector('#fadeck').onchange = e => xset('sleep.fade', e.target.checked);
  el.place();
}

// ---------- 4. Vitesse par podcast et réduction des silences ----------
const rateFor = u => +xget('rate.v1', {})[u] || 1;
const silOn = u => !!xget('silence.v1', {})[u];
function speedMenu(anchor) {
  if (!curFeedUrl) { toast('Lance un épisode pour régler sa vitesse'); return; }
  const r = rateFor(curFeedUrl), sil = silOn(curFeedUrl);
  const el = popover(anchor, `<div class="phead">Vitesse pour ce podcast</div><div class="lbody speeds">${[0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2].map(v => `<button type="button" class="prow${v === r ? ' cur' : ''}" data-v="${v}"><span>${v}×</span></button>`).join('')}</div><label class="lrow"><input type="checkbox" id="silck"${sil ? ' checked' : ''}><span>Réduire les silences</span></label><p class="dim sm" style="margin:2px 8px 6px">Les silences sont accélérés (ne fonctionne pas avec tous les serveurs audio).</p>`);
  if (!el) return;
  el.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { const m = xget('rate.v1', {}); if (+b.dataset.v === 1) delete m[curFeedUrl]; else m[curFeedUrl] = +b.dataset.v; xset('rate.v1', m); applyRate(); closePop(); });
  el.querySelector('#silck').onchange = e => { const m = xget('silence.v1', {}); if (e.target.checked) m[curFeedUrl] = 1; else delete m[curFeedUrl]; xset('silence.v1', m); applyRate(); };
  el.place();
}
function applyRate() {
  const r = rateFor(curFeedUrl); el1.defaultPlaybackRate = el2.defaultPlaybackRate = r; audio.playbackRate = r; silState.skip = false; silState.quiet = 0;
  const b = document.getElementById('speed'); if (b) { b.textContent = r === 1 ? '1×' : r + '×'; b.classList.toggle('on', r !== 1 || silOn(curFeedUrl)); }
}
const silState = { quiet: 0, skip: false, buf: null };
function silTick() {
  const on = silOn(curFeedUrl) && typeof analyser !== 'undefined' && analyser && audio === el1 && !audio.paused && ctx && ctx.state === 'running';
  if (!on) { if (silState.skip) { silState.skip = false; audio.playbackRate = rateFor(curFeedUrl); } silState.quiet = 0; return; }
  if (!silState.buf) silState.buf = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(silState.buf);
  let s = 0; for (let i = 0; i < silState.buf.length; i++) { const v = (silState.buf[i] - 128) / 128; s += v * v; }
  const rms = Math.sqrt(s / silState.buf.length), quiet = rms < (nightOn ? 0.03 : 0.015);
  silState.quiet = quiet ? silState.quiet + 100 : 0;
  const want = silState.quiet >= 300;
  if (want !== silState.skip) { silState.skip = want; audio.playbackRate = want ? Math.min(4, rateFor(curFeedUrl) * 2.5) : rateFor(curFeedUrl); }
}
setInterval(silTick, 100);

// ---------- 7. OPML ----------
function opmlExport() {
  const f = Sync.favs(), x = '<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>Mes podcasts</title></head><body>\n' + f.map(p => `<outline type="rss" text="${esc(p.title)}" title="${esc(p.title)}" xmlUrl="${esc(p.feedUrl)}"/>`).join('\n') + '\n</body></opml>';
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([x], { type: 'text/x-opml' })); a.download = 'podcasts.opml'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
async function opmlImport(file) {
  const doc = new DOMParser().parseFromString(await file.text(), 'text/xml'), out = [...doc.getElementsByTagName('outline')].map(o => ({ feedUrl: o.getAttribute('xmlUrl') || o.getAttribute('xmlurl') || '', title: o.getAttribute('title') || o.getAttribute('text') || '' })).filter(o => /^https?:\/\//i.test(o.feedUrl));
  if (!out.length) return 0;
  const l = Sync.favs(); let n = 0;
  out.forEach(o => { if (!l.some(f => f.feedUrl === o.feedUrl)) { l.push({ feedUrl: o.feedUrl, title: o.title, image: '', author: '' }); n++; } });
  if (n) { Sync.setFavs(l); refreshFavs(); }
  return n;
}

// ---------- Radios en direct ----------
const RADIO_API = ['https://de1.api.radio-browser.info', 'https://de2.api.radio-browser.info', 'https://all.api.radio-browser.info'];
const RADIO_BLOCK = /europe ?[12]\b|\brfm\b|virgin radio|cnews|\bc8\b|canal ?\+/i; // groupe Bolloré / Vivendi : exclus
const RADIO_FR = [
  ['France Inter', 'https://icecast.radiofrance.fr/franceinter-midfi.mp3'], ['franceinfo', 'https://icecast.radiofrance.fr/franceinfo-midfi.mp3'],
  ['France Culture', 'https://icecast.radiofrance.fr/franceculture-midfi.mp3'], ['France Musique', 'https://icecast.radiofrance.fr/francemusique-midfi.mp3'],
  ['FIP', 'https://icecast.radiofrance.fr/fip-midfi.mp3'], ["Mouv'", 'https://icecast.radiofrance.fr/mouv-midfi.mp3'],
].map(([name, url], i) => ({ id: url, name, url, logo: '', rf: [1, 2, 5, 4, 7, 6][i] })); // rf : identifiant « livemeta » de Radio France (titre en cours)
const RF_SLUG = { franceinter: 1, franceinfo: 2, franceculture: 5, francemusique: 4, fip: 7, mouv: 6 };
const rfFor = (name, url) => { const m = /icecast\.radiofrance\.fr\/(franceinter|franceinfo|franceculture|francemusique|fip|mouv)/.exec(url || ''); if (m) return RF_SLUG[m[1]]; const n = (name || '').toLowerCase().replace(/[^a-z]/g, ''); return RF_SLUG[n] || undefined; };
const RF_LOGO = { 1: 'franceinter', 2: 'franceinfo', 5: 'franceculture', 4: 'francemusique', 7: 'fip', 6: 'mouv' };
const radLogo = r => r.logo || (() => { const id = r.rf || rfFor(r.name, r.url); return id ? `https://www.radiofrance.fr/external/favicons/${RF_LOGO[id]}/favicon.png` : ''; })();
const radFavs = () => xget('radios.v1', []);
const radIsFav = r => radFavs().some(x => x.url === r.url);
function radToggle(r) { const l = radFavs(), i = l.findIndex(x => x.url === r.url); i >= 0 ? l.splice(i, 1) : l.push({ id: r.url, name: r.name, url: r.url, logo: r.logo || '', rf: r.rf, tags: r.tags || '' }); xset('radios.v1', l); }
let radTimer = null, curRadio = null;
function playRadio(r) {
  if (!r.rf) r = { ...r, rf: rfFor(r.name, r.url) }; // favoris enregistrés avant l'ajout des infos en direct
  r = { ...r, logo: radLogo(r) };
  queue = []; qi = -1; qCtx = { show: 'Radio en direct', art: r.logo || '', feedUrl: '', auto: false };
  play({ title: r.name, url: r.url, live: true, image: r.logo || '' }, r.tags ? 'En direct · ' + r.tags : 'Radio en direct', r.logo || '', '');
  curRadio = r; clearInterval(radTimer); radNow(r);
  if (r.rf) radTimer = setInterval(() => radNow(r), 20000);
}
// Informations « en ce moment » : titre du morceau ou de l'émission, artiste, image (Radio France publie ces données ; les autres radios n'en exposent pas au navigateur).
async function radNow(r) {
  if (!r.rf) return;
  if (!curEp || !curEp.live || curRadio !== r) { clearInterval(radTimer); return; }
  try {
    const d = await (await fetch('https://api.radiofrance.fr/livemeta/pull/' + r.rf)).json(), now = Date.now() / 1000;
    const cur = (d.levels || []).map(l => d.steps[l.items[l.position]]).filter(Boolean).map(s => s).sort((a, b) => (a.depth || 0) - (b.depth || 0));
    if (!cur.length) return;
    const top = cur[0], deep = cur[cur.length - 1], song = deep.embedType === 'song' || (deep.authors && deep !== top);
    let title = song ? deep.title : top.title, sub = [r.name];
    if (song && deep.authors) sub.push(deep.authors + (deep.anneeEditionMusique ? ' (' + deep.anneeEditionMusique + ')' : ''));
    if (song && top !== deep && top.title) sub.push(top.title);
    const img = (song ? (deep.visual || deep.visuelYoutube) : top.visual) || top.visual || r.logo || '';
    if (!curEp || !curEp.live || curRadio !== r) return;
    $('#np-title').textContent = title || r.name; $('#np-show').textContent = sub.join(' · ');
    if (img && /^https:/.test(img)) { $('#np-art').src = img; $('#np-art').style.visibility = 'visible'; }
    if ('mediaSession' in navigator) try { navigator.mediaSession.metadata = new MediaMetadata({ title: title || r.name, artist: sub.slice(1).join(' · ') || r.name, artwork: img ? [{ src: img, sizes: '400x400' }] : [] }); } catch {}
  } catch {}
}
async function radSearch(q) {
  let lastErr;
  for (const base of RADIO_API) {
    try {
      const r = await fetch(`${base}/json/stations/search?name=${encodeURIComponent(q)}&countrycode=FR&hidebroken=true&order=clickcount&reverse=true&limit=40`);
      if (!r.ok) throw new Error(r.status);
      const seen = new Set();
      return (await r.json()).filter(s => (s.url_resolved || s.url) && !RADIO_BLOCK.test(s.name) && !seen.has(s.name.toLowerCase()) && seen.add(s.name.toLowerCase()))
        .map(s => ({ id: s.stationuuid, name: s.name.trim(), url: (s.url_resolved || s.url).replace(/^http:/, 'https:'), rf: rfFor(s.name, s.url_resolved || s.url), logo: /^https:/.test(s.favicon || '') ? s.favicon : '', tags: [(s.tags || '').split(',').slice(0, 3).join(', '), s.bitrate ? s.bitrate + ' kb/s' : ''].filter(Boolean).join(' · ') }));
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('indisponible');
}
const radRow = (r, i, link) => `<div class="item radio" data-i="${i}"><img src="${esc(radLogo(r))}" alt="" onerror="this.style.visibility='hidden'"><div class="t"><b>${esc(r.name)}</b><small class="m">En direct</small></div><div class="acts">${link ? '<button class="ibtn" data-rlink aria-label="Copier un lien de raccourci" title="Copier un lien de raccourci">🔗</button>' : ''}${starBtn(radIsFav(r)).replace('data-star', 'data-star data-rfav')}</div></div>`;
// mode : 'lib' (mes radios), 'quick' (accueil : mes radios + Radio France), 'find' (Découvrir : recherche + suggestions)
function renderRadios(head, mode = 'lib') {
  const find = mode === 'find';
  view.innerHTML = head + (find ? `<form id="radf" class="row"><input id="radq" placeholder="Chercher une radio (ex. Chérie FM, Nostalgie…)" autocomplete="off"><button class="abtn">Chercher</button></form>` : '') + `<div id="radout"></div>`;
  bindFavSeg();
  let list = [];
  const bindRows = () => view.querySelectorAll('.item.radio').forEach(el => el.onclick = ev => {
    const r = list[+el.dataset.i];
    if (ev.target.closest('[data-rlink]')) { copyText(radioLink(r), 'Lien de raccourci copié'); return; }
    if (ev.target.closest('[data-rfav]')) { radToggle(r); setStar(ev.target.closest('[data-rfav]'), radIsFav(r)); return; }
    playRadio(r);
  });
  const show = (title, l, msg) => { list = l; $('#radout').innerHTML = (title ? `<h3 class="sect">${title}</h3>` : '') + (l.length ? l.map((r, i) => radRow(r, i, mode === 'lib')).join('') : `<p class="dim">${msg}</p>`); bindRows(); };
  const home = () => {
    const f = radFavs();
    if (!find) show('', f, 'Aucune radio en coup de cœur. Trouve des radios dans l\'onglet Découvrir (Radios), puis touche le cœur.');
    else { list = []; $('#radout').innerHTML = '<p class="dim">Tape le nom d\'une radio (France Inter, Chérie FM, Nostalgie…) puis touche le cœur pour la garder dans ta Bibliothèque.</p>'; }
  };
  home();
  if (!find) return;
  $('#radf').onsubmit = async e => {
    e.preventDefault(); const q = $('#radq').value.trim(); if (!q) { home(); return; }
    $('#radout').innerHTML = '<p class="dim">Recherche…</p>';
    try { show('Résultats', await radSearch(q), 'Aucune radio trouvée.'); } catch { $('#radout').innerHTML = '<p class="dim">Recherche de radios indisponible (réseau).</p>'; }
  };
}
// ---------- Accueil : reprendre, à écouter, nouveautés, radios ----------
function renderHome() {
  const ft = ['q', 'new', 'radio'].includes(localStorage.getItem('hometab')) ? localStorage.getItem('hometab') : 'q', nn = newTotal(), qn = qGet().length;
  const playing = !$('#player').hidden && curEp;
  const last = lastGet();
  const resume = !playing && last ? `<div class="resumecard"><div class="t"><small>Dernier épisode</small><b>${esc(last.title)}</b><small>${esc(last.show || '')} · à ${hms(last.t)}</small></div><button type="button" id="resume" class="abtn">▶ Reprendre</button></div>` : playing ? `<div class="resumecard"><div class="t"><small>En cours</small><b>${esc(curEp.title)}</b></div><button type="button" id="resume" class="abtn">${audio.paused ? '▶ Reprendre' : '⏸ Pause'}</button></div>` : '';
  setTimeout(refreshNewBadge, 0);
  const head = resume + shortcutsHtml() + `<div class="favsegw">${seg('favseg', [['q', 'À écouter' + (qn ? ' ' + qn : '')], ['new', 'Nouveautés' + (nn ? ' ' + nn : '')], ['radio', 'Radios']], ft)}</div>`;
  if (ft === 'new') { renderNew(head); return; }
  if (ft === 'radio') { renderRadios(head, 'quick'); return; }
  renderQueue(head);
}

// ---------- Confort : retour automatique, signets, recherche dans la bibliothèque, Wi-Fi, raccourcis ----------
const rwSecs = () => { const v = localStorage.getItem('rewind'); return v == null ? 5 : (+v || 0); };
const wifiOnly = () => localStorage.getItem('dl.wifi') !== '0';
const onCellular = () => { const c = navigator.connection; return !!(c && (c.type === 'cellular' || c.saveData)); };
const RW_OPTS = [['0', 'Non'], ['3', '3 s'], ['5', '5 s'], ['10', '10 s'], ['15', '15 s']];
const copyText = async (t, msg) => { try { await navigator.clipboard.writeText(t); toast(msg); } catch { prompt('Copie ce lien :', t); } };
const b64e = o => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = s => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))));
const baseUrl = () => location.origin + location.pathname;
const radioLink = r => baseUrl() + '#go=radio&u=' + encodeURIComponent(r.url) + '&n=' + encodeURIComponent(r.name);
// Dernier épisode écouté (local) : carte « Reprendre » de l'accueil
const lastGet = () => xget('last.v1', null);
function saveLast() {
  if (!curEp || curEp.live || !audio.src || !(audio.currentTime > 3)) return;
  try { localStorage.setItem('last.v1', JSON.stringify({ u: curEp.url, title: curEp.title, dur: curEp.dur || '', image: curEp.image || '', date: curEp.date || '', show: curShow, art: (qCtx && qCtx.art) || '', feed: curFeedUrl, t: Math.floor(audio.currentTime) })); } catch {}
}
function playMoment(o) { // o : {u, title, show, art, image, feed, t}
  queue = [{ title: o.title, url: o.u, dur: '', image: o.image || '', _show: o.show || '', _art: o.art || '', _feed: o.feed || '' }]; qi = 0;
  qCtx = { show: o.show || '', art: o.art || '', feedUrl: o.feed || '', auto: false }; playStartOverride = o.t || 0; playAt(0);
}
const playLast = () => { const l = lastGet(); if (l) playMoment(l); };
// Signets
const bmGet = () => xget('bm.v1', []);
function bmAdd() {
  if (!curEp || curEp.live) return;
  const l = bmGet(); l.unshift({ id: newId(), u: curEp.url, title: curEp.title, show: curShow, art: (qCtx && qCtx.art) || '', image: curEp.image || '', feed: curFeedUrl, t: Math.floor(audio.currentTime), at: Date.now() });
  xset('bm.v1', l); toast('Signet ajouté à ' + hms(audio.currentTime));
}
const bmLink = b => baseUrl() + '#m=' + b64e({ u: b.u, n: b.title, s: b.show, a: b.art, i: b.image, f: b.feed, t: b.t });
async function bmShare(b) {
  const url = bmLink(b), title = `${b.title} (à ${hms(b.t)})`;
  if (navigator.share) { try { await navigator.share({ title, text: title, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  copyText(url, 'Lien copié');
}
function renderBookmarks(head) {
  const l = bmGet();
  view.innerHTML = head + (l.length ? '<p class="dim sm">Touche un signet pour reprendre à ce moment. Dans le lecteur, le bouton « Signet » en ajoute un.</p>' + l.map(b => rowHtml({ title: b.title, show: b.show, image: b.image || b.art, extra: `<small class="m">à ${hms(b.t)}</small>` }, `<button class="ibtn" data-bshare aria-label="Partager ce moment">↗</button><button class="ibtn" data-rm aria-label="Supprimer">🗑</button><button class="ibtn playb" data-play aria-label="Lire">${IC.play}</button>`)).join('') : '<p class="dim">Aucun signet. Pendant l\'écoute d\'un épisode, touche « Signet » dans le lecteur pour marquer un passage.</p>');
  bindFavSeg();
  view.querySelectorAll('.xrow').forEach((el, i) => el.onclick = ev => {
    if (ev.target.closest('[data-rm]')) { const a = bmGet(); a.splice(i, 1); xset('bm.v1', a); renderBookmarks(head); return; }
    if (ev.target.closest('[data-bshare]')) { bmShare(l[i]); return; }
    playMoment(l[i]);
  });
}
// Recherche dans la bibliothèque
let libQ = '';
const nrm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function libBind() {
  const f = $('#libsf'); if (!f) return;
  f.onsubmit = e => e.preventDefault();
  view.insertAdjacentHTML('beforeend', '<div id="libres"></div>');
  $('#libq').oninput = e => { libQ = e.target.value; libResults(); };
  libResults();
}
function libResults() {
  const box = $('#libres'); if (!box) return;
  const q = nrm(libQ.trim()); view.classList.toggle('libq', !!q);
  if (!q) { box.innerHTML = ''; return; }
  const has = (...s) => s.some(v => nrm(v).includes(q));
  const d = listsData(), pods = [...Sync.favs(), ...Object.values(d.pods)].filter((f, i, a) => a.findIndex(y => y.feedUrl === f.feedUrl) === i).filter(f => has(f.title, f.author));
  const rads = radFavs().filter(r => has(r.name));
  const seen = new Set(), eps = [];
  const add = s => { if (s && s.url && !seen.has(s.url) && has(s.title, s.show)) { seen.add(s.url); eps.push(s); } };
  Sync.favs().forEach(f => { const fd = feedCache.get(f.feedUrl); if (fd) fd.episodes.forEach(e => add(epSnap(e, fd))); });
  [...dlMeta.values()].forEach(add); qGet().forEach(add); plData().forEach(p => p.items.forEach(add));
  const epl = eps.slice(0, 40);
  box.innerHTML = (pods.length ? '<h3 class="sect">Podcasts</h3>' + pods.map((f, i) => `<div class="item" data-pod="${i}"><img src="${esc(f.image || '')}" alt=""><div class="t"><b>${esc(f.title)}</b><small>${esc(f.author || '')}</small></div></div>`).join('') : '')
    + (rads.length ? '<h3 class="sect">Radios</h3>' + rads.map((r, i) => radRow(r, i)).join('') : '')
    + (epl.length ? `<h3 class="sect">Épisodes${eps.length > 40 ? ' (40 premiers)' : ''}</h3>` + epl.map(s => rowHtml(s, `<button class="ibtn playb" data-play aria-label="Lire">${IC.play}</button>`)).join('') : '')
    + (!pods.length && !rads.length && !epl.length ? '<p class="dim">Rien trouvé dans ta bibliothèque. Pour chercher de nouveaux podcasts ou radios, utilise l\'onglet Découvrir.</p>' : '');
  box.onclick = ev => {
    const p = ev.target.closest('[data-pod]'); if (p) { openFeed(pods[+p.dataset.pod]); return; }
    const r = ev.target.closest('.item.radio'); if (r) { const rr = rads[+r.dataset.i]; if (ev.target.closest('[data-rfav]')) { radToggle(rr); setStar(ev.target.closest('[data-rfav]'), radIsFav(rr)); } else playRadio(rr); return; }
    const x = ev.target.closest('.xrow'); if (x) { const i = [...box.querySelectorAll('.xrow')].indexOf(x); if (i >= 0) playList([epl[i]], 0); }
  };
}
// Réglages : retour automatique, Wi-Fi, espace
const settingsExtraHtml = () => `<label>Lecture</label><p class="dim sm">Retour automatique à la reprise (après une pause)</p>${seg('rwseg', RW_OPTS, String(rwSecs()))}
  <label>Téléchargements</label><p><button type="button" id="wifi" class="tgl${wifiOnly() ? ' on' : ''}">Wi-Fi seulement : ${wifiOnly() ? 'activé' : 'désactivé'}</button></p><p class="dim sm">Activé : les téléchargements automatiques n'utilisent pas les données mobiles, et un téléchargement manuel demande confirmation.</p>
  <p id="stor" class="dim sm"></p><p><button id="dl-clear" type="button">Supprimer tous les téléchargements</button></p>
  <label>Raccourcis</label><p class="dim sm">Les raccourcis se règlent sur la page Accueil (Ajouter / Modifier). En plus, un appui long sur l'icône de l'app propose Reprendre, À écouter, Radios et Découvrir.</p>`;
function bindSettingsExtra() {
  const rs = $('#rwseg'); if (rs) rs.onclick = e => { const b = e.target.closest('button[data-v]'); if (!b) return; localStorage.setItem('rewind', b.dataset.v); rs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
  const w = $('#wifi'); if (w) w.onclick = () => { const on = !wifiOnly(); localStorage.setItem('dl.wifi', on ? '1' : '0'); w.classList.toggle('on', on); w.textContent = 'Wi-Fi seulement : ' + (on ? 'activé' : 'désactivé'); };
  const st = async () => {
    const el = $('#stor'); if (!el) return; const tot = [...dlMeta.values()].reduce((n, s) => n + (s.size || 0), 0);
    let q = ''; try { const e = await navigator.storage.estimate(); q = ` · espace utilisé par l'app : ${fmtSize(e.usage || 0)} sur ${fmtSize(e.quota || 0)} disponibles`; } catch {}
    el.textContent = `Hors ligne : ${dlMeta.size} épisode${dlMeta.size > 1 ? 's' : ''} (${fmtSize(tot)})${q}`;
  };
  st();
  const c = $('#dl-clear'); if (c) c.onclick = async () => { if (!dlMeta.size || !confirm('Supprimer tous les épisodes téléchargés ?')) return; for (const u of [...dlMeta.keys()]) await dlRemove(u); st(); toast('Téléchargements supprimés'); };
}
// Liens directs (raccourcis de l'icône, moments partagés, radios)
function handleHash() {
  const h = location.hash; if (!h || h.length < 4) return;
  const p = new URLSearchParams(h.slice(1)); history.replaceState(null, '', location.pathname + location.search);
  const go = (t, key, val) => { tab = t; if (key) localStorage.setItem(key, val); render(); };
  if (p.get('m')) {
    let o; try { o = b64d(p.get('m')); } catch { return; }
    const m = modal(`<h3>Moment partagé</h3><p><b>${esc(o.n || '')}</b></p><p class="dim">${esc(o.s || '')} · à ${hms(o.t || 0)}</p><div class="shbtns"><button class="abtn" id="mm-play">▶ Écouter à ce moment</button></div><button data-close class="ghost">Fermer</button>`);
    m.querySelector('#mm-play').onclick = () => { m.close(); playMoment({ u: o.u, title: o.n, show: o.s, art: o.a, image: o.i, feed: o.f, t: o.t }); };
    return;
  }
  const g = p.get('go');
  if (g === 'resume' || g === 'queue') go('home', 'hometab', 'q');
  else if (g === 'radios') go('favs', 'favtab', 'radio');
  else if (g === 'search') go('search');
  else if (g === 'radio' && p.get('u')) { go('favs', 'favtab', 'radio'); playRadio({ name: p.get('n') || 'Radio', url: p.get('u'), logo: '', rf: rfFor(p.get('n'), p.get('u')) }); }
}
// Branchements sur le lecteur (appelé une fois par app.js, après la création de l'élément audio)
function bootExtra() {
  let pausedAt = 0, lastT = 0;
  onAudio('pause', () => { if (!audio.ended && curEp && !curEp.live) pausedAt = Date.now(); saveLast(); });
  onAudio('play', () => {
    if (pausedAt && curEp && !curEp.live) { const gap = Date.now() - pausedAt, s = rwSecs(); if (s && gap > 5000 && audio.currentTime > s + 1) { try { audio.currentTime -= gap > 300000 ? Math.min(2 * s, 30) : s; } catch {} } }
    pausedAt = 0;
  });
  onAudio('timeupdate', () => { const n = Date.now(); if (n - lastT > 10000) { lastT = n; saveLast(); } });
  const bm = document.getElementById('bm'); if (bm) bm.onclick = bmAdd;
  addEventListener('hashchange', handleHash); setTimeout(handleHash, 400);
}

// ---------- Raccourcis personnalisables de l'accueil (synchronisés) ----------
const scGet = () => xget('shortcuts.v1', []);
let scEdit = false;
function shortcutsHtml() {
  const l = scGet(), tile = (s, i) => `<button type="button" class="sctile" data-sc="${i}">${(s.img || (s.k === 'radio' ? radLogo(s) : '')) ? `<img src="${esc(s.img || radLogo(s))}" alt="" onerror="this.remove()">` : `<span class="scini">${esc((s.name || '?').trim().charAt(0).toUpperCase())}</span>`}<span class="scn">${esc(s.name)}</span>${scEdit ? '<i class="scx" aria-hidden="true">✕</i>' : ''}</button>`;
  return `<div class="shortcuts"><div class="shhead"><b>Raccourcis</b><span><button type="button" class="tgl" id="scadd">＋ Ajouter</button>${l.length ? `<button type="button" class="tgl${scEdit ? ' on' : ''}" id="scedit">${scEdit ? 'Terminé' : 'Modifier'}</button>` : ''}</span></div>${l.length ? `<div class="shgrid">${l.map(tile).join('')}</div>` : '<p class="dim sm">Ajoute tes radios, podcasts, listes ou playlists préférés pour les lancer en un geste.</p>'}</div>`;
}
function bindShortcuts() {
  const l = scGet();
  const ed = $('#scedit'); if (ed) ed.onclick = () => { scEdit = !scEdit; renderFavs(); };
  const ad = $('#scadd'); if (ad) ad.onclick = scPicker;
  document.querySelectorAll('.sctile').forEach(b => b.onclick = () => {
    const i = +b.dataset.sc, s = l[i]; if (!s) return;
    if (scEdit) { l.splice(i, 1); xset('shortcuts.v1', l); renderFavs(); return; }
    if (s.k === 'radio') playRadio({ id: s.url, name: s.name, url: s.url, logo: s.img || radLogo(s), rf: s.rf || rfFor(s.name, s.url), tags: s.tags || '' });
    else if (s.k === 'pod') openFeed(s.pod);
    else if (s.k === 'pl') { const p = plData().find(x => x.id === s.id); if (p) { if (p.items.length) playPlaylist(p); else toast('Playlist vide'); } else toast('Playlist introuvable'); }
    else if (s.k === 'list') { tab = 'favs'; localStorage.setItem('favtab', 'pod'); localStorage.setItem('favlist', s.id); render(); }
  });
}
function scPicker() {
  const have = new Set(scGet().map(s => s.k + ':' + (s.url || s.id || (s.pod && s.pod.feedUrl)))), items = [];
  const rads = radFavs(); rads.forEach(r => items.push(['Radios', { k: 'radio', name: r.name, url: r.url, img: radLogo(r), rf: r.rf, tags: r.tags }]));
  RADIO_FR.filter(r => !rads.some(x => x.url === r.url)).forEach(r => items.push(['Radios', { k: 'radio', name: r.name, url: r.url, img: radLogo(r), rf: r.rf }]));
  Sync.favs().forEach(f => items.push(['Podcasts', { k: 'pod', name: f.title, img: f.image, pod: podSnap(f) }]));
  listsData().lists.forEach(x => items.push(['Listes de podcasts', { k: 'list', id: x.id, name: x.name }]));
  plData().forEach(p => items.push(['Playlists', { k: 'pl', id: p.id, name: p.name }]));
  const key = s => s.k + ':' + (s.url || s.id || (s.pod && s.pod.feedUrl));
  const groups = {}; items.filter(([, s]) => !have.has(key(s))).forEach(([g, s], n) => (groups[g] = groups[g] || []).push([s, n]));
  const flat = items.filter(([, s]) => !have.has(key(s))).map(([, s]) => s);
  let html = '<h3>Ajouter un raccourci</h3>'; let n = 0;
  for (const g of ['Radios', 'Podcasts', 'Listes de podcasts', 'Playlists']) {
    const arr = flat.map((s, i) => [s, i]).filter(([s]) => ({ radio: 'Radios', pod: 'Podcasts', list: 'Listes de podcasts', pl: 'Playlists' }[s.k] === g));
    if (arr.length) html += `<h4 class="sect">${g}</h4><div class="chips wrap">${arr.map(([s, i]) => `<button type="button" class="chip" data-i="${i}">${esc(s.name)}</button>`).join('')}</div>`;
  }
  if (!flat.length) html += '<p class="dim">Rien à ajouter pour l\'instant : mets des radios ou des podcasts en favoris, ou crée une playlist.</p>';
  const m = modal(html + '<button data-close class="ghost">Fermer</button>');
  m.querySelectorAll('.chip').forEach(b => b.onclick = () => { const l = scGet(); l.push(flat[+b.dataset.i]); xset('shortcuts.v1', l); m.close(); if (tab === 'home') renderFavs(); toast('Raccourci ajouté'); });
}
