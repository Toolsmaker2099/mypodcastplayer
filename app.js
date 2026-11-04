const APP_VERSION = '2026-11-04.12';
const $ = s => document.querySelector(s);
const audio = $('#audio'), view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let tab = 'favs', feedCache = new Map(); // cache mémoire seulement (jamais de progression)

// ---------- Réseau (CORS : direct, puis proxy du worker) ----------
async function fetchText(url) {
  try { const r = await fetch(url); if (r.ok) return await r.text(); } catch {}
  const c = Sync.cfg();
  if (!c.proxy) throw new Error('Flux bloqué par CORS : configure le proxy dans Réglages.');
  const r = await fetch(`${c.proxy.replace(/\/$/, '')}/?url=${encodeURIComponent(url)}`);
  if (!r.ok) throw new Error('Proxy ' + r.status);
  return r.text();
}
async function loadFeed(feedUrl) {
  const doc = new DOMParser().parseFromString(await fetchText(feedUrl), 'text/xml');
  const ch = doc.querySelector('channel');
  if (!ch) throw new Error('Flux invalide');
  const txt = (n, s) => n.querySelector(s)?.textContent?.trim() || '';
  const img = doc.querySelector('channel > image > url')?.textContent || doc.getElementsByTagName('itunes:image')[0]?.getAttribute('href') || '';
  const ns = (n, t) => n.getElementsByTagName(t)[0]?.textContent?.trim() || '';
  const plain = h => { const d = new DOMParser().parseFromString(h || '', 'text/html'); return (d.body.textContent || '').replace(/\s+/g, ' ').trim(); };
  const episodes = [...doc.querySelectorAll('item')].map(it => ({
    title: txt(it, 'title'), date: txt(it, 'pubDate'),
    desc: plain(ns(it, 'content:encoded') || txt(it, 'description') || ns(it, 'itunes:summary')).slice(0, 700),
    dur: ns(it, 'itunes:duration'),
    url: it.querySelector('enclosure')?.getAttribute('url') || '',
  })).filter(e => e.url);
  const feed = {
    feedUrl, title: txt(ch, 'title'), image: img,
    author: ns(ch, 'itunes:author'),
    desc: plain(txt(ch, 'description') || ns(ch, 'itunes:summary')).slice(0, 900),
    genre: ch.getElementsByTagName('itunes:category')[0]?.getAttribute('text') || '',
    count: episodes.length, last: episodes[0]?.date || '',
    episodes,
  };
  feedCache.set(feedUrl, feed);
  return feed;
}

// ---------- Vues ----------
function setTitle(t, back) { $('#title').textContent = t; $('#back').hidden = !back; $('#back').onclick = back || null; }
const fmtDate = d => { const t = Date.parse(d); return t ? new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };
function durSec(d) {
  if (!d) return 0;
  const p = String(d).split(':').map(Number);
  const sec = p.length > 1 ? p.reduce((a, x) => a * 60 + (x || 0), 0) : p[0];
  return sec > 0 ? sec : 0;
}
function fmtDur(d) {
  const sec = durSec(d);
  if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}
