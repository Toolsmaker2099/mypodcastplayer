const APP_VERSION = '2026-11-04.37';
const $ = s => document.querySelector(s);
const svg = (d, n = 20, fill = false) => `<svg viewBox="0 0 24 24" width="${n}" height="${n}" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true">${d}</svg>`;
const IC = {
  star: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>', 21),
  chev: svg('<path d="m6 9 6 6 6-6"/>', 20),
  play: svg('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>', 18, true),
  playBig: svg('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>', 28, true),
  pause: svg('<rect x="6" y="5" width="4.5" height="14" rx="1.3"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.3"/>', 28, true),
};
IC.moon = svg('<path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z"/>', 17);
IC.timer = svg('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 2.5h5"/>', 17);
IC.eq = svg('<path d="M5 14v4M9 6v12M13 10v8M17 4v14M21 12v6"/>', 17);
const labeled = (ic, t) => `${ic}<span>${t}</span>`;
const starBtn = on => `<button class="ibtn star${on ? ' on' : ''}" data-star aria-label="Favori" aria-pressed="${on}">${IC.star}</button>`;
const setStar = (b, on) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); };
const audio = $('#audio'), view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let tab = 'favs', feedCache = new Map(); // cache mémoire seulement (jamais de progression)

// ---------- Réseau (CORS : direct, puis proxy du worker) ----------
async function fetchText(url) {
  try { const r = await fetch(url); if (r.ok) return await r.text(); } catch {}
  const c = Sync.cfg();
  if (!c.proxy) throw new Error('Flux bloqué par CORS : configure le proxy dans Réglages.');
  const r = await fetch(`${c.proxy.replace(/\/$/, '')}/?url=${encodeURIComponent(url)}`);
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
  const episodes = [...doc.querySelectorAll('item')].map(it => ({
    title: txt(it, 'title'), date: txt(it, 'pubDate'),
    desc: plain(ns(it, 'content:encoded') || txt(it, 'description') || ns(it, 'itunes:summary')).slice(0, 700),
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
function showItem(f, star) {
  return `<div class="item${f.feedUrl ? '' : ' off'}" data-feed="${esc(f.feedUrl)}"><img src="${esc(f.image)}" alt=""><div class="t"><b>${esc(f.title)}</b><small>${esc(f.author || '')}</small><small class="m">${esc(meta(f))}</small>${f.desc ? `<p class="d">${esc(f.desc)}</p>` : ''}</div>${star ? starBtn(Sync.favs().some(x => x.feedUrl === f.feedUrl)) : ''}</div>`;
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
  view.innerHTML = l.length ? l.map(f => showItem(f, true)).join('') : '<p class="dim">Aucun favori. Utilise la recherche ou ajoute un flux RSS dans Réglages.</p>';
  view.querySelectorAll('.item').forEach((el, i) => el.onclick = ev => {
    if (ev.target.closest('[data-star]')) { // retire (ou remet) le favori d'un clic ; l'élément disparaît à la prochaine ouverture de la liste
      toggleFav(l[i]);
      const on = Sync.favs().some(x => x.feedUrl === l[i].feedUrl);
      setStar(ev.target.closest('[data-star]'), on); el.classList.toggle('removed', !on);
      return;
    }
    openFeed(l[i]);
  });
}
// ---------- Podcast Index (clé + secret saisis dans Réglages, stockés sur l'appareil seulement) ----------
const piCfg = () => { try { return JSON.parse(localStorage.getItem('pi.cfg')) || {}; } catch { return {}; } };
const piReady = () => { const c = piCfg(); return !!(c.key && c.secret); };
async function piGet(path) {
  const c = piCfg(), date = String(Math.floor(Date.now() / 1000));
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(c.key + c.secret + date));
  const auth = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const headers = { 'X-Auth-Date': date, 'X-Auth-Key': c.key, Authorization: auth };
  let r;
  try { r = await fetch('https://api.podcastindex.org/api/1.0/' + path, { headers }); }
  catch (e) { // CORS/réseau : repli par le proxy du worker, s'il est configuré
    const p = Sync.cfg().proxy;
    if (!p) throw new Error('Podcast Index injoignable depuis le navigateur : configure le proxy (worker) dans Réglages.');
    r = await fetch(p.replace(/\/$/, '') + '/podcastindex/' + path, { headers });
  }
  if (r.status === 401 || r.status === 403) throw new Error('Clé ou secret Podcast Index refusé.');
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
const catFr = c => CAT_FR[c] || c;
let piCats = null;
const piCategories = async () => piCats || (piCats = (await piGet('categories/list')).map(c => c.name).sort((x, y) => x.localeCompare(y, 'fr')));
const piPrefs = () => { const d = { mode: 'search', lang: 'fr', cat: '', sort: 'rel', clean: false, full: false }; try { const s = JSON.parse(localStorage.getItem('pi.prefs')); return { ...d, ...s, mode: ['search', 'title', 'trending', 'recent', 'new'].includes(s && s.mode) ? s.mode : 'search' }; } catch { return d; } };
const piMap = x => ({ feedUrl: x.url, title: x.title, image: x.artwork || x.image, author: x.author || x.ownerName,
  genre: catFr(Object.values(x.categories || {})[0] || ''), count: x.episodeCount, last: (x.newestItemPubdate || x.newestItemPublishTime) ? new Date((x.newestItemPubdate || x.newestItemPublishTime) * 1000).toISOString() : '', desc: (x.description || '').replace(/<[^>]*>/g, '').slice(0, 300) });
let searchSrc = localStorage.getItem('src') || '';
const PRODUCERS = [
  ['France Inter', /france inter/i], ['France Culture', /france culture/i], ['franceinfo', /franceinfo|france info/i],
  ['France TV', /france t[ée]l[ée]visions|france\.?\s?tv/i], ['Radio France', /radio france|france (inter|culture|info|bleu|musique)|\bmouv|\bfip\b/i],
  ['RTL', /\brtl\b/i], ['Europe 1', /europe 1/i], ['RFI', /\brfi\b|radio france internationale/i], ['Arte', /\barte\b/i],
];
let searchProd = '', searchQ = '', filtersOpen = false;
const seg = (id, opts, val) => `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${v === val ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
const SVG_SEARCH = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const PI_MODES = [['search', 'Mots-clés'], ['title', 'Titre'], ['trending', 'Tendances'], ['recent', 'Mises à jour'], ['new', 'Nouveaux']];
const PI_HINT = { search: 'Rechercher…', title: 'Titre du podcast…', trending: 'Filtrer (facultatif)…', recent: 'Filtrer (facultatif)…', new: 'Filtrer (facultatif)…' };
function renderSearch() {
  if (!searchSrc) searchSrc = piReady() ? 'pi' : 'apple';
  if (searchSrc === 'pi' && !piReady()) searchSrc = 'apple';
  const pi = searchSrc === 'pi', p = piPrefs();
  const active = pi ? [p.lang !== 'fr', !!p.cat, p.sort !== 'rel', p.clean, p.full, !!searchProd].filter(Boolean).length : 0;
  view.innerHTML = `${seg('srcseg', [['apple', 'Apple Podcasts'], ['pi', piReady() ? 'Podcast Index' : 'Podcast Index 🔒']], searchSrc)}
    <form id="sf" class="searchbar">${SVG_SEARCH}<input type="search" id="q" placeholder="${pi ? PI_HINT[p.mode] : 'Rechercher un podcast…'}" value="${esc(searchQ)}" enterkeyhint="search"><button>Chercher</button></form>
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
      if (ev.target.closest('[data-star]')) { toggleFav(list[i]); setStar(ev.target.closest('[data-star]'), Sync.favs().some(x => x.feedUrl === list[i].feedUrl)); }
      else openFeed(list[i], () => render());
    };
  });
  const run = async () => {
    const q = $('#q').value.trim(); searchQ = q;
    const p = piPrefs(), prod = pi ? PRODUCERS.find(x => x[0] === searchProd) : null;
    const browse = pi && ['trending', 'recent', 'new'].includes(p.mode);
    if (!q && !prod && !browse) { $('#res').innerHTML = ''; return; }
    $('#res').innerHTML = '<p class="dim">Recherche…</p>';
    try {
      if (pi) {
        let feeds;
        const since = days => `&since=${Math.floor(Date.now() / 1000) - days * 86400}`, lg = p.lang ? '&lang=' + p.lang : '', ct = p.cat ? '&cat=' + encodeURIComponent(p.cat) : '';
        if (p.mode === 'trending') feeds = await piGet(`podcasts/trending?max=100${since(14)}${lg}${ct}`);
        else if (p.mode === 'recent') feeds = await piGet(`recent/feeds?max=100${lg}${ct}`);
        else if (p.mode === 'new') feeds = await piGet(`recent/newfeeds?max=100${since(30)}`);
        else {
          const term = encodeURIComponent(q || (prod && prod[0]) || '');
          feeds = await piGet(p.mode === 'title' ? `search/bytitle?max=100&q=${term}${p.clean ? '&clean' : ''}` : `search/byterm?max=100&q=${term}${p.clean ? '&clean' : ''}${p.full ? '&fulltext' : ''}`);
        }
        feeds = feeds.filter(x => x.url && !x.dead);
        if (p.lang && ['search', 'title', 'new'].includes(p.mode)) feeds = feeds.filter(x => (x.language || '').toLowerCase().startsWith(p.lang));
        if (p.cat && ['search', 'title', 'new'].includes(p.mode)) feeds = feeds.filter(x => Object.values(x.categories || {}).some(c => c.toLowerCase() === p.cat.toLowerCase()));
        if (prod) feeds = feeds.filter(x => prod[1].test(x.author || '') || prod[1].test(x.ownerName || '') || prod[1].test(x.title || ''));
        if (q && browse) { const ql = q.toLowerCase(); feeds = feeds.filter(x => ((x.title || '') + ' ' + (x.author || '') + ' ' + (x.description || '')).toLowerCase().includes(ql)); }
        const lastOf = x => x.newestItemPubdate || x.newestItemPublishTime || 0;
        if (p.sort === 'new') feeds.sort((x, y) => lastOf(y) - lastOf(x));
        else if (p.sort === 'eps') feeds.sort((x, y) => (y.episodeCount || 0) - (x.episodeCount || 0));
        else if (p.sort === 'az') feeds.sort((x, y) => (x.title || '').localeCompare(y.title || '', 'fr'));
        const list = feeds.slice(0, 60).map(piMap);
        $('#res').innerHTML = `<p class="count dim">${list.length} résultat${list.length > 1 ? 's' : ''}</p>` + (list.map(f => showItem(f, true)).join('') || '<p class="dim">Aucun résultat avec ces filtres.</p>');
        bind(list); return;
      }
      const r = await (await fetch(`https://itunes.apple.com/search?media=podcast&limit=200&country=fr&term=${encodeURIComponent(q)}`)).json();
      const list = r.results.slice(0, 50).map(x => ({ feedUrl: x.feedUrl || '', title: x.collectionName, image: x.artworkUrl100, author: x.artistName, genre: x.primaryGenreName, count: x.trackCount, last: x.releaseDate }));
      const nofeed = list.filter(f => !f.feedUrl).length;
      $('#res').innerHTML = (nofeed ? `<p class="dim">${nofeed} résultat${nofeed > 1 ? 's' : ''} sans flux public dans l'annuaire Apple (grisé${nofeed > 1 ? 's' : ''}) : impossible de les lire ici.</p>` : '') + (list.map(f => showItem(f, !!f.feedUrl)).join('') || '<p class="dim">Aucun résultat.</p>');
      bind(list);
    } catch (err) { $('#res').innerHTML = `<p class="dim">Erreur : ${esc(err.message)}</p>`; }
  };
  const savePrefs = patch => { try { localStorage.setItem('pi.prefs', JSON.stringify({ ...piPrefs(), ...patch })); } catch {} };
  const refresh = () => { renderSearch(); };
  const bindSeg = (id, fn) => { const el = $('#' + id); if (el) el.onclick = e => { const b = e.target.closest('button[data-v]'); if (b) fn(b.dataset.v); }; };
  bindSeg('srcseg', v => {
    if (v === 'pi' && !piReady()) { alert('Saisis ta clé et ton secret Podcast Index dans Réglages.'); return; }
    searchSrc = v; try { localStorage.setItem('src', v); } catch {}
    refresh();
  });
  $('#sf').onsubmit = e => { e.preventDefault(); run(); };
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
  if (searchQ || (pi && (searchProd || ['trending', 'recent', 'new'].includes(p.mode)))) run();
}
async function openFeed(f, back) {
  setTitle(f.title, back || (() => render()));
  view.innerHTML = '<p class="dim">Chargement…</p>';
  try {
    const feed = feedCache.get(f.feedUrl) || await loadFeed(f.feedUrl);
    const isFav = () => Sync.favs().some(x => x.feedUrl === feed.feedUrl);
    view.innerHTML = `<div class="hero"><img src="${esc(feed.image)}" alt=""><div><b>${esc(feed.title)}</b><small>${esc(feed.author)}</small><small class="m">${esc(meta(feed))}</small></div></div>
      <p class="d full">${esc(feed.desc)}</p><div class="skip"><label for="skipin">Sauter les premières secondes</label><input id="skipin" type="number" inputmode="numeric" min="0" step="1" placeholder="0" value="${skipFor(feed.feedUrl) || ''}"></div><p><button id="fav" class="favpill${isFav() ? ' on' : ''}">${IC.star}<span>${isFav() ? 'Dans les favoris' : 'Ajouter aux favoris'}</span></button></p>` +
      `<div class="filters"><select id="ord"><option value="desc">Récents d'abord</option><option value="asc">Anciens d'abord</option></select>
        <select id="mind"><option value="0">Toutes durées</option>${[10, 20, 30, 45, 60, 90, 120].map(m => `<option value="${m}">≥ ${m} min</option>`).join('')}</select><button id="chain" type="button"></button></div><div id="eps"></div>`;
    const showChain = () => { $('#chain').textContent = chain ? '↻ Enchaîner : oui' : '↻ Enchaîner : non'; $('#chain').style.color = chain ? 'var(--acc)' : ''; };
    $('#chain').onclick = () => { chain = !chain; try { localStorage.setItem('chain', chain ? '1' : '0'); } catch {} showChain(); };
    showChain();
    const allPrefs = () => { try { return JSON.parse(localStorage.getItem('epprefs.v2')) || {}; } catch { return {}; } };
    const prefs = () => ({ order: 'desc', min: 0, ...allPrefs()[feed.feedUrl] }); // réglages propres à ce podcast
    const p0 = prefs(); $('#ord').value = p0.order; $('#mind').value = String(p0.min);
    const drawEps = () => {
      const p = { order: $('#ord').value, min: +$('#mind').value };
      try { const m = allPrefs(); m[feed.feedUrl] = p; localStorage.setItem('epprefs.v2', JSON.stringify(m)); } catch {}
      let list = feed.episodes.map((e, i) => ({ e, i, t: Date.parse(e.date) || 0 }));
      if (p.min) list = list.filter(x => !durSec(x.e.dur) || durSec(x.e.dur) >= p.min * 60); // durée inconnue : conservé
      list.sort((x, y) => p.order === 'asc' ? x.t - y.t || y.i - x.i : y.t - x.t || x.i - y.i);
      curList = list.slice(0, 150).map(x => x.e);
      $('#eps').innerHTML = (list.slice(0, 150).map(({ e, i }) => `<div class="item ep" data-i="${i}"><div class="t"><b>${esc(e.title)}</b><small class="m">${esc([fmtDate(e.date), fmtDur(e.dur)].filter(Boolean).join(' · '))}</small>${e.desc ? `<p class="d">${esc(e.desc)}</p>` : ''}</div><button class="ibtn" data-more aria-label="Détails">${IC.chev}</button><button class="ibtn playb" aria-label="Lire">${IC.play}</button></div>`).join('')) || '<p class="dim">Aucun épisode ne correspond au filtre.</p>';
    };
    $('#ord').onchange = $('#mind').onchange = drawEps; drawEps();
    $('#skipin').oninput = e => {
      const m = skipMap(), v = Math.max(0, Math.floor(+e.target.value) || 0);
      if (v) m[feed.feedUrl] = v; else delete m[feed.feedUrl];
      try { localStorage.setItem('skip.v1', JSON.stringify(m)); } catch {}
    };
    $('#fav').onclick = () => { toggleFav(feed); $('#fav').classList.toggle('on', isFav()); $('#fav span').textContent = isFav() ? 'Dans les favoris' : 'Ajouter aux favoris'; };
    $('#eps').onclick = ev => {
      const el = ev.target.closest('.ep'); if (!el) return;
      if (ev.target.closest('[data-more]')) { el.classList.toggle('open'); return; }
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
function renderSettings() {
  const c = Sync.cfg();
  view.innerHTML = `<label>Ajouter un flux RSS</label><form id="af" class="row"><input id="rss" placeholder="https://…/feed.xml"><button>Ajouter</button></form><p id="am" class="dim"></p>
  <label>Sauvegarde des favoris</label><div id="bk"></div><p id="cm" class="dim"></p>
  <label>Podcast Index (annuaire)</label><input id="pk" value="${esc(piCfg().key || '')}" placeholder="Clé (API Key)" autocomplete="off" autocapitalize="off" spellcheck="false"><input id="ps" type="password" value="${esc(piCfg().secret || '')}" placeholder="Secret" autocomplete="off"><p><button id="pisave">Enregistrer</button></p><p id="pim" class="dim"></p>
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
  $('#pisave').onclick = async () => {
    const c = { key: $('#pk').value.trim(), secret: $('#ps').value.trim() };
    localStorage.setItem('pi.cfg', JSON.stringify(c));
    if (!c.key || !c.secret) { $('#pim').textContent = 'Clé et secret requis.'; return; }
    $('#pim').textContent = 'Test…';
    try { const n = (await piSearch('france inter')).length; $('#pim').textContent = `OK : ${n} résultats de test.`; searchSrc = 'pi'; localStorage.setItem('src', 'pi'); }
    catch (e) { $('#pim').textContent = 'Échec : ' + e.message; }
  };
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
const corsBad = new Set(), hostOf = u => { try { return new URL(u).host; } catch { return u; } };
const note = t => { $('#np-show').textContent = t || curShow; };
let curShow = '';
function play(ep, show, art, feedUrl) {
  curShow = show;
  syncNav();
  audio.crossOrigin = ((nightOn || vizReal) && !corsBad.has(hostOf(ep.url))) ? 'anonymous' : null;
  audio.src = ep.url; note('');
  audio.play().catch(e => { if (e && e.name === 'NotAllowedError') note('Lecture bloquée : touche ▶.'); });
  const skip = skipFor(feedUrl); // intro à sauter : réglage fixe par podcast, pas une progression de lecture
  if (skip > 0) audio.addEventListener('canplay', () => { if (audio.duration > skip) audio.currentTime = skip; }, { once: true });
  const cover = (ep.image || art || '').replace(/\d+x\d+bb/, '600x600bb');
  $('#np-art').src = cover; $('#np-art').style.visibility = cover ? 'visible' : 'hidden';
  $('#player').hidden = false; $('#np-title').textContent = ep.title; $('#np-show').textContent = show;
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: ep.title, artist: show, artwork: cover ? [{ src: cover, sizes: '512x512' }] : [] });
  }
}
const setPlaying = on => $('#player').classList.toggle('playing', on);
['playing', 'play'].forEach(ev => audio.addEventListener(ev, () => setPlaying(true)));
['pause', 'ended', 'emptied', 'error'].forEach(ev => audio.addEventListener(ev, () => setPlaying(false)));
audio.addEventListener('play', () => { $('#pp').innerHTML = IC.pause; navigator.mediaSession && (navigator.mediaSession.playbackState = 'playing'); });
audio.addEventListener('pause', () => { $('#pp').innerHTML = IC.playBig; navigator.mediaSession && (navigator.mediaSession.playbackState = 'paused'); });
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
['loadstart', 'emptied'].forEach(ev => audio.addEventListener(ev, resetSeek));
['loadedmetadata', 'durationchange', 'timeupdate', 'seeked', 'ended'].forEach(ev => audio.addEventListener(ev, syncSeek));
audio.addEventListener('timeupdate', checkSleep);
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
  $('#sleep').innerHTML = labeled(IC.timer, min ? `${min} min` : 'Minuteur'); $('#sleep').classList.toggle('on', !!min);
  if (min) sleepT = setTimeout(checkSleep, min * 60000 + 100);
}
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
let nightOn = localStorage.getItem('night') === '1', vizReal = localStorage.getItem('vizreal') === '1', ctx = null, comp = null, makeup = null, analyser = null;
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
  const src = ctx.createMediaElementSource(audio);
  comp = ctx.createDynamicsCompressor(); makeup = ctx.createGain(); analyser = ctx.createAnalyser();
  analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.75;
  src.connect(comp); comp.connect(makeup); makeup.connect(analyser); analyser.connect(ctx.destination);
}
function reloadCurrent(play) {
  if (!audio.src) return;
  const t = audio.currentTime, u = audio.src;
  audio.src = u; audio.load();
  audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = t; } catch {} if (play) audio.play().catch(() => {}); }, { once: true });
}
function graphFailed() {
  // Le fichier n'a pas pu être chargé avec CORS : on mémorise l'hébergeur et on relit sans traitement, sans interrompre l'écoute.
  corsBad.add(hostOf(audio.src));
  if (!ctx) { audio.crossOrigin = null; note('Traitement audio indisponible pour ce podcast (mode nuit / barres réelles ignorés).'); reloadCurrent(true); return; }
  alert("Ce podcast n'autorise pas le traitement audio. Il sera relu sans (la page se recharge).");
  location.reload();
}
// Branche le traitement audio : recharge le fichier avec CORS, puis branche seulement si le chargement réussit.
function activateGraph() {
  if (ctx) { ctx.resume(); nightParams(); return; }
  if (!audio.src) return;
  const wasPlaying = !audio.paused;
  audio.crossOrigin = 'anonymous';
  audio.addEventListener('canplay', () => { buildGraph(); ctx.resume(); nightParams(); }, { once: true });
  reloadCurrent(wasPlaying);
}
nightBtn.onclick = () => {
  nightOn = !nightOn; localStorage.setItem('night', nightOn ? '1' : '0'); showNight();
  if (!nightOn) { nightParams(); return; }
  activateGraph();
};
const vizBtn = $('#vizreal');
function vizNote() {
  const n = $('#viz-note'); if (!n) return;
  const bad = audio.src && corsBad.has(hostOf(audio.src));
  n.textContent = !vizReal ? "Visualiseur : animation simple. Touche « Visualiseur » pour suivre le vrai son."
    : bad ? "Ce podcast n'autorise pas l'analyse du son : animation simple."
    : (analyser && ctx && ctx.state === 'running') ? 'Visualiseur synchronisé sur le son du podcast.' : (audio.src ? 'Activation du visualiseur…' : 'Lance un épisode pour voir le visualiseur.');
}
setInterval(vizNote, 700);
const showViz = () => { vizNote(); vizBtn.innerHTML = labeled(IC.eq, 'Visualiseur'); vizBtn.classList.toggle('on', vizReal); vizBtn.setAttribute('aria-pressed', vizReal); };
vizBtn.onclick = () => { vizReal = !vizReal; localStorage.setItem('vizreal', vizReal ? '1' : '0'); showViz(); if (vizReal) activateGraph(); };
audio.addEventListener('error', () => {
  if (!audio.src) return;
  if ((nightOn || vizReal) && audio.crossOrigin && !corsBad.has(hostOf(audio.src))) { graphFailed(); return; }
  const c = audio.error ? audio.error.code : 0;
  note('Erreur de lecture' + (c ? ' (code ' + c + ')' : '') + ' : ' + ({ 2: 'réseau', 3: 'décodage', 4: 'fichier non lisible' }[c] || 'inconnue') + '. Touche ▶ pour réessayer.');
});
audio.addEventListener('canplay', () => { if ((nightOn || vizReal) && !ctx && audio.crossOrigin) { buildGraph(); ctx.resume(); nightParams(); } else if (ctx) ctx.resume(); });
showNight(); showViz();

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
    const real = vizReal && !!analyser && ctx && ctx.state === 'running' && playing;
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
    const live = vizReal && !!analyser && !!ctx && ctx.state === 'running' && !audio.paused && !pl.classList.contains('full');
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
