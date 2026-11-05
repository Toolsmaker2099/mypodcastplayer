const APP_VERSION = '2026-11-05.128';
const $ = s => document.querySelector(s);
const svg = (d, n = 20, fill = false) => `<svg viewBox="0 0 24 24" width="${n}" height="${n}" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true">${d}</svg>`;
const IC = {
  star: svg('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>', 21),
  chev: svg('<path d="m6 9 6 6 6-6"/>', 20),
  play: svg('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>', 18, true),
  playBig: svg('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>', 28, true),
  pause: svg('<rect x="6" y="5" width="4.5" height="14" rx="1.3"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.3"/>', 28, true),
};
IC.moon = svg('<path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z"/>', 17);
IC.timer = svg('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 2.5h5"/>', 17);
IC.eq = svg('<path d="M5 14v4M9 6v12M13 10v8M17 4v14M21 12v6"/>', 17);
IC.share = svg('<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="m8.3 10.8 7.4-4.3M8.3 13.2l7.4 4.3"/>', 18);
IC.scan = svg('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"/>', 18);
IC.chain = svg('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>', 17);
IC.track = svg('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.2 9.5"/>', 17);
IC.select = svg('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m8 12 3 3 5-6"/>', 17);
IC.link = svg('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>', 20);
IC.list = svg('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>', 18);
const labeled = (ic, t) => `${ic}<span>${t}</span>`;
const starBtn = on => `<button class="ibtn star${on ? ' on' : ''}" data-star aria-label="Coup de cœur" aria-pressed="${on}">${IC.star}</button>`;
const setStar = (b, on) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); };
const el1 = $('#audio'), el2 = new Audio(), view = $('#view');
el2.preload = 'none';
// Deux éléments audio : el1 passe par le traitement audio (mode nuit, visualiseur réel) ; el2 lit tel quel les podcasts dont l'hébergeur bloque l'analyse (CORS).
let audio = el1;
const onAudio = (ev, fn, opts) => { const h = e => { if (e.target === audio) fn(e); }; el1.addEventListener(ev, h, opts); el2.addEventListener(ev, h, opts); };
function useEl(el) { if (audio === el) return; const old = audio; audio = el; old.pause(); old.removeAttribute('src'); old.load(); }
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let tab = 'home', feedCache = new Map(); // cache mémoire seulement (jamais de progression)