const meta = f => [f.genre, f.count ? f.count + ' épisodes' : '', f.last ? 'dernier : ' + fmtDate(f.last) : ''].filter(Boolean).join(' · ');
function showItem(f, star) {
  return `<div class="item" data-feed="${esc(f.feedUrl)}"><img src="${esc(f.image)}" alt=""><div class="t"><b>${esc(f.title)}</b><small>${esc(f.author || '')}</small><small class="m">${esc(meta(f))}</small>${f.desc ? `<p class="d">${esc(f.desc)}</p>` : ''}</div>${star ? `<button class="star" data-star>${Sync.favs().some(x => x.feedUrl === f.feedUrl) ? '★' : '☆'}</button>` : ''}</div>`;
}
function toggleFav(f) {
  const l = Sync.favs(), i = l.findIndex(x => x.feedUrl === f.feedUrl);
  if (i >= 0) l.splice(i, 1); else l.push({ feedUrl: f.feedUrl, title: f.title, image: f.image, author: f.author, genre: f.genre, count: f.count, last: f.last, desc: (f.desc || '').slice(0, 300) });
  Sync.setFavs(l);
}
function render() {
  setTitle({ favs: 'Favoris', search: 'Recherche', settings: 'Réglages' }[tab]);
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  ({ favs: renderFavs, search: renderSearch, settings: renderSettings })[tab]();
}
function renderFavs() {
  const l = Sync.favs();
  view.innerHTML = l.length ? l.map(f => showItem(f, false)).join('') : '<p class="dim">Aucun favori. Utilise la recherche ou ajoute un flux RSS dans Réglages.</p>';
  view.querySelectorAll('.item').forEach((el, i) => el.onclick = () => openFeed(l[i]));
}
const PRODUCERS = [
  ['France Inter', /france inter/i], ['France Culture', /france culture/i], ['franceinfo', /franceinfo|france info/i],
  ['France TV', /france t[ée]l[ée]visions|france\.?\s?tv/i], ['Radio France', /radio france|france (inter|culture|info|bleu|musique)|\bmouv|\bfip\b/i],
  ['RTL', /\brtl\b/i], ['Europe 1', /europe 1/i], ['RFI', /\brfi\b|radio france internationale/i], ['Arte', /\barte\b/i],
];
let searchProd = '', searchQ = '';
function renderSearch() {
  view.innerHTML = `<form id="sf" class="row"><input type="search" id="q" placeholder="Rechercher un podcast…" value="${esc(searchQ)}"><button>OK</button></form>
    <div class="chips">${PRODUCERS.map(([n]) => `<button type="button" class="chip${n === searchProd ? ' on' : ''}" data-p="${esc(n)}">${esc(n)}</button>`).join('')}</div><div id="res"></div>`;
  const run = async () => {
    const q = $('#q').value.trim(); searchQ = q;
    const prod = PRODUCERS.find(p => p[0] === searchProd);
    if (!q && !prod) { $('#res').innerHTML = ''; return; }
    $('#res').innerHTML = '<p class="dim">Recherche…</p>';
    try {
      const url = q ? `https://itunes.apple.com/search?media=podcast&limit=200&country=fr&term=${encodeURIComponent(q)}`
                    : `https://itunes.apple.com/search?media=podcast&limit=200&country=fr&attribute=artistTerm&term=${encodeURIComponent(prod[0])}`;
      const r = await (await fetch(url)).json();
      let res = r.results.filter(x => x.feedUrl);
      if (prod) res = res.filter(x => prod[1].test(x.artistName || '') || prod[1].test(x.collectionName || ''));
      const list = res.slice(0, 50).map(x => ({ feedUrl: x.feedUrl, title: x.collectionName, image: x.artworkUrl100, author: x.artistName, genre: x.primaryGenreName, count: x.trackCount, last: x.releaseDate }));
      $('#res').innerHTML = list.map(f => showItem(f, true)).join('') || '<p class="dim">Aucun résultat.</p>';
      $('#res').querySelectorAll('.item').forEach((el, i) => {
        el.onclick = ev => { if (ev.target.closest('[data-star]')) { toggleFav(list[i]); ev.target.textContent = Sync.favs().some(x => x.feedUrl === list[i].feedUrl) ? '★' : '☆'; } else openFeed(list[i], () => render()); };
      });
    } catch (err) { $('#res').innerHTML = `<p class="dim">Erreur : ${esc(err.message)}</p>`; }
  };
  $('#sf').onsubmit = e => { e.preventDefault(); run(); };
  view.querySelectorAll('.chip').forEach(b => b.onclick = () => {
    searchProd = searchProd === b.dataset.p ? '' : b.dataset.p;
    view.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x.dataset.p === searchProd));
    run();
  });
  if (searchQ || searchProd) run();
}
async function openFeed(f, back) {
  setTitle(f.title, back || (() => render()));
  view.innerHTML = '<p class="dim">Chargement…</p>';
  try {
    const feed = feedCache.get(f.feedUrl) || await loadFeed(f.feedUrl);
    const isFav = () => Sync.favs().some(x => x.feedUrl === feed.feedUrl);
    view.innerHTML = `<div class="hero"><img src="${esc(feed.image)}" alt=""><div><b>${esc(feed.title)}</b><small>${esc(feed.author)}</small><small class="m">${esc(meta(feed))}</small></div></div>
      <p class="d full">${esc(feed.desc)}</p><div class="skip"><label for="skipin">Sauter les premières secondes</label><input id="skipin" type="number" inputmode="numeric" min="0" step="1" placeholder="0" value="${skipFor(feed.feedUrl) || ''}"></div><p><button id="fav">${isFav() ? '★ Dans les favoris' : '☆ Ajouter aux favoris'}</button></p>` +
      `<div class="filters"><select id="ord"><option value="desc">Plus récents d'abord</option><option value="asc">Plus anciens d'abord</option></select>
        <select id="mind"><option value="0">Toutes durées</option>${[10, 20, 30, 45, 60, 90, 120].map(m => `<option value="${m}">≥ ${m} min</option>`).join('')}</select><button id="chain" type="button"></button></div><div id="eps"></div>`;
    const showChain = () => { $('#chain').textContent = chain ? '↻ Enchaîner : oui' : '↻ Enchaîner : non'; $('#chain').style.color = chain ? 'var(--acc)' : ''; };
    $('#chain').onclick = () => { chain = !chain; try { localStorage.setItem('chain', chain ? '1' : '0'); } catch {} showChain(); };
    showChain();
    const prefs = () => { try { return { order: 'desc', min: 0, ...JSON.parse(localStorage.getItem('epprefs')) }; } catch { return { order: 'desc', min: 0 }; } };
    const p0 = prefs(); $('#ord').value = p0.order; $('#mind').value = String(p0.min);
    const drawEps = () => {
      const p = { order: $('#ord').value, min: +$('#mind').value };
      try { localStorage.setItem('epprefs', JSON.stringify(p)); } catch {}
      let list = feed.episodes.map((e, i) => ({ e, i, t: Date.parse(e.date) || 0 }));
      if (p.min) list = list.filter(x => !durSec(x.e.dur) || durSec(x.e.dur) >= p.min * 60); // durée inconnue : conservé
      list.sort((x, y) => p.order === 'asc' ? x.t - y.t || y.i - x.i : y.t - x.t || x.i - y.i);
      curList = list.slice(0, 150).map(x => x.e);
      $('#eps').innerHTML = (list.slice(0, 150).map(({ e, i }) => `<div class="item ep" data-i="${i}"><div class="t"><b>${esc(e.title)}</b><small class="m">${esc([fmtDate(e.date), fmtDur(e.dur)].filter(Boolean).join(' · '))}</small>${e.desc ? `<p class="d">${esc(e.desc)}</p>` : ''}</div><button class="star" data-more aria-label="Détails">⌄</button><button class="star">▶</button></div>`).join('')) || '<p class="dim">Aucun épisode ne correspond au filtre.</p>';
    };
    $('#ord').onchange = $('#mind').onchange = drawEps; drawEps();
    $('#skipin').oninput = e => {
      const m = skipMap(), v = Math.max(0, Math.floor(+e.target.value) || 0);
      if (v) m[feed.feedUrl] = v; else delete m[feed.feedUrl];
      try { localStorage.setItem('skip.v1', JSON.stringify(m)); } catch {}
    };
    $('#fav').onclick = () => { toggleFav(feed); $('#fav').textContent = isFav() ? '★ Dans les favoris' : '☆ Ajouter aux favoris'; };
    $('#eps').onclick = ev => {
      const el = ev.target.closest('.ep'); if (!el) return;
      if (ev.target.closest('[data-more]')) { el.classList.toggle('open'); return; }
      const ep = feed.episodes[el.dataset.i];
      queue = curList.slice(); qi = queue.indexOf(ep); qCtx = { show: feed.title, art: feed.image, feedUrl: feed.feedUrl };
      play(ep, feed.title, feed.image, feed.feedUrl);
    };
  } catch (err) { view.innerHTML = `<p class="dim">Erreur : ${esc(err.message)}</p>`; }
}
function renderSettings() {
  const c = Sync.cfg();
  view.innerHTML = `<label>Ajouter un flux RSS</label><form id="af" class="row"><input id="rss" placeholder="https://…/feed.xml"><button>Ajouter</button></form><p id="am" class="dim"></p>
  <label>Sauvegarde des favoris</label><div id="bk"></div><p id="cm" class="dim"></p>
  <label>Proxy RSS (worker, si un flux est bloqué)</label><input id="cu" value="${esc(c.proxy || '')}" placeholder="https://rss.xxx.workers.dev">
  <p><button id="cs">Enregistrer le proxy</button></p>
  <label>Application</label><p class="dim">Version ${APP_VERSION}</p><p><button id="upd">Forcer la mise à jour</button></p>`;
  $('#upd').onclick = async () => {
    try { (await navigator.serviceWorker.getRegistrations()).forEach(r => r.unregister()); (await caches.keys()).forEach(k => caches.delete(k)); } catch {}
    location.reload();
  };
  $('#af').onsubmit = async e => {
    e.preventDefault();
    try { const f = await loadFeed($('#rss').value.trim()); toggleFav({ feedUrl: f.feedUrl, title: f.title, image: f.image }); $('#am').textContent = 'Ajouté : ' + f.title; $('#rss').value = ''; }
    catch (err) { $('#am').textContent = err.message; }
  };
  const msg = t => { $('#cm').textContent = t; };
  function drawBackup() {
    const code = Sync.enabled() ? Sync.cfg().code : '';
    $('#bk').innerHTML = code
      ? `<div class="code">${esc(code)}</div><div class="row"><button id="bcopy">Copier</button><button id="bsync">Synchroniser</button><button id="bleave">Quitter</button></div><p class="dim">Saisis ce code sur un autre appareil pour retrouver tes favoris.</p>`
      : `<div class="row"><button id="bnew" style="flex:1">Créer une nouvelle sauvegarde</button></div>
         <label>Ou récupérer une sauvegarde existante</label>
         <div class="row"><input id="bin" placeholder="XXXX-XXXX-XXXX-XXXX" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" inputmode="text"><button id="brest">Récupérer</button></div>`;
    if (code) {
      $('#bcopy').onclick = () => { navigator.clipboard?.writeText(code); msg('Code copié.'); };
      $('#bsync').onclick = async () => { try { await Sync.pull(); msg('Synchronisé.'); } catch (e) { msg('Échec : ' + e.message); } };
      $('#bleave').onclick = () => { if (confirm('Quitter cette sauvegarde ? Les favoris restent sur cet appareil.')) { Sync.leave(); msg(''); drawBackup(); } };
    } else {
      $('#bnew').onclick = async () => { msg('Création…'); try { await Sync.create(); msg('Sauvegarde créée. Note bien ce code.'); drawBackup(); } catch (e) { msg('Échec : ' + e.message); } };
      $('#bin').oninput = e => { e.target.value = Sync.fmt(e.target.value); };
      $('#brest').onclick = async () => {
        const v = $('#bin').value;
        if (v.length !== 19) return msg('Le code doit comporter 16 caractères (XXXX-XXXX-XXXX-XXXX).');
        msg('Recherche…');
        try { await Sync.restore(v); msg('Sauvegarde récupérée.'); drawBackup(); refreshFavs(); } catch (e) { msg(e.message.startsWith('Code') ? e.message : 'Échec : ' + e.message); }
      };
    }
  }
  drawBackup();
  $('#cs').onclick = () => { Sync.setCfg({ ...Sync.cfg(), proxy: $('#cu').value.trim() }); msg('Proxy enregistré.'); };
}

