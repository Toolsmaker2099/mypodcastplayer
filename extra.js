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
    const cn = navigator.connection; if (cn && (cn.saveData || cn.type === 'cellular')) return;
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
  const b = document.querySelector('nav [data-tab=listen]'); if (!b) return;
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
