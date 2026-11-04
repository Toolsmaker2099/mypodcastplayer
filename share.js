// Partage d'un podcast : lien + QR code (lisible par l'app ou par l'appareil photo), SMS, WhatsApp, feuille de partage du système.
// Le lien ne contient que l'adresse du flux RSS : aucun réglage ni progression n'est partagé.
const shareLoad = src => new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => ko(new Error('Chargement impossible')); document.head.appendChild(s); });
const shareUrl = feed => location.origin + location.pathname.replace(/index\.html$/, '') + '?add=' + encodeURIComponent(feed.feedUrl) + '&n=' + encodeURIComponent((feed.title || '').slice(0, 60));
function modal(html) {
  const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="sheet">${html}</div>`;
  const close = () => { m.remove(); if (m.onclose) m.onclose(); };
  m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) close(); });
  document.body.appendChild(m); m.close = close; return m;
}
// Si le proxy RSS (worker) est configuré, le lien envoyé passe par lui : WhatsApp/Instagram affichent alors le titre et la pochette du podcast.
const cardUrl = feed => { const p = Sync.proxy(); return p ? p + '/p?add=' + encodeURIComponent(feed.feedUrl) + '&n=' + encodeURIComponent((feed.title || '').slice(0, 60)) + '&to=' + encodeURIComponent(shareUrl(feed)) : shareUrl(feed); };
// Feuille de partage commune (podcasts, listes, playlists) : QR code, WhatsApp, SMS, partage du système, copie du lien.
async function shareSheet(o) {
  const m = modal(`<h3>Partager</h3><p class="dim sm">${esc(o.sub)}</p><div id="qrbox" class="qrbox">…</div><p class="dim sm">Fais scanner ce code dans l'app (Ajouter → Scanner) ou avec l'appareil photo.</p>
    <div class="shbtns">${navigator.share ? '<button id="shnat" class="favpill">Partager…</button>' : ''}<a class="favpill" id="shwa" href="https://wa.me/?text=${encodeURIComponent(o.text)}" target="_blank" rel="noopener">WhatsApp</a><a class="favpill" id="shsms" href="sms:?&body=${encodeURIComponent(o.text)}">SMS</a><button id="shcp" class="favpill">Copier le lien</button></div><button data-close class="ghost">Fermer</button>`);
  const nat = m.querySelector('#shnat'); if (nat) nat.onclick = () => navigator.share({ title: o.sub, text: o.nativeText, url: o.link }).catch(() => {});
  m.querySelector('#shcp').onclick = async e => { try { await navigator.clipboard.writeText(o.link); e.target.textContent = 'Lien copié ✓'; } catch { prompt('Copie ce lien :', o.link); } };
  try { await shareLoad('vendor/qrcode.js'); const q = qrcode(0, 'L'); q.addData(o.url); q.make(); m.querySelector('#qrbox').innerHTML = q.createSvgTag({ cellSize: 4, margin: 3, scalable: true }); }
  catch { m.querySelector('#qrbox').textContent = 'QR code indisponible.'; }
}
async function shareFeed(feed) {
  const url = shareUrl(feed), link = cardUrl(feed);
  shareSheet({ sub: feed.title, url, link, text: `Écoute « ${feed.title} » : ${link}`, nativeText: `Écoute « ${feed.title} »` });
}
// Liste de podcasts ou playlist d'épisodes : enregistrée sur le serveur de sauvegarde sous un code court (lien et QR code restent petits).
async function shareCollection(kind, name, data) {
  const isList = kind === 'list', label = isList ? 'Liste' : 'Playlist', n = data.length;
  let code; try { code = await Sync.shareCreate({ kind, name, data }); } catch (e) { alert('Partage impossible : ' + e.message); return; }
  const title = `${label} « ${name} »`, desc = `${n} ${isList ? 'podcast' : 'épisode'}${n > 1 ? 's' : ''} à découvrir dans l'app Podcasts.`;
  const base = location.origin + location.pathname.replace(/index\.html$/, ''), url = `${base}?share=${code}&n=${encodeURIComponent(title)}`, p = Sync.proxy();
  const link = p ? `${p}/p?share=${code}&n=${encodeURIComponent(title)}&d=${encodeURIComponent(desc)}&to=${encodeURIComponent(url)}` : url;
  shareSheet({ sub: `${title} · ${n} ${isList ? 'podcast' : 'épisode'}${n > 1 ? 's' : ''}`, url, link, text: `Écoute ${isList ? 'ma liste' : 'ma playlist'} « ${name} » : ${link}`, nativeText: `${title} sur Podcasts` });
}
// Réception d'une liste ou d'une playlist partagée.
async function importShared(code) {
  const m = modal('<h3>Partage reçu</h3><p class="dim" id="im-msg">Chargement…</p><div class="lbody" id="im-body"></div><div class="shbtns" id="im-act"></div><button data-close class="ghost">Fermer</button>');
  const msg = t => { m.querySelector('#im-msg').textContent = t; };
  let sh; try { sh = await Sync.shareGet(code); } catch { msg('Impossible de charger ce partage (réseau).'); return; }
  if (!sh || !Array.isArray(sh.data)) { msg('Ce partage est introuvable ou a expiré.'); return; }
  const isList = sh.kind === 'list', n = sh.data.length;
  msg(`${isList ? 'Liste' : 'Playlist'} « ${sh.name} » : ${n} ${isList ? 'podcast' : 'épisode'}${n > 1 ? 's' : ''}.`);
  m.querySelector('#im-body').innerHTML = sh.data.slice(0, 12).map(x => `<div class="lrow" style="cursor:default"><span>${esc(x.title)}</span></div>`).join('') + (n > 12 ? `<p class="dim sm">… et ${n - 12} autres</p>` : '');
  m.querySelector('#im-act').innerHTML = `<button class="abtn" id="im-add">${isList ? 'Ajouter à mes listes' : 'Ajouter à mes playlists'}</button>`;
  m.querySelector('#im-add').onclick = () => {
    const name = sh.name; let isPl = false;
    if (isList) {
      const d = listsData(), id = newId(); d.lists.push({ id, name });
      sh.data.forEach(f => { if (!f.feedUrl) return; d.members[f.feedUrl] = [...new Set([...(d.members[f.feedUrl] || []), id])]; d.pods[f.feedUrl] = d.pods[f.feedUrl] || f; });
      saveLists(d); localStorage.setItem('favlist', id); localStorage.setItem('favtab', 'pod');
    } else {
      const l = plData(); l.push({ id: newId(), name, items: sh.data.filter(x => x.url) }); savePl(l); localStorage.setItem('favtab', 'pl'); isPl = true;
    }
    m.close(); tab = isPl ? 'listen' : 'favs'; render(); toast(`« ${name} » ajoutée`);
  };
}
// Extrait l'adresse du flux d'un lien de partage ou d'une adresse RSS brute.
function feedFromText(t) {
  t = String(t || '').trim();
  try { const u = new URL(t), a = u.searchParams.get('add'), sc = u.searchParams.get('share'); if (sc) return { share: sc }; if (a) return { feedUrl: a, title: u.searchParams.get('n') || '' }; if (/^https?:$/.test(u.protocol)) return { feedUrl: t, title: '' }; } catch {}
  return null;
}
function openShared(f) {
  if (f.share) { importShared(f.share); return; }
  // tab « shared » : la mise à jour des favoris au démarrage ne remplace pas cette page
  const prev = tab === 'shared' ? 'favs' : tab; tab = 'shared';
  openFeed(f, () => { tab = prev; render(); });
}
async function scanQR() {
  const m = modal(`<h3>Scanner un QR code</h3><video id="scv" playsinline muted></video><p id="scm" class="dim sm">Vise le QR code d'un podcast partagé.</p><label class="ghost" id="scpic">📷 Prendre une photo du QR code<input type="file" id="scfile" accept="image/*" capture="environment" hidden></label><button data-close class="ghost">Annuler</button>`);
  const v = m.querySelector('#scv'), msg = t => { m.querySelector('#scm').textContent = t; }; let stream, stop = false;
  m.querySelector('#scfile').onchange = async e => { // secours : photo du QR code (aucun accès caméra en direct nécessaire)
    const file = e.target.files[0]; if (!file) return; msg('Lecture…');
    try {
      if (typeof jsQR !== 'function') await shareLoad('vendor/jsQR.js');
      const img = new Image(); img.src = URL.createObjectURL(file); await img.decode();
      const s = Math.min(1, 1200 / Math.max(img.width, img.height)), cv = document.createElement('canvas'); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      const g = cv.getContext('2d'); g.drawImage(img, 0, 0, cv.width, cv.height);
      const r = jsQR(g.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height), f = r && feedFromText(r.data);
      if (f) { m.close(); openShared(f); } else msg('Aucun QR code de podcast trouvé dans cette photo.');
    } catch { msg('Photo illisible.'); }
  };
  m.onclose = () => { stop = true; if (stream) stream.getTracks().forEach(t => t.stop()); };
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nocam');
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    v.srcObject = stream; await v.play();
    let det = null; if ('BarcodeDetector' in window) { try { det = new BarcodeDetector({ formats: ['qr_code'] }); } catch {} }
    if (!det) await shareLoad('vendor/jsQR.js');
    const cv = document.createElement('canvas'), g = cv.getContext('2d', { willReadFrequently: true });
    const tick = async () => {
      if (stop) return;
      try {
        let txt = '';
        if (det) { const r = await det.detect(v); txt = r[0] ? r[0].rawValue : ''; }
        else if (v.videoWidth) { const s = Math.min(1, 640 / v.videoWidth); cv.width = v.videoWidth * s; cv.height = v.videoHeight * s; g.drawImage(v, 0, 0, cv.width, cv.height); const r = jsQR(g.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height); txt = r ? r.data : ''; }
        if (txt) { const f = feedFromText(txt); if (f) { m.close(); openShared(f); return; } msg('Ce QR code n\'est pas un podcast.'); }
      } catch {}
      setTimeout(tick, 200);
    };
    tick();
  } catch (e) { msg(e && e.name === 'NotAllowedError' ? 'Accès à la caméra refusé : autorise-la dans les réglages du navigateur.' : 'Caméra en direct indisponible : prends une photo du QR code avec le bouton ci-dessous.'); }
}
// Lien de partage ouvert : on affiche le podcast, prêt à être ajouté aux favoris.
// Mémorisé quelques secondes pour survivre à un rechargement dû à une mise à jour de l'app.
(() => {
  const q = new URLSearchParams(location.search);
  let f = q.get('add') ? { feedUrl: q.get('add'), title: q.get('n') || '' } : q.get('share') ? { share: q.get('share') } : null;
  try { if (f) sessionStorage.setItem('share.pending', JSON.stringify({ f, at: Date.now() })); else { const p = JSON.parse(sessionStorage.getItem('share.pending')); if (p && Date.now() - p.at < 15000) f = p.f; } } catch {}
  if (!f) return;
  if (q.get('add') || q.get('share')) history.replaceState(null, '', location.pathname);
  openShared(f); setTimeout(() => { try { sessionStorage.removeItem('share.pending'); } catch {} }, 6000);
})();