// ---------- Lecture (toujours depuis 0, rien n'est mémorisé) ----------
let chain = localStorage.getItem('chain') === '1', curList = [], queue = [], qi = -1, qCtx = null;
function playAt(i) { if (i < 0 || i >= queue.length) return false; qi = i; play(queue[i], qCtx.show, qCtx.art, qCtx.feedUrl); return true; }
audio.addEventListener('ended', () => { if (chain) playAt(qi + 1); });
const skipMap = () => { try { return JSON.parse(localStorage.getItem('skip.v1')) || {}; } catch { return {}; } };
const skipFor = u => +skipMap()[u] || 0;
const syncNav = () => { $('#prev').disabled = qi <= 0; $('#next').disabled = qi < 0 || qi >= queue.length - 1; };
$('#prev').onclick = () => playAt(qi - 1); $('#next').onclick = () => playAt(qi + 1);
function play(ep, show, art, feedUrl) {
  syncNav();
  audio.crossOrigin = nightOn ? 'anonymous' : null;
  audio.src = ep.url; audio.currentTime = 0; audio.play().catch(() => {});
  const skip = skipFor(feedUrl); // intro à sauter : réglage fixe par podcast, pas une progression de lecture
  if (skip > 0) audio.addEventListener('loadedmetadata', () => { if (audio.duration > skip) audio.currentTime = skip; }, { once: true });
  $('#player').hidden = false; $('#np-title').textContent = ep.title; $('#np-show').textContent = show;
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: ep.title, artist: show, artwork: art ? [{ src: art, sizes: '512x512' }] : [] });
  }
}
audio.addEventListener('play', () => { $('#pp').textContent = '❚❚'; navigator.mediaSession && (navigator.mediaSession.playbackState = 'playing'); });
audio.addEventListener('pause', () => { $('#pp').textContent = '▶'; navigator.mediaSession && (navigator.mediaSession.playbackState = 'paused'); applyPendingReload(); });
const seekEl = $('#seek');
let seeking = false;
const clock = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0'); };
function syncTimes() {
  const d = audio.duration, ok = isFinite(d) && d > 0;
  $('#t-cur').textContent = clock(audio.currentTime);
  $('#t-tot').textContent = ok ? 'Total ' + clock(d) : 'Total --:--';
  $('#t-rem').textContent = ok ? '-' + clock(d - audio.currentTime) : '-';
}
const paint = () => { const m = +seekEl.max; seekEl.style.setProperty('--p', m > 0 ? Math.min(1, Math.max(0, +seekEl.value / m)) : 0); };
function syncSeek() {
  syncTimes();
  const d = audio.duration;
  if (!isFinite(d) || d <= 0) { seekEl.max = 0; seekEl.value = 0; paint(); return; }
  seekEl.max = d;
  if (!seeking) seekEl.value = audio.ended ? d : Math.min(audio.currentTime, d);
  paint();
}
function resetSeek() { seeking = false; seekEl.max = 0; seekEl.value = 0; syncTimes(); paint(); }
['loadstart', 'emptied'].forEach(ev => audio.addEventListener(ev, resetSeek));
['loadedmetadata', 'durationchange', 'timeupdate', 'seeked', 'ended'].forEach(ev => audio.addEventListener(ev, syncSeek));
audio.addEventListener('timeupdate', checkSleep);
seekEl.oninput = () => { seeking = true; paint(); $('#t-cur').textContent = clock(+seekEl.value); $('#t-rem').textContent = '-' + clock(audio.duration - seekEl.value); };
seekEl.onchange = e => { audio.currentTime = +e.target.value; seeking = false; };
const toggle = () => audio.paused ? audio.play() : audio.pause();
const skip = d => { audio.currentTime = Math.max(0, audio.currentTime + d); };
$('#pp').onclick = toggle; $('#rw').onclick = () => skip(-15); $('#ff').onclick = () => skip(30);
if ('mediaSession' in navigator) {
  const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch {} };
  h('play', () => audio.play()); h('pause', () => audio.pause());
  h('seekbackward', () => skip(-15)); h('seekforward', () => skip(30));
  h('stop', () => audio.pause());
  h('nexttrack', () => playAt(qi + 1)); h('previoustrack', () => playAt(qi - 1));
}