// ---------- Réseau (CORS : direct, puis proxy du worker) ----------
async function fetchText(url) {
  try { const r = await fetch(url); if (r.ok) return await r.text(); } catch {}
  const px = Sync.proxy();
  if (!px) throw new Error('Flux bloqué par CORS : configure le proxy dans Réglages.');
  const r = await fetch(`${px}/?url=${encodeURIComponent(url)}`);
  if (r.status === 404 || r.status === 410) throw new Error("Ce flux n'existe plus (erreur " + r.status + ' : adresse périmée ou déplacée).');
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
  const lines = h => plain((h || '').replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, '\n$&')).length ? new DOMParser().parseFromString((h || '').replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, m => m + '\n'), 'text/html').body.textContent.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim() : '';
  const episodes = [...doc.querySelectorAll('item')].map(it => ({
    title: txt(it, 'title'), date: txt(it, 'pubDate'),
    desc: plain(ns(it, 'content:encoded') || txt(it, 'description') || ns(it, 'itunes:summary')).slice(0, 700),
    notes: lines(ns(it, 'content:encoded') || txt(it, 'description') || ns(it, 'itunes:summary')).slice(0, 6000),
    chapUrl: it.getElementsByTagName('podcast:chapters')[0]?.getAttribute('url') || '',
    dur: ns(it, 'itunes:duration'),
    url: it.querySelector('enclosure')?.getAttribute('url') || '',
    image: it.getElementsByTagName('itunes:image')[0]?.getAttribute('href') || '',
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
function showItem(f, star, lst = !!f.feedUrl) {
  const ld = listsData(), tags = (ld.members[f.feedUrl] || []).map(id => (ld.lists.find(x => x.id === id) || {}).name).filter(Boolean);
  return `<div class="item${f.feedUrl ? '' : ' off'}" data-feed="${esc(f.feedUrl)}"><img src="${esc(f.image)}" alt=""><div class="t"><b>${esc(f.title)}</b><small>${esc(f.author || '')}</small><small class="m">${esc(meta(f))}</small>${tags.length || newBadge(f) ? `<div class="ltags">${newBadge(f)}${tags.map(t => `<span class="ltag">${esc(t)}</span>`).join('')}</div>` : ''}${f.desc ? `<p class="d">${esc(f.desc)}</p>` : ''}</div><div class="acts">${lst ? `<button class="ibtn lbtn" data-listadd aria-label="Ajouter à une liste" title="Ajouter à une liste">${IC.list}</button>` : ''}${star ? starBtn(Sync.favs().some(x => x.feedUrl === f.feedUrl)) : ''}</div></div>`;
}
function refreshTags(u) { // met à jour les pastilles de listes des cartes visibles pour ce podcast
  const ld = listsData(), names = (ld.members[u] || []).map(id => (ld.lists.find(x => x.id === id) || {}).name).filter(Boolean);
  document.querySelectorAll('.item[data-feed]').forEach(it => {
    if (it.dataset.feed !== u) return;
    let box = it.querySelector('.ltags');
    if (!names.length) { if (box) box.remove(); return; }
    if (!box) { box = document.createElement('div'); box.className = 'ltags'; const m = it.querySelector('.t small.m'); if (m) m.after(box); else it.querySelector('.t').appendChild(box); }
    box.innerHTML = names.map(t => `<span class="ltag">${esc(t)}</span>`).join('');
  });
}
function toggleFav(f) {
  const l = Sync.favs(), i = l.findIndex(x => x.feedUrl === f.feedUrl);
  if (i < 0 && blocked(f)) { toast('Ce média n\'est pas disponible dans l\'app'); return; }
  if (i >= 0) l.splice(i, 1); else l.push({ feedUrl: f.feedUrl, title: f.title, image: f.image, author: f.author, genre: f.genre, count: f.count, last: f.last, desc: (f.desc || '').slice(0, 300) });
  Sync.setFavs(l);
}
function render() {
  setTitle({ home: 'Accueil', favs: 'Bibliothèque', search: 'Découvrir', settings: 'Réglages' }[tab]);
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  ({ home: renderFavs, favs: renderFavs, search: renderDiscover, settings: renderSettings })[tab]();
}
// ---------- Listes de favoris : « Tous les favoris » (principale, toujours là) + listes personnalisées ----------
// Les listes personnalisées sont indépendantes des « Coups de cœur » : retirer un podcast des coups de cœur ne le retire pas des autres listes (on garde donc sa fiche dans « pods »).
const listsData = () => { try { const d = JSON.parse(localStorage.getItem('lists.v1')); return { lists: (d && d.lists) || [], members: (d && d.members) || {}, pods: (d && d.pods) || {} }; } catch { return { lists: [], members: {}, pods: {} }; } };
const podSnap = f => ({ feedUrl: f.feedUrl, title: f.title, image: f.image, author: f.author, genre: f.genre, count: f.count, last: f.last, desc: (f.desc || '').slice(0, 300) });
const saveLists = d => { try { localStorage.setItem('lists.v1', JSON.stringify(d)); } catch {} };
const newId = () => Math.random().toString(36).slice(2, 8);
function askName(title, value = '') {
  return new Promise(ok => withShare(() => {
    const m = modal(`<h3>${esc(title)}</h3><form id="nf" class="row"><input id="nn" maxlength="40" value="${esc(value)}" placeholder="Nom de la liste" autocomplete="off"><button class="abtn">OK</button></form><button data-close class="ghost">Annuler</button>`);
    let done = false;
    m.querySelector('#nf').onsubmit = e => { e.preventDefault(); const v = m.querySelector('#nn').value.trim(); if (v) { done = true; m.close(); ok(v); } };
    m.onclose = () => { if (!done) ok(null); };
    setTimeout(() => { const n = m.querySelector('#nn'); n.focus(); n.select(); }, 60);
  }));
}
function renderFavs() { if (tab === 'home') renderHome(); else renderLibrary(); }
function renderLibrary() {
  const ft = ['pod', 'pl', 'radio', 'bm', 'dl'].includes(localStorage.getItem('favtab')) ? localStorage.getItem('favtab') : 'pod';
  const head = `<div class="libhead"><form class="searchbar libsb" id="libsf">${SVG_SEARCH}<input type="search" id="libq" placeholder="Rechercher dans ma bibliothèque" value="${esc(libQ)}" autocomplete="off" enterkeyhint="search"></form><div class="favsegw">${seg('favseg', [['pod', 'Podcasts'], ['pl', 'Playlists'], ['radio', 'Radios'], ['bm', 'Signets'], ['dl', 'Hors ligne']], ft)}</div></div>`;
  if (ft === 'dl') renderDownloads(head);
  else if (ft === 'bm') renderBookmarks(head);
  else if (ft === 'radio') renderRadios(head, 'lib');
  else if (ft === 'pl') { renderPlaylists(); view.insertAdjacentHTML('afterbegin', head); bindFavSeg(); }
  else renderPodcastFavs(head);
  libBind();
}
function bindFavSeg() {
  document.querySelectorAll('#favseg button').forEach(b => { const m = b.textContent.match(/^(.*\D) (\d+)$/); if (m) b.innerHTML = esc(m[1]) + ' <span class="cnt">' + m[2] + '</span>'; }); // le nombre devient une pastille
  const s = $('#favseg'); if (s) s.onclick = e => { const b = e.target.closest('button[data-v]'); if (b) { localStorage.setItem(tab === 'home' ? 'hometab' : 'favtab', b.dataset.v); renderFavs(); } };
  if (tab === 'home') bindShortcuts();
  const r = $('#resume'); if (r) r.onclick = () => { if (!curEp || $('#player').hidden) playLast(); else if (audio.paused) audio.play().catch(() => {}); else audio.pause(); setTimeout(renderFavs, 250); };
}
function renderPodcastFavs(head) {
  const all = Sync.favs().filter(f => !blocked(f)), d = listsData();
  let cur = localStorage.getItem('favlist') || 'all'; if (cur !== 'all' && !d.lists.some(x => x.id === cur)) cur = 'all';
  const l = cur === 'all' ? all : Object.keys(d.members).filter(u => d.members[u].includes(cur)).map(u => d.pods[u] || all.find(f => f.feedUrl === u)).filter(Boolean);
  const chips = `<div class="tglrow lchips"><button type="button" class="tgl${cur === 'all' ? ' on' : ''}" data-l="all">${visHtml(VIS_HEART)}Coups de cœur</button>${d.lists.map(x => `<button type="button" class="tgl${cur === x.id ? ' on' : ''}" data-l="${x.id}">${visHtml(x.ic)}${esc(x.name)}</button>`).join('')}<button type="button" class="tgl" data-l="new">+ Nouvelle liste</button></div>` +
    `<div class="lmanagebox"><div class="lmtitle">Actions sur la liste <b>« ${esc(cur === 'all' ? 'Coups de cœur' : (d.lists.find(x => x.id === cur) || {}).name || '')} »</b></div><div class="tglrow lmanage">${cur !== 'all' ? '<button type="button" class="tgl" data-l="rename">Renommer</button><button type="button" class="tgl" data-l="visual">Visuel</button>' : ''}${l.length ? '<button type="button" class="tgl" data-l="share">Partager</button>' : ''}${cur !== 'all' ? '<button type="button" class="tgl" data-l="delete">Supprimer la liste</button>' : ''}</div></div>`;
  const empty = cur === 'all' ? '<p class="dim">Aucun coup de cœur. Utilise l\'onglet Ajouter ou la recherche.</p>' : '<p class="dim">Cette liste est vide. Ouvre un podcast des favoris et touche « Listes » pour l\'y ajouter.</p>';
  view.innerHTML = head + chips + (l.length ? l.map(f => cur === 'all' ? showItem(f, true) : showItem(f, false).replace(/<\/div><\/div>$/, '</div><button class="ibtn" data-unlist aria-label="Retirer de la liste" title="Retirer de la liste">✕</button></div>')).join('') : empty);
  bindFavSeg();
  view.querySelectorAll('[data-l]').forEach(b => b.onclick = async () => {
    const k = b.dataset.l;
    if (k === 'new') { const n = await askName('Nouvelle liste'); if (n) { const dd = listsData(), id = newId(); dd.lists.push({ id, name: n }); saveLists(dd); localStorage.setItem('favlist', id); renderFavs(); } return; }
    if (k === 'share') { const nm = cur === 'all' ? 'Coups de cœur' : d.lists.find(y => y.id === cur).name; withShare(() => shareCollection('list', nm, l.map(f => ({ ...podSnap(f), desc: (f.desc || '').slice(0, 120) })))); return; }
    if (k === 'visual') { const x = d.lists.find(y => y.id === cur); pickVisual(x.ic, ic => { const dd = listsData(), t = dd.lists.find(y => y.id === cur); if (ic) t.ic = ic; else delete t.ic; saveLists(dd); renderFavs(); }); return; }
    if (k === 'rename') { const x = d.lists.find(y => y.id === cur), n = await askName('Renommer la liste', x.name); if (n) { const dd = listsData(); dd.lists.find(y => y.id === cur).name = n; saveLists(dd); renderFavs(); } return; }
    if (k === 'delete') { const x = d.lists.find(y => y.id === cur); if (confirm(`Supprimer la liste « ${x.name} » ? Les podcasts restent dans tes favoris.`)) { const dd = listsData(); dd.lists = dd.lists.filter(y => y.id !== cur); Object.keys(dd.members).forEach(u => { dd.members[u] = dd.members[u].filter(i => i !== cur); if (!dd.members[u].length) delete dd.members[u]; }); saveLists(dd); localStorage.setItem('favlist', 'all'); renderFavs(); } return; }
    localStorage.setItem('favlist', k); renderFavs();
  });
  view.querySelectorAll('.item').forEach((el, i) => el.onclick = ev => {
    if (ev.target.closest('[data-listadd]')) { listsSheet(l[i], () => { if (cur !== 'all') renderFavs(); }, ev.target.closest('[data-listadd]')); return; }
    if (ev.target.closest('[data-unlist]')) { // retire seulement de cette liste
      const dd = listsData(), u = l[i].feedUrl; dd.members[u] = (dd.members[u] || []).filter(x => x !== cur); if (!dd.members[u].length) { delete dd.members[u]; delete dd.pods[u]; } saveLists(dd);
      el.classList.add('removed'); return;
    }
    if (ev.target.closest('[data-star]')) {
      toggleFav(l[i]); // retire (ou remet) le favori d'un clic ; l'élément disparaît à la prochaine ouverture de la liste
      const on = Sync.favs().some(x => x.feedUrl === l[i].feedUrl);
      setStar(ev.target.closest('[data-star]'), on); el.classList.toggle('removed', !on);
      return;
    }
    openFeed(l[i]);
  });
}
// ---------- Playlists d'épisodes (tous podcasts confondus, ordre libre) ----------
const plData = () => { try { const d = JSON.parse(localStorage.getItem('playlists.v1')); return Array.isArray(d) ? d : []; } catch { return []; } };
const savePl = l => { try { localStorage.setItem('playlists.v1', JSON.stringify(l)); } catch {} };
const epSnap = (e, feed) => ({ url: e.url, title: e.title, dur: e.dur || '', image: e.image || '', date: e.date || '', show: feed.title, art: feed.image || '', feed: feed.feedUrl });
const plTotal = p => { const s = p.items.reduce((t, x) => t + durSec(x.dur), 0); return s ? ' · ' + fmtDur(s) : ''; };
// Petit menu ancré au bouton cliqué (listes, playlists)
let popState = null;
function closePop() {
  if (!popState) return; const p = popState; popState = null;
  document.removeEventListener('pointerdown', p.out, true); document.removeEventListener('keydown', p.key, true); removeEventListener('resize', p.resize); if (window.visualViewport) { visualViewport.removeEventListener('resize', p.resize); visualViewport.removeEventListener('scroll', p.resize); } removeEventListener('scroll', p.scroll, true);
  p.el.remove(); if (p.onclose) p.onclose();
}
function popover(anchor, html, onclose) {
  if (popState && popState.anchor === anchor) { closePop(); return null; } // un second clic referme
  closePop();
  const el = document.createElement('div'); el.className = 'pop'; el.innerHTML = html; document.body.appendChild(el);
  const place = () => {
    const r = anchor.getBoundingClientRect(), w = Math.min(320, innerWidth - 16); el.style.width = w + 'px';
    el.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
    const vv = window.visualViewport;
    if (vv && vv.height < innerHeight - 120 && el.contains(document.activeElement)) { // clavier ouvert pendant la saisie : le menu se colle en haut de la zone visible
      el.style.bottom = 'auto'; el.style.top = (vv.offsetTop + 8) + 'px'; el.style.maxHeight = Math.max(140, vv.height - 16) + 'px'; return;
    }
    const h = el.scrollHeight, below = innerHeight - r.bottom - 12;
    if (h > below && r.top > below) { el.style.top = 'auto'; el.style.bottom = (innerHeight - r.top + 6) + 'px'; el.style.maxHeight = Math.max(160, r.top - 16) + 'px'; }
    else { el.style.bottom = 'auto'; el.style.top = (r.bottom + 6) + 'px'; el.style.maxHeight = Math.max(180, below) + 'px'; }
  };
  const out = e => { if (!el.contains(e.target) && !anchor.contains(e.target)) closePop(); };
  const key = e => { if (e.key === 'Escape') closePop(); };
  const scroll = e => { if (!el.contains(e.target) && !el.contains(document.activeElement)) closePop(); };
  const resize = () => { if (el.contains(document.activeElement)) { el.place(); } else closePop(); }; // le clavier mobile redimensionne l'écran : on ne ferme pas pendant la saisie
  document.addEventListener('pointerdown', out, true); document.addEventListener('keydown', key, true); addEventListener('resize', resize); addEventListener('scroll', scroll, true); if (window.visualViewport) { visualViewport.addEventListener('resize', resize); visualViewport.addEventListener('scroll', resize); }
  popState = { el, anchor, out, key, scroll, resize, onclose }; el.place = place; place(); return el;
}
// Champ « nouveau » en ligne : le bouton « + Nouvelle … » se transforme en champ de saisie (rien d'encombrant tant qu'on ne s'en sert pas).
function inlineNew(el, btn, ph, onCreate) {
  const f = document.createElement('form'); f.className = 'pnewi'; f.innerHTML = `<input maxlength="40" placeholder="${ph}" autocomplete="off"><button class="pok" type="submit">Créer</button>`;
  btn.replaceWith(f); el.place(); const inp = f.querySelector('input'); inp.focus({ preventScroll: true }); inp.addEventListener('focus', () => setTimeout(() => el.place(), 300)); setTimeout(() => el.place(), 350);
  f.onsubmit = e => { e.preventDefault(); const v = inp.value.trim(); if (v) onCreate(v); };
}
function playlistPicker(snaps, anchor) { // ajoute des épisodes à une playlist (ou en crée une)
  const add = (p, all) => { let n = 0; snaps.forEach(s => { if (!p.items.some(x => x.url === s.url)) { p.items.push(s); n++; } }); savePl(all); closePop(); toast(n ? `${n} épisode${n > 1 ? 's ajoutés' : ' ajouté'} à « ${p.name} »` : 'Déjà dans « ' + p.name + ' »'); };
  const el = popover(anchor, `<div class="phead"><span>Ajouter à une playlist</span><button type="button" class="pdone" aria-label="Fermer">✕</button></div><div class="pchips"></div>`); if (!el) return;
  el.querySelector('.pdone').onclick = closePop;
  const chips = el.querySelector('.pchips'), l = plData();
  chips.innerHTML = l.map(p => `<button type="button" class="pchip" data-id="${p.id}">${esc(p.name)} <small>${p.items.length}</small></button>`).join('') + '<button type="button" class="pchip add" data-new>+ Nouvelle playlist</button>';
  chips.querySelectorAll('[data-id]').forEach(b => b.onclick = () => { const all = plData(); add(all.find(x => x.id === b.dataset.id), all); });
  chips.querySelector('[data-new]').onclick = e => inlineNew(el, e.currentTarget, 'Nom de la playlist', v => { const all = plData(), p = { id: newId(), name: v, items: [] }; all.push(p); add(p, all); });
  el.place();
}
function playPlaylist(p, start = 0) {
  if (!p.items.length) return;
  queue = p.items.map(x => ({ title: x.title, url: x.url, dur: x.dur, image: x.image, date: x.date, _show: x.show, _art: x.art, _feed: x.feed }));
  qCtx = { show: '', art: '', feedUrl: '', auto: true }; playAt(start);
}
function renderPlaylists() {
  const l = plData();
  view.innerHTML = `<div class="tglrow"><button type="button" class="tgl" id="plcreate">+ Nouvelle playlist</button></div>` + (l.length ? l.map(p => `<div class="item pl" data-id="${p.id}"><div class="aic">${p.ic ? visHtml(p.ic, 'pl') : IC.list}</div><div class="t"><b>${esc(p.name)}</b><small class="m">${p.items.length} épisode${p.items.length > 1 ? 's' : ''}${plTotal(p)}</small></div><button class="ibtn playb" data-play aria-label="Lire">${IC.play}</button></div>`).join('') : '<p class="dim">Aucune playlist. Crée-en une, puis ajoute des épisodes avec le bouton « + » d\'un épisode.</p>');
  $('#plcreate').onclick = async () => { const n = await askName('Nouvelle playlist'); if (n) { const all = plData(); all.push({ id: newId(), name: n, items: [] }); savePl(all); renderFavs(); } };
  view.querySelectorAll('.item.pl').forEach(el => el.onclick = ev => {
    const p = plData().find(x => x.id === el.dataset.id); if (!p) return;
    if (ev.target.closest('[data-play]')) playPlaylist(p, 0); else openPlaylist(p.id);
  });
}
function openPlaylist(id) {
  const prev = tab === 'shared' ? 'favs' : tab; tab = 'shared';
  const back = () => { tab = prev; render(); };
  const draw = () => {
    const all = plData(), p = all.find(x => x.id === id); if (!p) { back(); return; }
    setTitle(p.name, back);
    view.innerHTML = `<div class="tglrow"><button type="button" class="abtn" id="plplay">▶ Tout lire</button><button type="button" class="tgl" id="plren">Renommer</button><button type="button" class="tgl" id="plvis">Visuel</button><button type="button" class="tgl" id="plshare">Partager</button><button type="button" class="tgl" id="pldel">Supprimer</button></div><p class="dim">${p.items.length} épisode${p.items.length > 1 ? 's' : ''}${plTotal(p)}</p>` +
      (p.items.map((x, i) => `<div class="item ep" data-i="${i}"><div class="t"><b>${esc(x.title)}</b><small class="m">${esc([x.show, fmtDur(x.dur)].filter(Boolean).join(' · '))}</small></div><button class="ibtn" data-up aria-label="Monter"${i === 0 ? ' disabled' : ''}>▲</button><button class="ibtn" data-down aria-label="Descendre"${i === p.items.length - 1 ? ' disabled' : ''}>▼</button><button class="ibtn" data-rm aria-label="Retirer">✕</button><button class="ibtn playb" data-play aria-label="Lire">${IC.play}</button></div>`).join('') || '<p class="dim">Playlist vide. Ajoute des épisodes avec le bouton « + » d\'un épisode.</p>');
    $('#plplay').onclick = () => playPlaylist(p, 0);
    $('#plvis').onclick = () => pickVisual(p.ic, ic => { const a2 = plData(), q = a2.find(x => x.id === id); if (ic) q.ic = ic; else delete q.ic; savePl(a2); draw(); });
    $('#plren').onclick = async () => { const n = await askName('Renommer la playlist', p.name); if (n) { const a2 = plData(); a2.find(x => x.id === id).name = n; savePl(a2); draw(); } };
    $('#plshare').onclick = () => { if (!p.items.length) return toast('Playlist vide'); withShare(() => shareCollection('playlist', p.name, p.items)); };
    $('#pldel').onclick = () => { if (confirm(`Supprimer la playlist « ${p.name} » ?`)) { savePl(plData().filter(x => x.id !== id)); back(); } };
    view.querySelectorAll('.item.ep').forEach(el => el.onclick = ev => {
      const i = +el.dataset.i, a2 = plData(), q = a2.find(x => x.id === id), it = q.items;
      if (ev.target.closest('[data-up]') && i > 0) { [it[i - 1], it[i]] = [it[i], it[i - 1]]; savePl(a2); draw(); }
      else if (ev.target.closest('[data-down]') && i < it.length - 1) { [it[i + 1], it[i]] = [it[i], it[i + 1]]; savePl(a2); draw(); }
      else if (ev.target.closest('[data-rm]')) { it.splice(i, 1); savePl(a2); draw(); }
      else if (ev.target.closest('[data-play]') || ev.currentTarget === el) playPlaylist(q, i);
    });
  };
  draw();
}
// Choix des listes d'un podcast (menu ancré au bouton)
function listsSheet(feed, onDone, anchor) {
  const el = popover(anchor, `<div class="phead"><span>Listes</span><button type="button" class="pdone">Terminé</button></div><div class="pchips"></div>`, onDone); if (!el) return;
  el.querySelector('.pdone').onclick = closePop;
  const setMember = (id, on) => { const dd = listsData(), u = feed.feedUrl, s = new Set(dd.members[u] || []); on ? s.add(id) : s.delete(id); if (s.size) { dd.members[u] = [...s]; dd.pods[u] = podSnap(feed); } else { delete dd.members[u]; delete dd.pods[u]; } saveLists(dd); refreshTags(u); };
  const draw = () => {
    const d = listsData(), mem = d.members[feed.feedUrl] || [], chips = el.querySelector('.pchips');
    chips.innerHTML = d.lists.map(x => { const on = mem.includes(x.id); return `<button type="button" class="pchip${on ? ' on' : ''}" data-id="${x.id}" aria-pressed="${on}">${on ? '✓ ' : ''}${esc(x.name)}</button>`; }).join('') + '<button type="button" class="pchip add" data-new>+ Nouvelle liste</button>';
    chips.querySelectorAll('[data-id]').forEach(c => c.onclick = () => { setMember(c.dataset.id, !c.classList.contains('on')); draw(); });
    chips.querySelector('[data-new]').onclick = e => inlineNew(el, e.currentTarget, 'Nom de la liste', v => { const dd = listsData(), id = newId(); dd.lists.push({ id, name: v }); saveLists(dd); setMember(id, true); draw(); });
    el.place();
  };
  draw();
}
// ---------- Podcast Index (clé + secret saisis dans Réglages ; synchronisés avec la sauvegarde, au choix de l'utilisateur) ----------
const piReady = () => true;
// Podcast Index : toujours via le worker de l'app, qui détient la clé et le secret côté serveur (rien à saisir, rien d'exposé).
async function piGet(path) {
  const p = Sync.proxy();
  if (!p) throw new Error('Service Podcast Index indisponible.');
  let r;
  try { r = await fetch(p + '/podcastindex/' + path); } catch { throw new Error('Podcast Index injoignable (réseau).'); }
  if (r.status === 401 || r.status === 403) throw new Error('Podcast Index non configuré sur le serveur (clé et secret manquants dans le worker).');
  if (!r.ok) throw new Error('Podcast Index ' + r.status);
  return (await r.json()).feeds || [];
}
const piSearch = q => piGet(`search/byterm?max=100&q=${encodeURIComponent(q)}`);
const CAT_FR = {
  'Arts': 'Arts', 'Design': 'Design', 'Fashion & Beauty': 'Mode et beauté', 'Food': 'Cuisine', 'Books': 'Livres', 'Performing Arts': 'Spectacle vivant', 'Visual Arts': 'Arts visuels',
  'Business': 'Économie et affaires', 'Careers': 'Carrières', 'Entrepreneurship': 'Entrepreneuriat', 'Investing': 'Investissement', 'Management': 'Management', 'Marketing': 'Marketing', 'Non-Profit': 'Associatif',
  'Comedy': 'Humour', 'Comedy Interviews': 'Interviews humoristiques', 'Improv': 'Improvisation', 'Stand-Up': 'Stand-up',
  'Education': 'Éducation', 'Courses': 'Cours', 'How-To': 'Tutoriels', 'Language Learning': 'Langues', 'Self-Improvement': 'Développement personnel',
  'Fiction': 'Fiction', 'Comedy Fiction': 'Fiction humoristique', 'Drama': 'Drame', 'Science Fiction': 'Science-fiction',
  'Government': 'Gouvernement', 'History': 'Histoire',
  'Health & Fitness': 'Santé et forme', 'Alternative Health': 'Santé alternative', 'Fitness': 'Fitness', 'Medicine': 'Médecine', 'Mental Health': 'Santé mentale', 'Nutrition': 'Nutrition', 'Sexuality': 'Sexualité',
  'Kids & Family': 'Enfants et famille', 'Education for Kids': 'Éducation des enfants', 'Parenting': 'Parentalité', 'Pets & Animals': 'Animaux', 'Stories for Kids': 'Histoires pour enfants',
  'Leisure': 'Loisirs', 'Animation & Manga': 'Animation et manga', 'Automotive': 'Automobile', 'Aviation': 'Aviation', 'Crafts': 'Loisirs créatifs', 'Games': 'Jeux', 'Hobbies': 'Passe-temps', 'Home & Garden': 'Maison et jardin', 'Video Games': 'Jeux vidéo',
  'Music': 'Musique', 'Music Commentary': 'Commentaires musicaux', 'Music History': 'Histoire de la musique', 'Music Interviews': 'Interviews musicales',
  'News': 'Actualités', 'Business News': 'Actualité économique', 'Daily News': 'Actualité quotidienne', 'Entertainment News': 'Actualité culturelle', 'News Commentary': 'Commentaires d’actualité', 'Politics': 'Politique', 'Sports News': 'Actualité sportive', 'Tech News': 'Actualité tech',
  'Religion & Spirituality': 'Religion et spiritualité', 'Buddhism': 'Bouddhisme', 'Christianity': 'Christianisme', 'Hinduism': 'Hindouisme', 'Islam': 'Islam', 'Judaism': 'Judaïsme', 'Religion': 'Religion', 'Spirituality': 'Spiritualité',
  'Science': 'Sciences', 'Astronomy': 'Astronomie', 'Chemistry': 'Chimie', 'Earth Sciences': 'Sciences de la Terre', 'Life Sciences': 'Sciences de la vie', 'Mathematics': 'Mathématiques', 'Natural Sciences': 'Sciences naturelles', 'Nature': 'Nature', 'Physics': 'Physique', 'Social Sciences': 'Sciences sociales',
  'Society & Culture': 'Société et culture', 'Documentary': 'Documentaire', 'Personal Journals': 'Journaux personnels', 'Philosophy': 'Philosophie', 'Places & Travel': 'Lieux et voyages', 'Relationships': 'Relations',
  'Sports': 'Sport', 'Baseball': 'Baseball', 'Basketball': 'Basket-ball', 'Cricket': 'Cricket', 'Fantasy Sports': 'Sports fantasy', 'Football': 'Football américain', 'Golf': 'Golf', 'Hockey': 'Hockey', 'Rugby': 'Rugby', 'Running': 'Course à pied', 'Soccer': 'Football', 'Swimming': 'Natation', 'Tennis': 'Tennis', 'Volleyball': 'Volley-ball', 'Wilderness': 'Plein air', 'Wrestling': 'Catch',
  'Technology': 'Technologie', 'True Crime': 'Faits divers', 'TV & Film': 'Télévision et cinéma', 'After Shows': 'Après-émissions', 'Film History': 'Histoire du cinéma', 'Film Interviews': 'Interviews cinéma', 'Film Reviews': 'Critiques de films', 'TV Reviews': 'Critiques de séries',
};
// Catégories telles que Podcast Index les nomme (mots simples) : traduction complète, insensible à la casse.
const CAT_PI = {
  'after-shows': 'Après-émissions', 'alternative': 'Santé alternative', 'animals': 'Animaux', 'animation': 'Animation', 'arts': 'Arts', 'astronomy': 'Astronomie', 'automotive': 'Automobile', 'aviation': 'Aviation',
  'baseball': 'Baseball', 'basketball': 'Basket-ball', 'beauty': 'Beauté', 'books': 'Livres', 'buddhism': 'Bouddhisme', 'business': 'Économie et affaires', 'careers': 'Carrières', 'chemistry': 'Chimie',
  'christianity': 'Christianisme', 'climate': 'Climat', 'comedy': 'Humour', 'commentary': 'Commentaires', 'courses': 'Cours', 'crafts': 'Loisirs créatifs', 'cricket': 'Cricket', 'cryptocurrency': 'Cryptomonnaies',
  'culture': 'Culture', 'daily': 'Quotidien', 'design': 'Design', 'documentary': 'Documentaire', 'drama': 'Drame', 'earth': 'Sciences de la Terre', 'education': 'Éducation', 'entertainment': 'Divertissement',
  'entrepreneurship': 'Entrepreneuriat', 'family': 'Famille', 'fantasy': 'Fantasy', 'fashion': 'Mode', 'fiction': 'Fiction', 'film': 'Cinéma', 'fitness': 'Fitness', 'food': 'Cuisine', 'football': 'Football américain',
  'games': 'Jeux', 'garden': 'Jardin', 'golf': 'Golf', 'government': 'Gouvernement', 'health': 'Santé', 'hinduism': 'Hindouisme', 'history': 'Histoire', 'hobbies': 'Passe-temps', 'hockey': 'Hockey', 'home': 'Maison',
  'how-to': 'Tutoriels', 'improv': 'Improvisation', 'interviews': 'Interviews', 'investing': 'Investissement', 'islam': 'Islam', 'journals': 'Journaux', 'judaism': 'Judaïsme', 'kids': 'Enfants', 'language': 'Langues',
  'learning': 'Apprentissage', 'leisure': 'Loisirs', 'life': 'Sciences de la vie', 'management': 'Management', 'manga': 'Manga', 'marketing': 'Marketing', 'mathematics': 'Mathématiques', 'medicine': 'Médecine',
  'mental': 'Santé mentale', 'music': 'Musique', 'natural': 'Sciences naturelles', 'nature': 'Nature', 'news': 'Actualités', 'non-profit': 'Associatif', 'nutrition': 'Nutrition', 'parenting': 'Parentalité',
  'performing': 'Spectacle vivant', 'personal': 'Personnel', 'pets': 'Animaux de compagnie', 'philosophy': 'Philosophie', 'physics': 'Physique', 'places': 'Lieux', 'politics': 'Politique', 'relationships': 'Relations',
  'religion': 'Religion', 'reviews': 'Critiques', 'role-playing': 'Jeux de rôle', 'rugby': 'Rugby', 'running': 'Course à pied', 'science': 'Sciences', 'self-improvement': 'Développement personnel',
  'sexuality': 'Sexualité', 'soccer': 'Football', 'social': 'Sciences sociales', 'society': 'Société', 'spirituality': 'Spiritualité', 'sports': 'Sport', 'stand-up': 'Stand-up', 'stories': 'Histoires',
  'swimming': 'Natation', 'tabletop': 'Jeux de plateau', 'tech': 'Tech', 'technology': 'Technologie', 'tennis': 'Tennis', 'travel': 'Voyages', 'true crime': 'Faits divers', 'tv': 'Télévision',
  'video-games': 'Jeux vidéo', 'visual': 'Arts visuels', 'volleyball': 'Volley-ball', 'weather': 'Météo', 'wilderness': 'Plein air', 'wrestling': 'Catch', 'sports news': 'Actualité sportive',
};
const catFr = c => CAT_FR[c] || CAT_PI[String(c).toLowerCase().trim()] || CAT_PI[String(c).toLowerCase().replace(/\s*&\s*/g, ' and ').replace(/\s+/g, '-')] || c;
let piCats = null;
const piCategories = async () => piCats || (piCats = (await piGet('categories/list')).map(c => c.name).sort((x, y) => x.localeCompare(y, 'fr')));
const piPrefs = () => { const d = { mode: 'search', lang: 'fr', cat: '', sort: 'rel', clean: false, full: false }; try { const s = JSON.parse(localStorage.getItem('pi.prefs')); return { ...d, ...s, mode: ['search', 'title', 'trending', 'recent', 'new'].includes(s && s.mode) ? s.mode : 'search' }; } catch { return d; } };
const piMap = x => ({ feedUrl: x.url, title: x.title, image: x.artwork || x.image, author: x.author || x.ownerName,
  genre: catFr(Object.values(x.categories || {})[0] || ''), count: x.episodeCount, last: (x.newestItemPubdate || x.newestItemPublishTime) ? new Date((x.newestItemPubdate || x.newestItemPublishTime) * 1000).toISOString() : '', desc: (x.description || '').replace(/<[^>]*>/g, '').slice(0, 300) });
let searchSrc = localStorage.getItem('src') || '';
const PRODUCERS = [
  ['France Inter', /france inter/i], ['France Culture', /france culture/i], ['Franceinfo', /franceinfo|france info/i],
  ['France TV', /france t[ée]l[ée]visions|france\.?\s?tv/i], ['Radio France', /radio france|france (inter|culture|info|bleu|musique)|\bmouv|\bfip\b/i],
  ['RTL', /\brtl\b/i], ['RFI', /\brfi\b|radio france internationale/i], ['Arte', /\barte\b/i],
  ['RMC', /\brmc\b/i], ['RTBF', /\brtbf\b|auvio/i], ['RTS', /\brts\b|radio t[ée]l[ée]vision suisse/i], ['Radio-Canada', /radio-canada|ici radio-canada/i],
  ['Binge Audio', /binge audio/i], ['Louie Media', /louie media|louie/i], ['Nouvelles Écoutes', /nouvelles [ée]coutes/i], ['Slate', /\bslate\b/i],
  ['Le Monde', /\ble monde\b/i], ['Libération', /lib[ée]ration/i], ['Le Figaro', /figaro/i], ['Les Echos', /les [ée]chos/i], ['Brut', /\bbrut\b/i], ['Bayard', /bayard/i], ['Podcastine', /podcastine/i], ['Arte Radio', /arte radio/i],
  ['BBC', /\bbbc\b/i], ['NPR', /\bnpr\b/i], ['Audible', /\baudible\b/i], ['Spotify Studios', /spotify/i],
];
PRODUCERS.sort((a, b) => a[0].localeCompare(b[0], 'fr', { sensitivity: 'base' })); // ordre alphabétique
let searchProd = '', searchQ = '', filtersOpen = false, searchBook = false;
const seg = (id, opts, val) => `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${v === val ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
const SVG_SEARCH = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const APPLE_GENRES = [['', 'Toutes les catégories'], ['1301', 'Arts'], ['1303', 'Humour'], ['1304', 'Éducation'], ['1305', 'Enfants et famille'], ['1321', 'Économie'], ['1483', 'Fiction'], ['1511', 'Gouvernement'], ['1512', 'Santé et forme'], ['1487', 'Histoire'], ['1502', 'Loisirs'], ['1310', 'Musique'], ['1489', 'Actualités'], ['1314', 'Religion et spiritualité'], ['1533', 'Sciences'], ['1324', 'Société et culture'], ['1545', 'Sport'], ['1318', 'Technologie'], ['1488', 'Faits divers'], ['1309', 'Télévision et cinéma']];
const appleGenre = () => localStorage.getItem('apple.genre') || '';
const PI_MODES = [['search', 'Mots-clés'], ['title', 'Titre'], ['trending', 'Tendances'], ['recent', 'Mises à jour'], ['new', 'Nouveaux']];
const PI_HINT = { search: 'Mot-clé (facultatif)…', title: 'Titre du podcast…', trending: 'Filtrer (facultatif)…', recent: 'Filtrer (facultatif)…', new: 'Filtrer (facultatif)…' };
function renderSearch() {
  if (!searchSrc) searchSrc = 'pi';
  if (searchSrc === 'pi' && !piReady()) searchSrc = 'apple';
  const pi = searchSrc === 'pi', p = piPrefs();
  const active = pi ? [p.lang !== 'fr', !!p.cat, p.sort !== 'rel', p.clean, p.full, !!searchProd].filter(Boolean).length : 0;
  view.innerHTML = `${seg('srcseg', [['apple', 'Apple Podcasts'], ['pi', piReady() ? 'Podcast Index' : 'Podcast Index 🔒']], searchSrc)}
    <form id="sf" class="searchbar">${SVG_SEARCH}<input type="search" id="q" placeholder="${pi ? PI_HINT[p.mode] : 'Mot-clé (facultatif)…'}" value="${esc(searchQ)}" enterkeyhint="search"><button>Chercher</button></form>
    <div class="chips wrap" style="margin:8px 0"><button type="button" class="chip${searchBook ? ' on' : ''}" id="bookchip">📚 Livres audio</button></div>
    ${pi ? '' : `<div class="frow agrow"><span>Catégorie</span><select id="agenre">${APPLE_GENRES.map(([v, l]) => `<option value="${v}"${v === appleGenre() ? ' selected' : ''}>${l}</option>`).join('')}</select></div>`}
    ${pi ? `<div class="scrollx">${seg('modeseg', PI_MODES, p.mode)}</div>
    <button id="ftoggle" type="button" class="ghost">⚙ Filtres${active ? ` <span class="badge">${active}</span>` : ''}<span class="car">${filtersOpen ? '⌃' : '⌄'}</span></button>
    <div id="fpanel" class="panel" ${filtersOpen ? '' : 'hidden'}>
      <div class="frow"><span>Langue</span>${seg('langseg', [['fr', 'Français'], ['en', 'Anglais'], ['', 'Toutes']], p.lang)}</div>
      <div class="frow"><span>Catégorie</span><select id="picat"><option value="">Toutes les catégories</option></select></div>
      <div class="frow"><span>Trier par</span>${seg('sortseg', [['rel', 'Pertinence'], ['new', 'Récents'], ['eps', 'Épisodes'], ['az', 'A–Z']], p.sort)}</div>
      <div class="frow"><span>Options</span><div class="opts2"><button type="button" id="oclean" class="tog${p.clean ? ' on' : ''}">Sans contenu explicite</button><button type="button" id="ofull" class="tog${p.full ? ' on' : ''}">Chercher aussi dans les descriptions</button></div></div>
      <div class="frow"><span>Producteur</span><div class="chips wrap">${PRODUCERS.map(([n]) => `<button type="button" class="chip${n === searchProd ? ' on' : ''}" data-p="${esc(n)}">${esc(n)}</button>`).join('')}</div></div>
    </div>` : ''}<div id="res"></div>`;

  const bind = list => $('#res').querySelectorAll('.item').forEach((el, i) => {
    el.onclick = ev => {
      if (!list[i].feedUrl) return;
      if (ev.target.closest('[data-listadd]')) { listsSheet(list[i], null, ev.target.closest('[data-listadd]')); return; }
      if (ev.target.closest('[data-star]')) { toggleFav(list[i]); setStar(ev.target.closest('[data-star]'), Sync.favs().some(x => x.feedUrl === list[i].feedUrl)); }
      else openFeed(list[i], () => render());
    };
  });
  let runTok = 0;
  const run = async () => {
    const my = ++runTok, res = { set innerHTML(h) { if (my === runTok) $('#res').innerHTML = h; } }; // les réponses périmées sont ignorées
    const q = $('#q').value.trim(); searchQ = q;
    const p = piPrefs(), prod = pi ? PRODUCERS.find(x => x[0] === searchProd) : null;
    const browse = pi && ['trending', 'recent', 'new'].includes(p.mode);
    res.innerHTML = '<p class="dim">Recherche…</p>';
    try {
      if (pi) {
        let feeds, srvFiltered = false;
        const since = days => `&since=${Math.floor(Date.now() / 1000) - days * 86400}`, lg = p.lang ? '&lang=' + p.lang : '', ct = p.cat ? '&cat=' + encodeURIComponent(p.cat) : '';
        if (p.mode === 'trending') feeds = await piGet(`podcasts/trending?max=100${since(14)}${lg}${ct}`);
        else if (p.mode === 'recent') feeds = await piGet(`recent/feeds?max=100${lg}${ct}`);
        else if (p.mode === 'new') feeds = await piGet(`recent/newfeeds?max=100${since(30)}`);
        else if (!q && !prod && !searchBook) { srvFiltered = true; feeds = await piGet(`podcasts/trending?max=1000${since(365)}${lg}${ct}`); }
        else {
          const term = encodeURIComponent(searchBook ? (q ? q + ' livre audio' : 'livre audio') : (q || (prod && prod[0]) || ''));
          feeds = await piGet(p.mode === 'title' ? `search/bytitle?max=100&q=${term}${p.clean ? '&clean' : ''}` : `search/byterm?max=100&q=${term}${p.clean ? '&clean' : ''}${p.full ? '&fulltext' : ''}`);
        }
        feeds = feeds.filter(x => x.url && !x.dead && !(p.clean && x.explicit));
        if (!srvFiltered && p.lang && ['search', 'title', 'new'].includes(p.mode)) feeds = feeds.filter(x => (x.language || '').toLowerCase().startsWith(p.lang));
        if (!srvFiltered && p.cat && ['search', 'title', 'new'].includes(p.mode)) feeds = feeds.filter(x => Object.values(x.categories || {}).some(c => c.toLowerCase() === p.cat.toLowerCase()));
        if (prod) feeds = feeds.filter(x => prod[1].test(x.author || '') || prod[1].test(x.ownerName || '') || prod[1].test(x.title || ''));
        if (q && browse) { const ql = q.toLowerCase(); feeds = feeds.filter(x => ((x.title || '') + ' ' + (x.author || '') + ' ' + (x.description || '')).toLowerCase().includes(ql)); }
        const lastOf = x => x.newestItemPubdate || x.newestItemPublishTime || 0;
        if (p.sort === 'new') feeds.sort((x, y) => lastOf(y) - lastOf(x));
        else if (p.sort === 'eps') feeds.sort((x, y) => (y.episodeCount || 0) - (x.episodeCount || 0));
        else if (p.sort === 'az') feeds.sort((x, y) => (x.title || '').localeCompare(y.title || '', 'fr'));
        const list = feeds.map(piMap).filter(f => !blocked(f)).slice(0, 150);
        res.innerHTML = `<p class="count dim">${list.length} résultat${list.length > 1 ? 's' : ''}</p>` + (list.map(f => showItem(f, true)).join('') || '<p class="dim">Aucun résultat avec ces filtres.</p>');
        if (my === runTok) bind(list); return;
      }
      let results;
      if (q || searchBook) results = (await (await fetch(`https://itunes.apple.com/search?media=podcast&limit=200&country=fr&term=${encodeURIComponent(searchBook ? (q ? q + ' livre audio' : 'livre audio') : q)}`)).json()).results;
      else { // sans mot : classement Apple (par catégorie), puis recherche des flux
        const g = appleGenre(), top = await (await fetch(`https://itunes.apple.com/fr/rss/toppodcasts/limit=100${g ? '/genre=' + g : ''}/json`)).json();
        const ids = (top.feed.entry || []).map(e => e.id.attributes['im:id']);
        const by = new Map(); (await (await fetch(`https://itunes.apple.com/lookup?id=${ids.join(',')}&country=fr`)).json()).results.forEach(x => by.set(String(x.collectionId), x));
        results = ids.map(i => by.get(i)).filter(Boolean);
      }
      const list = results.map(x => ({ feedUrl: x.feedUrl || '', title: x.collectionName, image: x.artworkUrl100, author: x.artistName, genre: x.primaryGenreName, count: x.trackCount, last: x.releaseDate })).filter(f => !blocked(f)).slice(0, 100);
      const nofeed = list.filter(f => !f.feedUrl).length;
      res.innerHTML = (nofeed ? `<p class="dim">${nofeed} résultat${nofeed > 1 ? 's' : ''} sans flux public dans l'annuaire Apple (grisé${nofeed > 1 ? 's' : ''}) : impossible de les lire ici.</p>` : '') + (list.map(f => showItem(f, !!f.feedUrl)).join('') || '<p class="dim">Aucun résultat.</p>');
      if (my === runTok) bind(list);
    } catch (err) { res.innerHTML = `<p class="dim">Erreur : ${esc(err.message)}</p>`; }
  };
  const savePrefs = patch => { try { localStorage.setItem('pi.prefs', JSON.stringify({ ...piPrefs(), ...patch })); } catch {} };
  const refresh = () => { renderSearch(); };
  const bindSeg = (id, fn) => { const el = $('#' + id); if (el) el.onclick = e => { const b = e.target.closest('button[data-v]'); if (b) fn(b.dataset.v); }; };
  bindSeg('srcseg', v => {
    if (v === 'pi' && !piReady()) { alert('Saisis ta clé et ton secret Podcast Index dans Réglages.'); return; }
    searchSrc = v; try { localStorage.setItem('src', v); } catch {}
    refresh();
  });
  if (!pi) $('#agenre').onchange = e => { try { localStorage.setItem('apple.genre', e.target.value); } catch {} run(); };
  let dt = 0;
  $('#q').oninput = () => { clearTimeout(dt); const v = $('#q').value.trim(); if (v.length === 1) return; dt = setTimeout(run, 380); }; // recherche au fil de la frappe
  $('#bookchip').onclick = () => { searchBook = !searchBook; renderSearch(); };
  $('#sf').onsubmit = e => { e.preventDefault(); clearTimeout(dt); run(); };
  if (pi) {
    bindSeg('modeseg', v => { savePrefs({ mode: v }); refresh(); });
    bindSeg('langseg', v => { savePrefs({ lang: v }); refresh(); });
    bindSeg('sortseg', v => { savePrefs({ sort: v }); refresh(); });
    $('#ftoggle').onclick = () => { filtersOpen = !filtersOpen; refresh(); };
    $('#oclean').onclick = () => { savePrefs({ clean: !p.clean }); refresh(); };
    $('#ofull').onclick = () => { savePrefs({ full: !p.full }); refresh(); };
    $('#picat').onchange = e => { savePrefs({ cat: e.target.value }); refresh(); };
    view.querySelectorAll('.chip[data-p]').forEach(b => b.onclick = () => { searchProd = searchProd === b.dataset.p ? '' : b.dataset.p; refresh(); });
    piCategories().then(cs => { $('#picat').innerHTML = '<option value="">Toutes les catégories</option>' + cs.map(c => ({ c, l: catFr(c) })).sort((x, y) => x.l.localeCompare(y.l, 'fr')).map(({ c, l }) => `<option value="${esc(c)}">${esc(l)}</option>`).join(''); $('#picat').value = p.cat; }).catch(() => {});
  }
  run();
}
async function openFeed(f, back) {
  setTitle(f.title, back || (() => render()));
  view.innerHTML = '<p class="dim">Chargement…</p>';
  try {
    const feed = feedCache.get(f.feedUrl) || await loadFeed(f.feedUrl);
    if (blocked(feed) || blocked(f)) { view.innerHTML = '<p class="dim">Ce média n\'est pas disponible dans l\'app.</p>'; return; }
    if (!f.title) setTitle(feed.title, back || (() => render()));
    const isFav = () => Sync.favs().some(x => x.feedUrl === feed.feedUrl);
    const seenAt = seenMap()[feed.feedUrl]; if (isFav()) { markSeen(feed); refreshNewBadge(); }
    const rw = (label, ctl, sub = '', id = '') => `<div class="rw"${id ? ` id="${id}"` : ''}><div class="rl"><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>${ctl}</div>`;
    view.innerHTML = `<div class="hero"><img src="${esc(feed.image)}" alt=""><div><b>${esc(feed.title)}</b><small>${esc(feed.author)}</small><small class="m">${esc(meta(feed))}</small></div></div>
      <div class="pacts"><button id="fav" type="button" class="pact${isFav() ? ' on' : ''}">${IC.star}<span>Coup de cœur</span></button><button id="lists" type="button" class="pact">${IC.list}<span>Listes</span></button><button id="share" type="button" class="pact">${IC.share}<span>Partager</span></button></div>
      <details class="sec"><summary>À propos</summary><p class="d full">${esc(feed.desc) || 'Pas de description.'}</p></details>
      <details class="sec"><summary>Réglages de ce podcast</summary><div class="rows">` +
        rw('Suivi de lecture', '<button id="track" type="button" class="sw" role="switch"></button>', 'Reprise, lu / non lu') +
        rw('Enchaîner les épisodes', '<button id="chain" type="button" class="sw" role="switch"></button>', 'Lit le suivant automatiquement') +
        rw('Vitesse de lecture', `<select id="rate">${[0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2].map(v => `<option value="${v}">${v}×</option>`).join('')}</select>`) +
        rw('Réduire les silences', '<button id="silsw" type="button" class="sw" role="switch"></button>', 'Accélère les blancs') +
        rw('Sauter le début', `<span class="unit"><input id="skipin" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${skipFor(feed.feedUrl) || ''}"> s</span>`, 'Générique d\'intro') +
        rw('Sauter la fin', `<span class="unit"><input id="skipend" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${skipEndFor(feed.feedUrl) || ''}"> s</span>`, 'Générique de fin') +
        rw('Téléchargement auto', `<select id="dlauto"><option value="0">Non</option><option value="new">Nouveaux épisodes</option>${[1, 2, 3, 5, 10].map(n => `<option value="${n}">${n} dernier${n > 1 ? 's' : ''}</option>`).join('')}</select>`, 'Écoute hors ligne') +
      `</div></details>
      <details class="sec"><summary>Filtrer et trier<span id="filsum" class="sum"></span></summary><div class="rows">` +
        rw('Trier', '<select id="ord"><option value="desc">Récents</option><option value="asc">Anciens</option></select>') +
        rw('Durée minimale', `<select id="mind"><option value="0">Toutes</option>${[10, 20, 30, 45, 60, 90, 120].map(m => `<option value="${m}">≥ ${m} min</option>`).join('')}</select>`) +
        rw('Afficher', '<select id="rd"><option value="all">Tous</option><option value="unread">Non lus</option><option value="read">Lus</option></select>', '', 'rdrow') +
        rw('Sélection multiple', '<button id="selbtn" type="button" class="sw" role="switch"></button>', 'Marquer lu, playlist…', 'selrow') +
      `</div></details>
      <div id="selbar" class="selbar" hidden><span id="selcnt"></span><button type="button" data-a="all">Tout</button><button type="button" data-a="read">Marquer lu</button><button type="button" data-a="unread">Marquer non lu</button><button type="button" data-a="pl">+ Playlist</button><button type="button" data-a="done">Terminer</button></div>
      <div class="eph"><h3>Épisodes</h3><span id="epcount" class="dim"></span></div><div id="eps"></div><div id="epmore"></div>`;
    { const sv = xget('rate.v1', {})[feed.feedUrl] || 1; $('#rate').value = String(sv); $('#rate').onchange = () => { const m = xget('rate.v1', {}), v = +$('#rate').value; if (v === 1) delete m[feed.feedUrl]; else m[feed.feedUrl] = v; xset('rate.v1', m); if (feed.feedUrl === curFeedUrl) applyRate(); };
      const showSil = () => { const on = silOn(feed.feedUrl); $('#silsw').classList.toggle('on', on); $('#silsw').setAttribute('aria-checked', on); }; showSil();
      $('#silsw').onclick = () => { const m = xget('silence.v1', {}); if (m[feed.feedUrl]) delete m[feed.feedUrl]; else m[feed.feedUrl] = 1; xset('silence.v1', m); showSil(); if (feed.feedUrl === curFeedUrl) applyRate(); }; }
    const tgl = (id, ic, label, on) => { const b = $('#' + id); if (b.classList.contains('sw')) { b.classList.toggle('on', !!on); b.setAttribute('aria-checked', !!on); return; } b.innerHTML = labeled(ic, label); b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', !!on); };
    const showChain = () => tgl('chain', IC.chain, 'Enchaîner', chain);
    $('#chain').onclick = () => { chain = !chain; try { localStorage.setItem('chain', chain ? '1' : '0'); } catch {} showChain(); };
    showChain();
    let selMode = false, curListIdx = []; const sel = new Set();
    const showSel = () => { $('#selbar').hidden = !selMode; $('#selbtn').classList.toggle('on', selMode); $('#selcnt').textContent = sel.size ? sel.size + ' sélectionné' + (sel.size > 1 ? 's' : '') : 'Touche des épisodes pour les sélectionner'; $('#selbar').querySelectorAll('[data-a=read],[data-a=unread],[data-a=pl]').forEach(b => { b.disabled = !sel.size; }); };
    $('#selbtn').onclick = () => { selMode = !selMode; sel.clear(); showSel(); drawEps(); };
    $('#selbar').onclick = ev => {
      const b = ev.target.closest('button[data-a]'); if (!b) return; const act = b.dataset.a;
      if (act === 'all') { if (sel.size >= curListIdx.length) sel.clear(); else curListIdx.forEach(i => sel.add(i)); }
      else if (act === 'done') { selMode = false; sel.clear(); }
      else if (act === 'pl') { if (!sel.size) return; playlistPicker([...sel].sort((x, y) => x - y).map(i => epSnap(feed.episodes[i], feed)), b); return; }
      else { if (!sel.size) return; const n = sel.size; setProgMany(feed.feedUrl, [...sel].map(i => feed.episodes[i]), act === 'read' ? { r: 1, t: 0 } : { r: 0, t: 0 }); sel.clear(); toast(n + (n > 1 ? ' épisodes marqués ' : ' épisode marqué ') + (act === 'read' ? 'lu' : 'non lu') + (n > 1 ? 's' : '')); }
      showSel(); drawEps();
    };
    const showTrack = () => { const on = trackOn(feed.feedUrl); tgl('track', IC.track, 'Suivi de lecture', on); tgl('selbtn', IC.select, 'Sélection', selMode); $('#rdrow').hidden = !on; $('#selrow').hidden = !on; if (!on) { selMode = false; sel.clear(); showSel(); } };
    $('#track').onclick = () => { const m = numMap('track.v1'); if (m[feed.feedUrl]) delete m[feed.feedUrl]; else m[feed.feedUrl] = 1; try { localStorage.setItem('track.v1', JSON.stringify(m)); } catch {} showTrack(); drawEps(); };
    const allPrefs = () => { try { return JSON.parse(localStorage.getItem('epprefs.v2')) || {}; } catch { return {}; } };
    const prefs = () => ({ order: 'desc', min: 0, read: 'all', ...allPrefs()[feed.feedUrl] }); // réglages propres à ce podcast
    const p0 = prefs(); $('#ord').value = p0.order; $('#mind').value = String(p0.min); $('#rd').value = p0.read;
    let shown = 50; // affichage par pages de 50 épisodes
    const drawEps = () => {
      const p = { order: $('#ord').value, min: +$('#mind').value, read: $('#rd').value }, tr = trackOn(feed.feedUrl);
      const opened = new Set([...$('#eps').querySelectorAll('.ep.open')].map(x => x.dataset.i));
      try { const m = allPrefs(); m[feed.feedUrl] = p; localStorage.setItem('epprefs.v2', JSON.stringify(m)); } catch {}
      let list = feed.episodes.map((e, i) => ({ e, i, t: Date.parse(e.date) || 0 }));
      if (p.min) list = list.filter(x => !durSec(x.e.dur) || durSec(x.e.dur) >= p.min * 60); // durée inconnue : conservé
      const pg = e => (tr && getProg(feed.feedUrl, e)) || {};
      if (tr && p.read === 'unread') list = list.filter(x => !pg(x.e).r);
      if (tr && p.read === 'read') list = list.filter(x => pg(x.e).r);
      list.sort((x, y) => p.order === 'asc' ? x.t - y.t || y.i - x.i : y.t - x.t || x.i - y.i);
      { const f = []; if (p.order === 'asc') f.push('Anciens'); if (p.min) f.push('≥ ' + p.min + ' min'); if (tr && p.read !== 'all') f.push(p.read === 'unread' ? 'Non lus' : 'Lus'); $('#filsum').textContent = f.join(' · '); $('#epcount').textContent = list.length + ' / ' + feed.episodes.length; }
      { const rest = list.length - shown; $('#epmore').innerHTML = rest > 0 ? `<button type="button" class="morebtn">Afficher ${Math.min(50, rest)} épisodes de plus <span class="dim">(${rest} restants)</span></button>` : ''; const mb = $('#epmore .morebtn'); if (mb) mb.onclick = () => { shown += 50; drawEps(); }; }
      curList = list.map(x => x.e); curListIdx = list.slice(0, shown).map(x => x.i);
      $('#eps').innerHTML = (list.slice(0, shown).map(({ e, i }) => `<div class="item ep${tr ? (pg(e).r ? ' isread' : ' unr') : ''}${selMode ? ' selmode' : ''}${opened.has(String(i)) ? ' open' : ''}${selMode && sel.has(i) ? ' sel' : ''}" data-i="${i}">${selMode ? '<span class="chk" aria-hidden="true">✓</span>' : ''}<div class="t"><b>${esc(e.title)}</b><small class="m">${esc([fmtDate(e.date), fmtDur(e.dur)].filter(Boolean).join(' · '))}</small>${seenAt != null && epTime(e) > seenAt ? '<span class="newpill">Nouveau</span>' : ''}${tr ? (() => { const g = pg(e), d = g.d || durSec(e.dur); return g.r ? '<span class="rdpill">✓ Lu</span>' : (g.t > 5 && d ? `<span class="pbar"><i style="width:${Math.min(100, Math.round(g.t / d * 100))}%"></i></span>` : ''); })() : ''}${e.desc ? `<p class="d">${esc(e.desc)}</p>` : ''}</div><div class="epbar">${tr ? `<button class="ibtn rbtn${pg(e).r ? ' on' : ''}" data-read aria-label="Lu / non lu">✓</button>` : ''}<button class="ibtn dlb" data-dl data-u="${esc(e.url)}" aria-label="Télécharger pour l'écouter hors ligne">${dlIcon(e.url)}</button><button class="ibtn" data-pladd aria-label="Ajouter à une playlist">＋</button><button class="ibtn" data-more aria-label="Détails">${IC.chev}</button><button class="ibtn playb wide" aria-label="Lire">${IC.play}<span>Lire</span></button></div><div class="epacts"><button type="button" class="abtn2" data-q>☰＋ À la suite</button><button type="button" class="abtn2" data-info>Chapitres et notes</button></div></div>`).join('')) || '<p class="dim">Aucun épisode ne correspond au filtre.</p>';
    };
    $('#ord').onchange = $('#mind').onchange = $('#rd').onchange = drawEps; showTrack(); drawEps();
    epRedraw = () => { if ($('#eps') && $('#ord') && $('#ord').isConnected) { try { drawEps(); } catch {} } };
    const bindSkip = (id, key) => { $('#' + id).oninput = e => {
      const m = numMap(key), v = num(e.target.value);
      if (v) m[feed.feedUrl] = v; else delete m[feed.feedUrl];
      try { localStorage.setItem(key, JSON.stringify(m)); } catch {}
      if (feed.feedUrl === curFeedUrl) { curSkip = skipFor(curFeedUrl); curSkipEnd = skipEndFor(curFeedUrl); earlyDone = false; armEnd(); }
    }; };
    bindSkip('skipin', 'skip.v1'); bindSkip('skipend', 'skipend.v1');
    const av = xget('dl.auto.v1', {})[feed.feedUrl]; $('#dlauto').value = av && av.new ? 'new' : String(av || 0);
    $('#dlauto').onchange = () => { const m = xget('dl.auto.v1', {}), v = $('#dlauto').value, n = v === 'new' ? 1 : +v; if (v === 'new') m[feed.feedUrl] = { new: Date.now() }; else if (n) m[feed.feedUrl] = n; else delete m[feed.feedUrl]; xset('dl.auto.v1', m); if (n) { toast('Téléchargement automatique activé'); dlAutoRun(); } };
    $('#share').onclick = () => withShare(() => shareFeed(feed));
    $('#lists').onclick = () => listsSheet(feed, () => { $('#fav').classList.toggle('on', isFav());  }, $('#lists'));
    $('#fav').onclick = () => { toggleFav(feed); $('#fav').classList.toggle('on', isFav());  };
    $('#eps').onclick = ev => {
      const el = ev.target.closest('.ep'); if (!el) return;
      if (ev.target.closest('[data-more]')) { el.classList.toggle('open'); return; }
      if (ev.target.closest('[data-pladd]')) { playlistPicker([epSnap(feed.episodes[el.dataset.i], feed)], ev.target.closest('[data-pladd]')); return; }
      if (ev.target.closest('[data-q]')) { qAdd(epSnap(feed.episodes[el.dataset.i], feed)); return; }
      if (ev.target.closest('[data-dl]')) { dlToggle(epSnap(feed.episodes[el.dataset.i], feed)); return; }
      if (ev.target.closest('[data-info]')) { epInfo(feed.episodes[el.dataset.i], feed.title, feed.image, feed.feedUrl); return; }
      if (ev.target.closest('[data-read]')) { const e = feed.episodes[el.dataset.i], g = getProg(feed.feedUrl, e) || {}; setProg(feed.feedUrl, e, g.r ? { r: 0, t: 0 } : { r: 1, t: 0 }); drawEps(); return; }
      if (selMode) { const i = +el.dataset.i; sel.has(i) ? sel.delete(i) : sel.add(i); el.classList.toggle('sel', sel.has(i)); showSel(); return; }
      const ep = feed.episodes[el.dataset.i];
      queue = curList.slice(); qi = queue.indexOf(ep); qCtx = { show: feed.title, art: feed.image, feedUrl: feed.feedUrl };
      play(ep, feed.title, feed.image, feed.feedUrl);
    };
  } catch (err) {
    view.innerHTML = `<p class="dim">Erreur : ${esc(err.message)}</p><p><button id="altfeed">Chercher un autre flux (Podcast Index)</button></p><p class="dim">Si ce podcast est dans tes favoris, retrouve-le avec le bouton ci-dessus puis ajoute la nouvelle version.</p>`;
    $('#altfeed').onclick = () => {
      if (!piReady()) { alert('Saisis d\'abord ta clé et ton secret Podcast Index dans Réglages.'); return; }
      try { localStorage.setItem('pi.prefs', JSON.stringify({ ...piPrefs(), mode: 'title' })); localStorage.setItem('src', 'pi'); } catch {}
      searchSrc = 'pi'; searchQ = f.title || ''; tab = 'search'; render();
    };
  }
}
// Page « Ajouter » : tous les moyens d'ajouter un podcast au même endroit.
function addHtml() {
  const card = (ic, t, d, body) => `<section class="acard"><div class="aic">${ic}</div><div class="abody"><h3>${t}</h3><p class="dim">${d}</p>${body}</div></section>`;
  return card(IC.scan, 'Scanner un QR code', 'Un podcast partagé par un autre utilisateur de l\'app.', '<button type="button" id="a-scan" class="abtn">Scanner</button>') +
    card(IC.link, 'Importer un fichier OPML', 'Reprends tes abonnements depuis une autre application de podcasts (fichier .opml).', '<label class="abtn filebtn">Choisir un fichier<input type="file" id="a-opml" accept=".opml,.xml,text/xml,text/x-opml" hidden></label><p id="a-omsg" class="dim"></p>') +
    card(IC.link, 'Adresse de flux RSS ou lien', 'Colle l\'adresse d\'un flux RSS ou un lien de partage reçu par message.', '<form id="a-form" class="row"><input id="a-url" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="https://…"><button class="abtn">Ouvrir</button></form><p id="a-msg" class="dim"></p>');
}
function bindAdd() {
  $('#a-opml').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const n = await opmlImport(f); $('#a-omsg').textContent = n ? `${n} podcast${n > 1 ? 's ajoutés' : ' ajouté'} à tes favoris.` : 'Aucun nouveau podcast trouvé dans ce fichier.'; } catch { $('#a-omsg').textContent = 'Fichier illisible.'; } };
  $('#a-scan').onclick = () => withShare(() => scanQR());
  $('#a-form').onsubmit = e => {
    e.preventDefault(); const f = feedFromTextSafe($('#a-url').value);
    if (!f) { $('#a-msg').textContent = 'Adresse invalide : elle doit commencer par https://'; return; }
    $('#a-msg').textContent = ''; withShare(() => openShared(f));
  };
}
function renderDiscover() {
  const m = localStorage.getItem('discover') === 'radio' ? 'radio' : 'pod';
  const head = `<div class="favsegw">${seg('discseg', [['pod', 'Podcasts'], ['radio', 'Radios']], m)}</div>`;
  const more = `<details class="sec adds"><summary>Autres façons d'ajouter un podcast</summary>${addHtml()}</details>`;
  if (m === 'radio') renderRadios(head, 'find');
  else { renderSearch(); view.insertAdjacentHTML('afterbegin', head + more); bindAdd(); }
  const d = $('#discseg'); if (d) d.onclick = e => { const b = e.target.closest('button[data-v]'); if (b) { localStorage.setItem('discover', b.dataset.v); renderDiscover(); } };
}
const feedFromTextSafe = t => { try { return typeof feedFromText === 'function' ? feedFromText(t) : (/^https?:\/\//i.test(t.trim()) ? { feedUrl: t.trim(), title: '' } : null); } catch { return null; } };
function renderSettings() {
  const c = Sync.cfg();
  view.innerHTML = `<label>Sauvegarde en ligne</label><div id="bk"></div><p id="cm" class="dim"></p>
  <label>Application</label><p class="dim">Version ${APP_VERSION}</p>${isInstalled() ? '<p class="dim">✓ Application installée sur cet appareil</p>' : '<p><button id="inst-set" type="button">Installer l\'app</button></p>'}<p><button id="upd">Forcer la mise à jour</button></p>${settingsExtraHtml()}<label>Mes données</label><p><button id="opml-x" type="button">Exporter mes favoris (OPML)</button></p>`;
  $('#opml-x').onclick = opmlExport; bindSettingsExtra();
  if ($('#inst-set')) { $('#inst-set').onclick = installApp; refreshInstallUi(); }
  $('#upd').onclick = async () => {
    try { (await navigator.serviceWorker.getRegistrations()).forEach(r => r.unregister()); (await caches.keys()).forEach(k => caches.delete(k)); } catch {}
    location.reload();
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
}

// ---------- Lecture (depuis 0 par défaut ; le suivi de lecture est une option par podcast) ----------
// Suivi optionnel : position + « lu » par épisode (prog.v1), activé podcast par podcast (track.v1). Désactiver le suivi garde la mémoire, la réactiver la retrouve.
const hk = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const epKey = ep => hk(ep.url);
const trackOn = u => !!numMap('track.v1')[u];
const getProg = (u, ep) => (numMap('prog.v1')[u] || {})[epKey(ep)];
function setProg(u, ep, patch) {
  try { const m = numMap('prog.v1'), f = m[u] || (m[u] = {}), k = epKey(ep); f[k] = { ...f[k], ...patch, at: Date.now() }; localStorage.setItem('prog.v1', JSON.stringify(m)); } catch {}
}
function setProgMany(u, eps, patch) {
  try { const m = numMap('prog.v1'), f = m[u] || (m[u] = {}), now = Date.now(); eps.forEach(e => { const k = epKey(e); f[k] = { ...f[k], ...patch, at: now }; }); localStorage.setItem('prog.v1', JSON.stringify(m)); } catch {}
}
async function withShare(fn) { // charge le module de partage s'il manque (ancien cache), puis exécute
  try {
    if (typeof shareFeed !== 'function') await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'share.js?v=' + APP_VERSION; s.onload = ok; s.onerror = () => ko(new Error('share.js introuvable')); document.head.appendChild(s); });
    await fn();
  } catch (e) { alert('Partage indisponible : ' + (e && e.message)); }
}
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2200); }
let curEp = null, lastSave = 0, epRedraw = () => {}, playStartOverride = null;
function saveProg(force) {
  if (!curEp || !trackOn(curFeedUrl)) return;
  const d = effDur(), t = audio.currentTime;
  if (!d || !isFinite(t) || t < 1 || (!force && Date.now() - lastSave < 5000)) return;
  lastSave = Date.now();
  const p = getProg(curFeedUrl, curEp) || {};
  setProg(curFeedUrl, curEp, { t: Math.round(t), d: Math.round(d), ...((!p.r && d - t < 10 + curSkipEnd) ? { r: 1 } : {}) });
}
function markDone() { if (curEp && trackOn(curFeedUrl)) { setProg(curFeedUrl, curEp, { r: 1, t: 0 }); epRedraw(); } }
onAudio('timeupdate', () => saveProg(false));
onAudio('pause', () => { saveProg(true); epRedraw(); });
onAudio('ended', markDone);
let chain = localStorage.getItem('chain') === '1', curList = [], queue = [], qi = -1, qCtx = null;
function playAt(i) { if (i < 0 || i >= queue.length) return false; qi = i; const q = queue[i]; play(q, q._show ?? qCtx.show, q._art ?? qCtx.art, q._feed ?? qCtx.feedUrl); return true; }
const advance = () => chain || !!(qCtx && qCtx.auto); // une playlist s'enchaîne toujours
onAudio('ended', () => { if (sleepEpDone()) return; if (qPlayNext()) return; if (advance()) playAt(qi + 1); });
// Secondes à sauter par podcast (une décimale, virgule ou point acceptés) : réglages fixes, pas une progression de lecture.
const num = s => { const v = parseFloat(String(s).replace(',', '.')); return isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : 0; };
const numMap = key => { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; } };
const skipFor = u => +numMap('skip.v1')[u] || 0;
const skipEndFor = u => +numMap('skipend.v1')[u] || 0;
const syncNav = () => { $('#prev').disabled = qi <= 0; $('#next').disabled = !qGet().length && (qi < 0 || qi >= queue.length - 1); };
$('#prev').onclick = () => playAt(qi - 1); $('#next').onclick = () => qPlayNext() || playAt(qi + 1);
const corsBad = new Set(), hostOf = u => { try { return new URL(u).host; } catch { return u; } };
const note = t => { $('#np-show').textContent = t || curShow; };
let curShow = '', curSkip = 0, curSkipEnd = 0, curFeedUrl = '', earlyDone = false;
function play(ep, show, art, feedUrl) {
  curShow = show;
  syncNav();
  const plain = !dlObj.has(ep.url) && corsBad.has(hostOf(ep.url));
  useEl(plain ? el2 : el1);
  audio.crossOrigin = plain ? null : 'anonymous';
  el1.defaultPlaybackRate = el2.defaultPlaybackRate = rateFor(feedUrl);
  audio.src = dlObj.get(ep.url) || ep.url; note(plain && nightOn ? 'Mode nuit indisponible pour ce podcast.' : '');
  audio.play().catch(e => { if (e && e.name === 'NotAllowedError') note('Lecture bloquée : touche ▶.'); });
  curFeedUrl = feedUrl; curSkipEnd = skipEndFor(feedUrl); earlyDone = false; curDurHint = durSec(ep.dur);
  const skip = curSkip = skipFor(feedUrl); // intro à sauter : réglage fixe par podcast
  curEp = ep; lastSave = 0; $('#player').classList.toggle('liveradio', !!ep.live);
  const pr = trackOn(feedUrl) ? getProg(feedUrl, ep) : null, start = playStartOverride != null ? playStartOverride : pr && !pr.r && pr.t > 5 ? pr.t : skip; playStartOverride = null;
  curChaps = []; getChapters(ep).then(c => { if (curEp === ep) curChaps = c; }); chapTick(); // reprise si le suivi est activé
  if (start > 0) audio.addEventListener('canplay', () => { if (audio.duration > start) audio.currentTime = start; }, { once: true });
  const cover = (ep.image || art || '').replace(/\d+x\d+bb/, '600x600bb');
  $('#np-art').src = cover; $('#np-art').style.visibility = cover ? 'visible' : 'hidden';
  $('#player').hidden = false; $('#np-title').textContent = ep.title; $('#np-show').textContent = show;
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: ep.title, artist: show, artwork: cover ? [{ src: cover, sizes: '512x512' }] : [] });
  }
}
const setPlaying = on => $('#player').classList.toggle('playing', on);
['playing', 'play'].forEach(ev => onAudio(ev, () => setPlaying(true)));
['pause', 'ended', 'emptied', 'error'].forEach(ev => onAudio(ev, () => setPlaying(false)));
onAudio('play', () => { $('#pp').innerHTML = IC.pause; navigator.mediaSession && (navigator.mediaSession.playbackState = 'playing'); });
onAudio('pause', () => { $('#pp').innerHTML = IC.playBig; navigator.mediaSession && (navigator.mediaSession.playbackState = 'paused'); });
const seekEl = $('#seek');
let seeking = false;
const clock = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0'); };
function syncTimes(at) {
  const d = audio.duration, ok = isFinite(d) && d > 0, t = at == null ? audio.currentTime : at;
  $('#t-cur').textContent = clock(t);
  $('#t-tot').textContent = ok ? 'Total ' + clock(d) : 'Total --:--';
  $('#t-rem').textContent = ok ? '-' + clock(d - t) : '-';
}
const setRatio = r => { seekEl.style.setProperty('--p', r); $('#player').style.setProperty('--p', r); };
function syncSeek() {
  if (seeking) return;
  syncTimes();
  const d = audio.duration;
  setRatio(isFinite(d) && d > 0 ? (audio.ended ? 1 : Math.min(1, audio.currentTime / d)) : 0);
}
function resetSeek() { seeking = false; setRatio(0); syncTimes(); }
['loadstart', 'emptied'].forEach(ev => onAudio(ev, resetSeek));
['loadedmetadata', 'durationchange', 'timeupdate', 'seeked', 'ended'].forEach(ev => onAudio(ev, syncSeek));
onAudio('timeupdate', checkSleep); onAudio('timeupdate', chapTick);
// Sauter les dernières secondes : on termine l'épisode (et on enchaîne si activé) quand il ne reste que ce délai.
// Minuterie précise (≈ 0,1 s) plutôt que les événements « timeupdate » (≈ 0,25 s) ; la durée du flux RSS sert de repli si le navigateur ne la connaît pas.
let endT = 0, curDurHint = 0;
const effDur = () => (isFinite(audio.duration) && audio.duration > 0) ? audio.duration : curDurHint;
function fireEnd() {
  earlyDone = true; clearTimeout(endT); markDone();
  if (sleepEpDone()) audio.pause();
  else if (qPlayNext()) { /* file « À écouter » */ }
  else if (advance() && queue.length && qi < queue.length - 1) playAt(qi + 1);
  else { audio.pause(); const d = audio.duration; if (isFinite(d)) { try { audio.currentTime = d; } catch {} } }
}
function armEnd() {
  clearTimeout(endT);
  const d = effDur();
  if (!curSkipEnd || earlyDone || audio.paused || !d || d <= curSkipEnd + curSkip + 1) return;
  const left = (d - curSkipEnd - audio.currentTime) / (audio.playbackRate || 1);
  if (left <= 0.03) { fireEnd(); return; }
  endT = setTimeout(armEnd, Math.max(10, Math.min(1000, left * 1000 - 20)));
}
['playing', 'play', 'seeked', 'timeupdate', 'ratechange', 'loadedmetadata', 'durationchange'].forEach(ev => onAudio(ev, armEnd));
// Barre de progression maison : active sur toute sa longueur, du premier au dernier pixel.
const ratioAt = e => { const r = seekEl.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
const dragTo = e => { const r = ratioAt(e); setRatio(r); syncTimes(r * audio.duration); return r; };
seekEl.addEventListener('pointerdown', e => { if (!(audio.duration > 0)) return; seeking = true; seekEl.setPointerCapture(e.pointerId); dragTo(e); });
seekEl.addEventListener('pointermove', e => { if (seeking) dragTo(e); });
const endDrag = e => { if (!seeking) return; const r = ratioAt(e); seeking = false; audio.currentTime = r * audio.duration; syncSeek(); };
seekEl.addEventListener('pointerup', endDrag);
seekEl.addEventListener('pointercancel', () => { seeking = false; syncSeek(); });
seekEl.addEventListener('keydown', e => { if (e.key === 'ArrowRight') audio.currentTime += 5; else if (e.key === 'ArrowLeft') audio.currentTime -= 5; });
const toggle = () => audio.paused ? audio.play() : audio.pause();
const skip = d => { audio.currentTime = Math.max(0, audio.currentTime + d); };
$('#pp').onclick = toggle; $('#rw').onclick = () => skip(-15); $('#ff').onclick = () => skip(30);
if ('mediaSession' in navigator) {
  const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch {} };
  h('play', () => audio.play()); h('pause', () => audio.pause());
  h('seekbackward', () => skip(-15)); h('seekforward', () => skip(30));
  h('stop', () => audio.pause());
  h('nexttrack', () => qPlayNext() || playAt(qi + 1)); h('previoustrack', () => playAt(qi - 1));
}

