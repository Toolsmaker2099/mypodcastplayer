const $ = s => document.querySelector(s);
const audio = $('#audio'), view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let tab = 'favs', feedCache = new Map(); // cache mémoire seulement (jamais de progression)

// ---------- Réseau (CORS : direct, puis proxy du worker) ----------
async function fetchText(url) {
  try { const r = await fetch(url); if (r.ok) return await r.text(); } catch {}
  const c = Sync.cfg();
  if (!c.url) throw new Error('Flux bloqué par CORS : configure le worker dans Réglages.');
  const r = await fetch(`${c.url.replace(/\/$/, '')}/proxy?url=${encodeURIComponent(url)}`, { headers: c.token ? { Authorization: 'Bearer ' + c.token } : {} });
  if (!r.ok) throw new Error('Proxy ' + r.status);
  return r.text();
}
async function loadFeed(feedUrl) {
  const doc = new DOMParser().parseFromString(await fetchText(feedUrl), 'text/xml');
  const ch = doc.querySelector('channel');
  if (!ch) throw new Error('Flux invalide');
  const txt = (n, s) => n.querySelector(s)?.textContent?.trim() || '';
  const img = doc.querySelector('channel > image > url')?.textContent || doc.getElementsByTagName('itunes:image')[0]?.getAttribute('href') || '';
  const feed = {
    feedUrl, title: txt(ch, 'title'), image: img,
    episodes: [...doc.querySelectorAll('item')].map(it => ({
      title: txt(it, 'title'), date: txt(it, 'pubDate'),
      url: it.querySelector('enclosure')?.getAttribute('url') || '',
    })).filter(e => e.url),
  };
  feedCache.set(feedUrl, feed);
  return feed;
}