// ---------- Minuterie d'arrêt (désactivée par défaut, non persistée) ----------
let sleepEnd = 0, sleepT = null;
const OPTS = [0, 15, 30, 45, 60, 90];
$('#sleep').onclick = () => {
  const cur = sleepEnd ? Math.round((sleepEnd - Date.now()) / 60000) : 0;
  const next = OPTS.find(m => m > cur) ?? 0; // cycle : Off → 15 → … → 90 → Off
  setSleep(next);
};
function setSleep(min) {
  clearTimeout(sleepT); sleepEnd = min ? Date.now() + min * 60000 : 0;
  $('#sleep').textContent = min ? `☾ ${min} min` : '☾ Off';
  if (min) sleepT = setTimeout(checkSleep, min * 60000 + 100);
}
function checkSleep() {
  if (sleepEnd && Date.now() >= sleepEnd) { audio.pause(); setSleep(0); }
}

// ---------- Mises à jour : app + podcasts à chaque ouverture ----------
let pendingReload = false;
function applyPendingReload() { if (pendingReload && audio.paused) location.reload(); }
async function refreshFavs() {
  try { await Sync.pull(); } catch {}
  feedCache.clear();
  const res = await Promise.allSettled(Sync.favs().map(f => loadFeed(f.feedUrl)));
  const upd = Sync.favs().map((f, i) => { const v = res[i].value; return v ? { ...f, title: v.title, image: v.image || f.image, author: v.author, genre: v.genre, count: v.count, last: v.last, desc: v.desc.slice(0, 300) } : f; });
  if (JSON.stringify(upd) !== JSON.stringify(Sync.favs())) localStorage.setItem('favs.v1', JSON.stringify(upd)); // maj locale des infos, sans resynchroniser
  if (tab === 'favs') renderFavs();
}
async function checkUpdates() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
  reg.update().catch(() => {});
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!navigator.serviceWorker.controller) return;
    pendingReload = true; applyPendingReload(); // jamais de coupure d'une lecture en cours
  });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkUpdates(); refreshFavs(); } });
