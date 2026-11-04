# Podcasts pour dormir (PWA)

PWA statique : favoris RSS, recherche iTunes, minuterie d'arrêt optionnelle, lecture écran verrouillé (Media Session). La progression de lecture n'est jamais mémorisée.

- Déploiement : GitHub Pages (`.github/workflows/pages.yml`). Activer Settings → Pages → Source : GitHub Actions.
- `worker/worker.js` : exemple de worker Cloudflare (proxy CORS `/proxy?url=` + KV `/kv/<clé>`), à adapter au worker existant.
- À chaque ouverture : vérification du service worker et rafraîchissement des flux favoris.
