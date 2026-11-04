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
async function shareFeed(feed) {
  const url = shareUrl(feed), text = `Écoute « ${feed.title} » : ${url}`;
  const m = modal(`<h3>Partager</h3><p class="dim sm">${esc(feed.title)}</p><div id="qrbox" class="qrbox">…</div><p class="dim sm">Fais scanner ce code dans l'app (Recherche → Scanner) ou avec l'appareil photo.</p>
    <div class="shbtns">${navigator.share ? '<button id="shnat" class="favpill">Partager…</button>' : ''}<a class="favpill" id="shwa" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">WhatsApp</a><a class="favpill" id="shsms" href="sms:?&body=${encodeURIComponent(text)}">SMS</a><button id="shcp" class="favpill">Copier le lien</button></div><button data-close class="ghost">Fermer</button>`);
  const nat = m.querySelector('#shnat'); if (nat) nat.onclick = () => navigator.share({ title: feed.title, text: `Écoute « ${feed.title} »`, url }).catch(() => {});
  m.querySelector('#shcp').onclick = async e => { try { await navigator.clipboard.writeText(url); e.target.textContent = 'Lien copié ✓'; } catch { prompt('Copie ce lien :', url); } };
  try { await shareLoad('vendor/qrcode.js'); const q = qrcode(0, 'L'); q.addData(url); q.make(); m.querySelector('#qrbox').innerHTML = q.createSvgTag({ cellSize: 4, margin: 3, scalable: true }); }
  catch { m.querySelector('#qrbox').textContent = 'QR code indisponible.'; }
}
// Extrait l'adresse du flux d'un lien de partage ou d'une adresse RSS brute.
function feedFromText(t) {
  t = String(t || '').trim();
  try { const u = new URL(t), a = u.searchParams.get('add'); if (a) return { feedUrl: a, title: u.searchParams.get('n') || '' }; if (/^https?:$/.test(u.protocol)) return { feedUrl: t, title: '' }; } catch {}
  return null;
}
function openShared(f) { // tab « shared » : la mise à jour des favoris au démarrage ne remplace pas cette page
  const prev = tab === 'shared' ? 'favs' : tab; tab = 'shared';
  openFeed(f, () => { tab = prev; render(); });
}
async function scanQR() {
  const m = modal(`<h3>Scanner un QR code</h3><video id="scv" playsinline muted></video><p id="scm" class="dim sm">Vise le QR code d'un podcast partagé.</p><button data-close class="ghost">Annuler</button>`);
  const v = m.querySelector('#scv'), msg = t => { m.querySelector('#scm').textContent = t; }; let stream, stop = false;
  m.onclose = () => { stop = true; if (stream) stream.getTracks().forEach(t => t.stop()); };
  try {
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
  } catch (e) { msg(e && e.name === 'NotAllowedError' ? 'Accès à la caméra refusé : autorise-la dans les réglages du navigateur.' : 'Caméra indisponible : scanne plutôt le QR code avec l\'appareil photo du téléphone.'); }
}
// Lien de partage ouvert : on affiche le podcast, prêt à être ajouté aux favoris.
// Mémorisé quelques secondes pour survivre à un rechargement dû à une mise à jour de l'app.
(() => {
  const q = new URLSearchParams(location.search);
  let f = q.get('add') ? { feedUrl: q.get('add'), title: q.get('n') || '' } : null;
  try { if (f) sessionStorage.setItem('share.pending', JSON.stringify({ f, at: Date.now() })); else { const p = JSON.parse(sessionStorage.getItem('share.pending')); if (p && Date.now() - p.at < 15000) f = p.f; } } catch {}
  if (!f) return;
  if (q.get('add')) history.replaceState(null, '', location.pathname);
  openShared(f); setTimeout(() => { try { sessionStorage.removeItem('share.pending'); } catch {} }, 6000);
})();