document.querySelectorAll('nav button').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
render(); checkUpdates(); refreshFavs();

// ---------- Bouton / aide d'installation (tant que non installée) ----------
(() => {
  const box = $('#install'), txt = $('#install-text'), btn = $('#install-btn');
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone()) return;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  if (!ios && !android) return; // mobile uniquement
  const iosSafari = ios && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
  let deferred = null;
  const show = (t, withBtn) => { txt.textContent = t; btn.hidden = !withBtn; box.hidden = false; };
  if (ios) {
    show(iosSafari
      ? "Pour installer : touche le bouton Partager (carré avec une flèche), puis « Sur l'écran d'accueil ». Nécessaire pour la lecture écran verrouillé."
      : "Pour installer l'app sur iPhone, ouvre cette page dans Safari, puis Partager → « Sur l'écran d'accueil ».", false);
  } else {
    show("Installe l'app pour la lecture en arrière-plan. Si le bouton ne fait rien : menu du navigateur (⋮) → « Installer l'application » ou « Ajouter à l'écran d'accueil ».", false);
  }
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferred = e;
    show("Installe l'app sur ton téléphone pour l'utiliser comme une vraie application.", true);
  });
  btn.onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; box.hidden = true; };
  window.addEventListener('appinstalled', () => { box.hidden = true; });
})();