// ---------- Minuterie d'arrêt (désactivée par défaut, non persistée) ----------
let sleepEnd = 0, sleepT = null, sleepEp = false, sleepTick = 0;
$('#sleep').onclick = () => sleepMenu($('#sleep'));
function setSleep(min) { // min : minutes, 'ep' (fin de l'épisode) ou 0 (désactivé)
  clearTimeout(sleepT); clearInterval(sleepTick); sleepEp = min === 'ep'; sleepEnd = typeof min === 'number' && min ? Date.now() + min * 60000 : 0;
  el1.volume = el2.volume = 1;
  $('#sleep').innerHTML = labeled(IC.timer, sleepEp ? 'Fin ép.' : min ? `${min} min` : 'Minuteur'); $('#sleep').classList.toggle('on', !!(sleepEnd || sleepEp));
  if (sleepEnd) sleepT = setTimeout(checkSleep, min * 60000 + 100);
  if (sleepEnd || sleepEp) sleepTick = setInterval(sleepStep, 500);
}
function sleepStep() { // fondu progressif du volume avant l'arrêt
  if (xget('sleep.fade', true) === false) return;
  let rem = Infinity;
  if (sleepEnd) rem = (sleepEnd - Date.now()) / 1000;
  else if (sleepEp) { const d = effDur(); if (d) rem = (d - (curSkipEnd || 0) - audio.currentTime) / (audio.playbackRate || 1); }
  if (rem < SLEEP_FADE) { const v = Math.max(0.02, Math.min(1, rem / SLEEP_FADE)) ** 2; el1.volume = el2.volume = v; } else if (audio.volume < 1) el1.volume = el2.volume = 1;
}
function sleepEpDone() { if (!sleepEp) return false; setSleep(0); return true; }
function checkSleep() {
  if (sleepEnd && Date.now() >= sleepEnd) { audio.pause(); setSleep(0); }
}