// ---------- Vues ----------
function setTitle(t, back) { $('#title').textContent = t; $('#back').hidden = !back; $('#back').onclick = back || null; }
function showItem(f, star) {
  return `<div class="item" data-feed="${esc(f.feedUrl)}"><img src="${esc(f.image)}" alt=""><div class="t"><b>${esc(f.title)}</b><small>${esc(f.author || '')}</small></div>${star ? `<button class="star" data-star>${Sync.favs().some(x => x.feedUrl === f.feedUrl) ? '★' : '☆'}</button>` : ''}</div>`;
}
function toggleFav(f) {
  const l = Sync.favs(), i = l.findIndex(x => x.feedUrl === f.feedUrl);
  if (i >= 0) l.splice(i, 1); else l.push({ feedUrl: f.feedUrl, title: f.title, image: f.image, author: f.author });
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
function renderSearch() {
  view.innerHTML = '<form id="sf" class="row"><input type="search" id="q" placeholder="Rechercher un podcast…"><button>OK</button></form><div id="res"></div>';
  $('#sf').onsubmit = async e => {
    e.preventDefault();
    const q = $('#q').value.trim(); if (!q) return;
    $('#res').innerHTML = '<p class="dim">Recherche…</p>';
    try {
      const r = await (await fetch(`https://itunes.apple.com/search?media=podcast&limit=25&country=fr&term=${encodeURIComponent(q)}`)).json();
      const list = r.results.filter(x => x.feedUrl).map(x => ({ feedUrl: x.feedUrl, title: x.collectionName, image: x.artworkUrl100, author: x.artistName }));
      $('#res').innerHTML = list.map(f => showItem(f, true)).join('') || '<p class="dim">Aucun résultat.</p>';
      $('#res').querySelectorAll('.item').forEach((el, i) => {
        el.onclick = ev => { if (ev.target.closest('[data-star]')) { toggleFav(list[i]); ev.target.textContent = Sync.favs().some(x => x.feedUrl === list[i].feedUrl) ? '★' : '☆'; } else openFeed(list[i], () => render()); };
      });
    } catch (err) { $('#res').innerHTML = `<p class="dim">Erreur : ${esc(err.message)}</p>`; }
  };
}
async function openFeed(f, back) {
  setTitle(f.title, back || (() => render()));
  view.innerHTML = '<p class="dim">Chargement…</p>';
  try {
    const feed = feedCache.get(f.feedUrl) || await loadFeed(f.feedUrl);
    view.innerHTML = feed.episodes.slice(0, 100).map((e, i) => `<div class="item" data-i="${i}"><div class="t"><b>${esc(e.title)}</b><small>${esc(e.date.slice(0, 16))}</small></div><button class="star">▶</button></div>`).join('');
    view.querySelectorAll('.item').forEach(el => el.onclick = () => play(feed.episodes[el.dataset.i], feed.title, feed.image));
  } catch (err) { view.innerHTML = `<p class="dim">Erreur : ${esc(err.message)}</p>`; }
}
function renderSettings() {
  const c = Sync.cfg();
  view.innerHTML = `<label>Ajouter un flux RSS</label><form id="af" class="row"><input id="rss" placeholder="https://…/feed.xml"><button>Ajouter</button></form><p id="am" class="dim"></p>
  <label>Worker Cloudflare (URL)</label><input id="cu" value="${esc(c.url || '')}" placeholder="https://xxx.workers.dev">
  <label>Clé KV</label><input id="ck" value="${esc(c.key || '')}">
  <label>Token</label><input id="ct" type="password" value="${esc(c.token || '')}">
  <p><button id="cs">Enregistrer et synchroniser</button></p><p id="cm" class="dim"></p>`;
  $('#af').onsubmit = async e => {
    e.preventDefault();
    try { const f = await loadFeed($('#rss').value.trim()); toggleFav({ feedUrl: f.feedUrl, title: f.title, image: f.image }); $('#am').textContent = 'Ajouté : ' + f.title; $('#rss').value = ''; }
    catch (err) { $('#am').textContent = err.message; }
  };
  $('#cs').onclick = async () => {
    Sync.setCfg({ url: $('#cu').value.trim(), key: $('#ck').value.trim(), token: $('#ct').value.trim() });
    try { await Sync.pull(); $('#cm').textContent = 'Synchronisé.'; } catch (err) { $('#cm').textContent = 'Échec : ' + err.message; }
  };
}

// ---------- Lecture (toujours depuis 0, rien n'est mémorisé) ----------
function play(ep, show, art) {
  audio.src = ep.url; audio.currentTime = 0; audio.play().catch(() => {});
  $('#player').hidden = false; $('#np-title').textContent = ep.title; $('#np-show').textContent = show;
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: ep.title, artist: show, artwork: art ? [{ src: art, sizes: '512x512' }] : [] });
  }
}
audio.addEventListener('play', () => { $('#pp').textContent = '❚❚'; navigator.mediaSession && (navigator.mediaSession.playbackState = 'playing'); });
audio.addEventListener('pause', () => { $('#pp').textContent = '▶'; navigator.mediaSession && (navigator.mediaSession.playbackState = 'paused'); applyPendingReload(); });
audio.addEventListener('loadedmetadata', () => { $('#seek').max = Math.floor(audio.duration) || 0; });
audio.addEventListener('timeupdate', () => { if (!seeking) $('#seek').value = Math.floor(audio.currentTime); checkSleep(); });
let seeking = false;
$('#seek').oninput = () => { seeking = true; }; $('#seek').onchange = e => { audio.currentTime = +e.target.value; seeking = false; };
const toggle = () => audio.paused ? audio.play() : audio.pause();
const skip = d => { audio.currentTime = Math.max(0, audio.currentTime + d); };
$('#pp').onclick = toggle; $('#rw').onclick = () => skip(-15); $('#ff').onclick = () => skip(30);
if ('mediaSession' in navigator) {
  const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch {} };
  h('play', () => audio.play()); h('pause', () => audio.pause());
  h('seekbackward', () => skip(-15)); h('seekforward', () => skip(30));
  h('stop', () => audio.pause());
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
  await Promise.allSettled(Sync.favs().map(f => loadFeed(f.feedUrl)));
  if (tab === 'favs') renderFavs();
}
async function checkUpdates() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.register('sw.js');
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
