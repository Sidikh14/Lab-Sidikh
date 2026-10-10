// sw.js — service worker minimal (PWA "app shell") pour que l'app se
// recharge même sans réseau. Ne gère PAS les données métier (ça, c'est le
// rôle d'IndexedDB via db.js/syncService.js) — juste le HTML/JS/CSS/icônes.
//
// À placer dans le dossier `public/` du projet Vite (donc servi tel quel à
// la racine, ex: https://votre-app.vercel.app/sw.js), puis enregistré
// depuis main.jsx (voir extrait fourni séparément).
//
// Stratégie volontairement simple, adaptée à un build Vite (noms de
// fichiers hashés à chaque build) :
//   - navigation (chargement de la page) : network-first, avec repli sur
//     la page d'accueil mise en cache si hors-ligne
//   - assets statiques (JS/CSS/images) : cache-first, alimenté au fur et
//     à mesure des requêtes (runtime caching), jamais de liste figée à
//     maintenir manuellement
//
// Règle d'or de ce fichier : event.respondWith() reçoit TOUJOURS une
// Response, même quand le réseau échoue. Une promesse rejetée donne
// « The FetchEvent ... resulted in a network error response » et
// « Uncaught (in promise) TypeError: Failed to fetch » dans la console.

// Changer ce numéro purge les anciens caches (activate ci-dessous).
const CACHE_NAME = 'amaterasu-shell-v2';
const APP_SHELL_URL = '/';
const DESTINATIONS_MISES_EN_CACHE = ['script', 'style', 'image', 'font', 'manifest', 'worker'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.add(APP_SHELL_URL))
      // Un échec réseau à l'installation ne doit pas empêcher le service worker de démarrer :
      // le shell sera mis en cache à la première navigation réussie.
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

const PAGE_HORS_LIGNE = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Hors connexion</title></head>
<body style="font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f4f6fa;color:#0f2747">
<div style="text-align:center;padding:24px"><h1 style="font-size:22px;margin:0 0 8px">Vous êtes hors connexion</h1>
<p style="margin:0 0 16px;color:#5a6678">Impossible de charger cette page pour le moment.</p>
<button onclick="location.reload()" style="font:inherit;padding:10px 18px;border:0;border-radius:9px;background:#1f5fbf;color:#fff;cursor:pointer">Réessayer</button></div>
</body></html>`;

// Page (navigation) : réseau d'abord ; si le réseau échoue, on sert le shell en cache.
async function reponsePage(request) {
  try {
    const reponse = await fetch(request);
    const type = reponse.headers.get('content-type') || '';
    if (reponse.ok && type.includes('text/html')) {
      // Garde le shell à jour (appli monopage : toutes les routes renvoient le même index.html).
      const copie = reponse.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(APP_SHELL_URL, copie)).catch(() => {});
    }
    return reponse;
  } catch (err) {
    const shell = await caches.match(APP_SHELL_URL);
    if (shell) return shell;
    return new Response(PAGE_HORS_LIGNE, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

// Fichier statique : cache d'abord ; sinon réseau, puis mise en cache si c'est bien un fichier valide.
async function reponseAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const enCache = await cache.match(request);
  if (enCache) return enCache;
  try {
    const reponse = await fetch(request);
    const type = reponse.headers.get('content-type') || '';
    // On ne met jamais en cache une erreur (404, 500) ni une page HTML renvoyée à la place d'un fichier
    // (cas d'un ancien fichier hashé supprimé après un déploiement).
    if (
      reponse.ok &&
      reponse.type === 'basic' &&
      DESTINATIONS_MISES_EN_CACHE.includes(request.destination) &&
      !type.includes('text/html')
    ) {
      cache.put(request, reponse.clone()).catch(() => {});
    }
    return reponse;
  } catch (err) {
    return new Response('', { status: 504, statusText: 'Hors connexion' });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Seules les lectures sont gérées ici.
  if (request.method !== 'GET') return;

  // On ne touche jamais aux appels API (/products, /orders, etc.) : ils
  // doivent échouer normalement si le réseau est coupé, pour que
  // useOfflineSync.js puisse détecter l'erreur et basculer en local.
  const url = new URL(request.url);
  const estAppelApi = url.origin !== self.location.origin;
  if (estAppelApi) return;

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(reponsePage(request));
    return;
  }

  event.respondWith(reponseAsset(request));
});

// --- Notifications push (système d'alertes manager) ---
// Sans rapport avec l'app shell / le cache ci-dessus : gère uniquement
// l'affichage des notifications reçues du serveur via l'API Push.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    // Message push qui n'est pas du JSON : on l'affiche tel quel.
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Amaterasu', {
      body: data.body || '',
      icon: '/icon-192.png', // [À CONFIRMER] chemin réel de l'icône si elle existe
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