// ---------- Mises à jour : app + podcasts à chaque ouverture ----------
let pendingReload = false;
function applyPendingReload() { if (pendingReload && !audio.src) location.reload(); } // jamais pendant ni après une lecture : la nouvelle version s'applique à la prochaine ouverture
async function refreshFavs() {
  try { await Sync.pull(); } catch {}
  feedCache.clear();
  const res = await Promise.allSettled(Sync.favs().map(f => loadFeed(f.feedUrl)));
  const upd = Sync.favs().map((f, i) => { const v = res[i].value; return v ? { ...f, title: v.title, image: v.image || f.image, author: v.author, genre: v.genre, count: v.count, last: v.last, desc: v.desc.slice(0, 300) } : f; });
  if (JSON.stringify(upd) !== JSON.stringify(Sync.favs())) localStorage.setItem('favs.v1', JSON.stringify(upd)); // maj locale des infos, sans resynchroniser
  seenInit(); refreshNewBadge(); dlAutoRun();
  if ((tab === 'favs' || tab === 'home') && $('#back').hidden) renderFavs();
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
$('#closep').onclick = () => { // ferme le lecteur : arrête la lecture (la position est enregistrée si le suivi est actif)
  try { saveProg(true); } catch {}
  clearTimeout(endT); setSleep(0); audio.pause(); audio.removeAttribute('src'); audio.load();
  curEp = null; queue = []; qi = -1; curChaps = []; curFeedUrl = ''; $('#player').hidden = true; $('#player').classList.remove('full');
  if ('mediaSession' in navigator) { try { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; } catch {} }
  document.body.classList.remove('hasplayer'); syncNav();
};
$('#speed').onclick = () => speedMenu($('#speed')); $('#info').onclick = () => { if (curEp) epInfo(curEp, curShow, '', curFeedUrl); else toast('Aucun épisode en cours'); };
dlInit().then(() => { if (tab === 'favs' || tab === 'home') renderFavs(); }); applyRate();
render(); checkUpdates(); refreshFavs();

// ---------- Installation : bouton toujours visible + étapes adaptées à l'appareil et au navigateur ----------
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// Installée sur cet appareil ? Ouverte en mode application, ou signalée par le navigateur (getInstalledRelatedApps), ou mémorisée (le stockage est partagé avec le navigateur).
const flagInstalled = v => { try { v ? localStorage.setItem('app.installed', '1') : localStorage.removeItem('app.installed'); } catch {} };
const isInstalled = () => { if (isStandalone()) { flagInstalled(true); return true; } try { return localStorage.getItem('app.installed') === '1'; } catch { return false; } };
async function detectInstalled() {
  if (isStandalone()) { flagInstalled(true); return; }
  try { if (navigator.getInstalledRelatedApps) { const l = await navigator.getInstalledRelatedApps(); if (l.length > 0) flagInstalled(true); } } catch {}
}
const devInfo = (() => {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1), android = /Android/.test(ua);
  const br = /SamsungBrowser/.test(ua) ? 'samsung' : /Edg(A|iOS)?\//.test(ua) ? 'edge' : /Firefox|FxiOS/.test(ua) ? 'firefox' : /OPR|OPiOS/.test(ua) ? 'opera' : 'chrome';
  return { ios, android, mobile: ios || android, br, iosSafari: ios && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua) };
})();
function installSteps() {
  const d = devInfo;
  if (d.ios) return d.iosSafari ? ["Touche le bouton Partager (carré avec une flèche vers le haut) en bas de l'écran.", "Fais défiler et choisis « Sur l'écran d'accueil ».", "Valide avec « Ajouter »."] : ["Sur iPhone, l'installation passe par Safari : ouvre cette page dans Safari.", "Touche Partager (carré avec une flèche), puis « Sur l'écran d'accueil »."];
  if (d.android) {
    if (d.br === 'samsung') return ["Touche le menu (trois traits) en bas à droite.", "Choisis « Ajouter la page à » puis « Écran d'accueil », ou « Installer ».", "Valide."];
    if (d.br === 'firefox') return ["Touche le menu (⋮) en haut à droite.", "Choisis « Installer ».", "Valide."];
    return ["Touche le menu du navigateur (⋮) en haut à droite.", "Choisis « Installer l'application » (ou « Ajouter à l'écran d'accueil »).", "Valide avec « Installer ».", "Si ces choix n'apparaissent pas, ouvre la page directement dans Chrome (pas dans une autre application) et recommence."];
  }
  if (d.br === 'firefox') return ["Firefox pour ordinateur n'installe pas les applications web : utilise Chrome ou Edge pour installer Podcasts."];
  return ["Dans la barre d'adresse, clique sur l'icône d'installation (écran avec une flèche, à droite).", "Ou ouvre le menu (⋮) → « Enregistrer et partager » → « Installer Podcasts… » (Edge : menu ··· → Applications → « Installer ce site comme une application »).", "Valide avec « Installer »."];
}
async function installApp() {
  const p = window.__bip;
  if (p) { try { p.prompt(); await p.userChoice; } catch {} window.__bip = null; refreshInstallUi(); return; }
  withShare(() => modal(`<h3>Installer l'application</h3><ol class="steps">${installSteps().map(s => `<li>${esc(s)}</li>`).join('')}</ol><p class="dim sm">L'installation permet la lecture écran verrouillé et une ouverture plein écran.</p><button data-close class="ghost">Compris</button>`));
}
function refreshInstallUi() {
  const box = $('#install'), txt = $('#install-text'), btn = $('#install-btn');
  if (isInstalled()) { box.hidden = true; const sb = $('#inst-set'); if (sb) sb.closest('p').innerHTML = '<span class="dim">✓ Application installée sur cet appareil</span>'; return; }
  if (devInfo.mobile) {
    box.hidden = false; btn.hidden = false;
    txt.textContent = window.__bip ? "Installe l'app sur ton téléphone pour l'utiliser comme une vraie application, avec la lecture écran verrouillé." : "Installe l'app pour la lecture écran verrouillé : touche le bouton pour voir comment faire sur ton appareil.";
    btn.textContent = window.__bip ? "Installer l'app" : 'Comment installer';
  } else box.hidden = true;
  const sb = $('#inst-set'); if (sb) sb.textContent = window.__bip ? "Installer l'app" : 'Comment installer';
}
$('#install-btn').onclick = installApp;
window.addEventListener('bip-ready', () => { flagInstalled(false); refreshInstallUi(); }); // le navigateur propose l'installation : l'app n'est donc pas installée
if (window.__bip) flagInstalled(false);
window.addEventListener('appinstalled', () => { window.__bip = null; flagInstalled(true); refreshInstallUi(); });
refreshInstallUi(); detectInstalled().then(refreshInstallUi);