// ---------- Mode nuit (compresseur : atténue les passages forts) ----------
// Web Audio exige un fichier servi avec CORS ; sinon le son serait coupé. On teste donc avant de brancher le traitement.
let nightOn = localStorage.getItem('night') === '1', ctx = null, comp = null, makeup = null, nightMsg = '';
const nightBtn = $('#night');
const showNight = () => { nightBtn.textContent = nightOn ? '☼ Nuit on' : '☼ Nuit off'; nightBtn.style.color = nightOn ? 'var(--acc)' : ''; };
function nightParams() {
  if (!comp) return;
  comp.threshold.value = nightOn ? -45 : 0; comp.ratio.value = nightOn ? 12 : 1;
  comp.knee.value = 30; comp.attack.value = 0.005; comp.release.value = 0.3;
  makeup.gain.value = nightOn ? 1.7 : 1;
}
function buildGraph() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaElementSource(audio);
  comp = ctx.createDynamicsCompressor(); makeup = ctx.createGain();
  src.connect(comp); comp.connect(makeup); makeup.connect(ctx.destination);
}
function reloadCurrent(play) {
  if (!audio.src) return;
  const t = audio.currentTime, u = audio.src;
  audio.src = u; audio.load();
  audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = t; } catch {} if (play) audio.play().catch(() => {}); }, { once: true });
}
function nightFailed() {
  nightOn = false; localStorage.setItem('night', '0'); showNight();
  alert("Ce podcast n'autorise pas le mode nuit (fichier audio non compatible). Mode nuit désactivé.");
  if (ctx) location.reload(); // le son resterait coupé une fois branché : on repart proprement
  else { audio.crossOrigin = null; reloadCurrent(true); }
}
nightBtn.onclick = () => {
  nightOn = !nightOn; localStorage.setItem('night', nightOn ? '1' : '0'); showNight();
  if (!nightOn) { nightParams(); return; }
  if (audio.src && !ctx) { // première activation : recharger avec CORS puis brancher si OK
    const wasPlaying = !audio.paused;
    audio.crossOrigin = 'anonymous';
    audio.addEventListener('canplay', () => { buildGraph(); ctx.resume(); nightParams(); }, { once: true });
    reloadCurrent(wasPlaying);
  } else { if (ctx) ctx.resume(); nightParams(); }
};
audio.addEventListener('error', () => { if (nightOn && audio.src) nightFailed(); });
audio.addEventListener('canplay', () => { if (nightOn && !ctx && audio.crossOrigin) { buildGraph(); ctx.resume(); nightParams(); } else if (ctx) ctx.resume(); });
showNight();