// ---------- Mode nuit (compresseur) et analyse du son pour le visualiseur ----------
// Le traitement audio exige un fichier servi avec CORS ; sinon le son serait coupé. Si l'hébergeur le refuse, on relit le fichier sur l'autre élément audio, sans traitement.
let nightOn = localStorage.getItem('night') === '1', ctx = null, comp = null, makeup = null, analyser = null;
const nightBtn = $('#night');
const showNight = () => { nightBtn.innerHTML = labeled(IC.moon, 'Nuit'); nightBtn.classList.toggle('on', nightOn); nightBtn.setAttribute('aria-pressed', nightOn); };
function nightParams() {
  if (!comp) return;
  comp.threshold.value = nightOn ? -45 : 0; comp.ratio.value = nightOn ? 12 : 1;
  comp.knee.value = 30; comp.attack.value = 0.005; comp.release.value = 0.3;
  makeup.gain.value = nightOn ? 1.7 : 1;
}
function buildGraph() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaElementSource(el1);
  comp = ctx.createDynamicsCompressor(); makeup = ctx.createGain(); analyser = ctx.createAnalyser();
  analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.75;
  src.connect(comp); comp.connect(makeup); makeup.connect(analyser); analyser.connect(ctx.destination);
}
function graphFailed() {
  corsBad.add(hostOf(audio.src));
  const url = audio.src, t = audio.currentTime;
  useEl(el2); audio.crossOrigin = null; audio.src = url;
  onceMeta(() => { const at = t > 1 ? t : curSkip; if (at > 0) { try { audio.currentTime = at; } catch {} } });
  audio.play().catch(() => {});
  note('Mode nuit et visualiseur réel indisponibles pour ce podcast.');
}
const onceMeta = fn => audio.addEventListener('loadedmetadata', fn, { once: true });
Sync.onChange = keys => { // données reçues d'un autre appareil : on rafraîchit l'écran si on peut le faire sans gêner
  try {
    if (keys.has('prog.v1') || keys.has('track.v1')) epRedraw();
    if ((tab === 'favs' || tab === 'home') && $('#back').hidden && !document.querySelector('.modal') && !popState) renderFavs();
  } catch {}
};
Sync.onSettings = () => { // réglages reçus de la sauvegarde
  chain = localStorage.getItem('chain') === '1'; nightOn = localStorage.getItem('night') === '1'; searchSrc = localStorage.getItem('src') || '';
  curSkip = skipFor(curFeedUrl); curSkipEnd = skipEndFor(curFeedUrl);
  try { showNight(); nightParams(); } catch {}
};
nightBtn.onclick = () => { nightOn = !nightOn; localStorage.setItem('night', nightOn ? '1' : '0'); showNight(); nightParams(); };
onAudio('error', () => {
  if (!audio.src) return;
  if (audio === el1 && audio.crossOrigin && !corsBad.has(hostOf(audio.src))) { graphFailed(); return; }
  const c = audio.error ? audio.error.code : 0;
  note('Erreur de lecture' + (c ? ' (code ' + c + ')' : '') + ' : ' + ({ 2: 'réseau', 3: 'décodage', 4: 'fichier non lisible' }[c] || 'inconnue') + '. Touche ▶ pour réessayer.');
});
// Reprise automatique : coupure réseau / flux bloqué pendant la nuit → on se reconnecte à la même position et on relance.
let rcN = 0, rcT = null, stallT = null;
function reconnect() {
  clearTimeout(rcT); clearTimeout(stallT);
  if (!audio.src || rcN >= 12) return;
  const delay = Math.min(60000, 3000 * Math.pow(1.6, rcN)); rcN++;
  rcT = setTimeout(() => {
    if (!navigator.onLine) { reconnect(); return; }
    const t = curEp && curEp.live ? 0 : (audio.currentTime || 0), src = audio.src;
    const go = () => { try { if (t > 0) audio.currentTime = t; } catch {} audio.play().catch(() => reconnect()); };
    audio.addEventListener('loadedmetadata', go, { once: true }); audio.src = src; audio.load();
  }, delay);
}
onAudio('playing', () => { rcN = 0; clearTimeout(rcT); clearTimeout(stallT); });
onAudio('pause', () => { clearTimeout(stallT); });
onAudio('waiting', () => { clearTimeout(stallT); stallT = setTimeout(() => { if (!audio.paused) reconnect(); }, 20000); });
onAudio('stalled', () => { clearTimeout(stallT); stallT = setTimeout(() => { if (!audio.paused && audio.readyState < 3) reconnect(); }, 25000); });
onAudio('error', () => { const c = audio.error ? audio.error.code : 0; if (audio.src && (c === 2 || c === 4 || c === 0) && !(audio === el1 && audio.crossOrigin && !corsBad.has(hostOf(audio.src)))) reconnect(); });
addEventListener('online', () => { if (audio.src && audio.error) { rcN = 0; reconnect(); } });
bootExtra();
setInterval(() => { if (ctx && ctx.state === 'suspended' && !audio.paused) ctx.resume().catch(() => {}); }, 8000); // le mode Nuit ne doit pas couper le son quand Android suspend le contexte audio
onAudio('canplay', () => { if (audio === el1 && !ctx && audio.crossOrigin) { buildGraph(); nightParams(); } if (ctx) ctx.resume().catch(() => {}); });
showNight();

// ---------- Modes du lecteur : normal / réduit (mini) / plein écran avec visualiseur ----------
(() => {
  const pl = $('#player'), btn = $('#collapse'), exp = $('#expand');
  let mode = 'normal'; try { mode = localStorage.getItem('pmode') === 'mini' ? 'mini' : 'normal'; } catch {}
  const set = m => {
    mode = m;
    pl.classList.toggle('mini', m === 'mini'); pl.classList.toggle('full', m === 'full');
    document.body.classList.toggle('noscroll', m === 'full');
    btn.setAttribute('aria-label', m === 'normal' ? 'Réduire le lecteur' : m === 'mini' ? 'Agrandir le lecteur' : 'Fermer le plein écran');
    if (m !== 'full') { try { localStorage.setItem('pmode', m); } catch {} }
    m === 'full' ? startViz() : stopViz();
  };
  btn.onclick = () => set(mode === 'normal' ? 'mini' : 'normal');
  exp.onclick = () => set('full');
  $('.np').onclick = () => { if (mode === 'mini') set('normal'); };

  // Visualiseur : vraies fréquences si le traitement audio est branché (CORS), sinon animation synchronisée à la lecture.
  const cv = $('#viz'), g = cv.getContext('2d'), N = 28;
  let raf = 0, levels = new Array(N).fill(0), data = null, peak = 0.3;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const playing = !audio.paused && !audio.ended;
    const real = audio === el1 && !!analyser && ctx && ctx.state === 'running' && playing;
    if (real) { data = data || new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(data); }
    // Échelle logarithmique 60 Hz – 8 kHz (la voix n'a presque rien au-dessus), avec gain automatique pour que toutes les barres vivent
    let raw = null;
    if (real) {
      const binHz = ctx.sampleRate / analyser.fftSize, maxBin = data.length - 1; raw = new Array(N); let mx = 0;
      for (let i = 0; i < N; i++) {
        const f0 = 60 * Math.pow(8000 / 60, i / N), f1 = 60 * Math.pow(8000 / 60, (i + 1) / N);
        const b0 = Math.min(maxBin, Math.floor(f0 / binHz)), b1 = Math.min(maxBin, Math.max(b0, Math.ceil(f1 / binHz)));
        let s = 0; for (let b = b0; b <= b1; b++) s = Math.max(s, data[b]);
        raw[i] = (s / 255) * (1 + 1.8 * i / N); // les aigus de la voix sont plus faibles : on les compense
        mx = Math.max(mx, raw[i]);
      }
      peak = Math.max(0.25, peak * 0.995, mx);
    }
    for (let i = 0; i < N; i++) {
      let target;
      if (real) target = Math.pow(Math.min(1, raw[i] / peak), 1.4);
      else if (playing) target = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t / 260 + i * 0.7)) + 0.25 * (0.5 + 0.5 * Math.sin(t / 130 + i * 1.9)) * (0.6 + 0.4 * Math.sin(t / 900 + i));
      else target = 0.04;
      levels[i] += (target - levels[i]) * (target > levels[i] ? 0.5 : 0.12);
    }
    const bw = w / N, grad = g.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, '#9bb0ff'); grad.addColorStop(1, '#c3a6ff'); g.fillStyle = grad;
    for (let i = 0; i < N; i++) {
      const bh = Math.max(4, levels[i] * h), x = i * bw + bw * 0.18, ww = bw * 0.64, y = (h - bh) / 2;
      g.beginPath(); (g.roundRect ? g.roundRect(x, y, ww, bh, ww / 2) : g.rect(x, y, ww, bh)); g.fill();
    }
  }
  function startViz() { if (!raf) raf = requestAnimationFrame(frame); }
  function stopViz() { cancelAnimationFrame(raf); raf = 0; }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopViz(); else if (mode === 'full') startViz(); });
  set(mode);
})();

// ---------- Égaliseur du lecteur réduit/normal : suit le vrai son quand l'analyse est branchée ----------
(() => {
  const pl = $('#player'), bars = [...document.querySelectorAll('.eq i')];
  const bands = [[100, 400], [400, 1200], [1200, 3000], [3000, 7000]];
  let lv = [0, 0, 0, 0], peak = 0.3, buf = null;
  function tick() {
    requestAnimationFrame(tick);
    if (document.hidden || pl.hidden) return;
    const live = audio === el1 && !!analyser && !!ctx && ctx.state === 'running' && !audio.paused && !pl.classList.contains('full');
    pl.classList.toggle('live', live);
    if (!live) { if (bars[0].style.height) bars.forEach(b => (b.style.height = '')); return; }
    buf = buf || new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(buf);
    const binHz = ctx.sampleRate / analyser.fftSize; let mx = 0; const raw = bands.map(([f0, f1], i) => {
      let s = 0; for (let b = Math.floor(f0 / binHz); b <= Math.min(buf.length - 1, Math.ceil(f1 / binHz)); b++) s = Math.max(s, buf[b]);
      const v = (s / 255) * (1 + 0.6 * i); mx = Math.max(mx, v); return v;
    });
    peak = Math.max(0.25, peak * 0.995, mx);
    bars.forEach((el, i) => { const t = Math.pow(Math.min(1, raw[i] / peak), 1.3); lv[i] += (t - lv[i]) * (t > lv[i] ? 0.55 : 0.15); el.style.height = (15 + 85 * lv[i]).toFixed(0) + '%'; });
  }
  requestAnimationFrame(tick);
})();

$('#sleep').innerHTML = labeled(IC.timer, 'Minuteur');

// ---------- Listes déroulantes : version sombre et lisible sur ordinateur (le sélecteur natif reste sur mobile) ----------
(() => {
  const mq = matchMedia('(hover:hover) and (pointer:fine)');
  const vd = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  let menu = null;
  const closeMenu = () => { if (!menu) return; menu.el.remove(); menu.btn.classList.remove('open'); document.removeEventListener('keydown', menu.key, true); menu = null; };
  function open(sel, btn) {
    closeMenu();
    const el = document.createElement('div'); el.className = 'ddm'; el.setAttribute('role', 'listbox');
    el.innerHTML = [...sel.options].map((o, i) => `<button type="button" class="ddi${i === sel.selectedIndex ? ' sel' : ''}" role="option" data-i="${i}"><span>${esc(o.textContent)}</span>${i === sel.selectedIndex ? '<b>✓</b>' : ''}</button>`).join('');
    document.body.appendChild(el);
    const r = btn.getBoundingClientRect(), h = el.offsetHeight, below = innerHeight - r.bottom - 12;
    el.style.minWidth = r.width + 'px'; el.style.left = Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8)) + 'px';
    if (h > below && r.top > below) { el.style.bottom = (innerHeight - r.top + 6) + 'px'; el.style.maxHeight = Math.min(h, r.top - 12) + 'px'; }
    else { el.style.top = (r.bottom + 6) + 'px'; el.style.maxHeight = Math.max(160, below) + 'px'; }
    btn.classList.add('open');
    let cur = sel.selectedIndex; const items = [...el.querySelectorAll('.ddi')];
    const mark = () => { items.forEach((x, i) => x.classList.toggle('hl', i === cur)); items[cur] && items[cur].scrollIntoView({ block: 'nearest' }); };
    const pick = i => { sel.selectedIndex = i; sel.dispatchEvent(new Event('change', { bubbles: true })); sel.value = sel.value; closeMenu(); btn.focus(); };
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(items.length - 1, cur + 1); mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(0, cur - 1); mark(); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(cur); }
    };
    document.addEventListener('keydown', key, true);
    el.onclick = e => { const b = e.target.closest('.ddi'); if (b) pick(+b.dataset.i); };
    el.onmousemove = e => { const b = e.target.closest('.ddi'); if (b) { cur = +b.dataset.i; mark(); } };
    menu = { el, btn, key }; el.querySelector('.sel') && el.querySelector('.sel').scrollIntoView({ block: 'center' });
  }
  function enhance(sel) {
    if (sel.dataset.dd) return; sel.dataset.dd = '1';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ddb'; if (sel.id) b.id = sel.id + '-dd';
    const sync = () => { const o = sel.options[sel.selectedIndex]; b.innerHTML = `<span>${esc(o ? o.textContent : '')}</span>${IC.chev}`; b.hidden = sel.hidden; b.disabled = sel.disabled; };
    Object.defineProperty(sel, 'value', { get() { return vd.get.call(sel); }, set(v) { vd.set.call(sel, v); sync(); }, configurable: true });
    new MutationObserver(sync).observe(sel, { childList: true, attributes: true, attributeFilter: ['hidden', 'disabled'] });
    sel.addEventListener('change', sync);
    b.onclick = () => (menu && menu.btn === b ? closeMenu() : open(sel, b));
    sel.after(b); sync();
  }
  const scan = () => document.querySelectorAll('select:not([data-dd])').forEach(enhance);
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true }); scan();
  document.addEventListener('pointerdown', e => { if (menu && !menu.el.contains(e.target) && !menu.btn.contains(e.target)) closeMenu(); }, true);
  addEventListener('resize', closeMenu); addEventListener('scroll', e => { if (menu && !menu.el.contains(e.target)) closeMenu(); }, true);
})();
