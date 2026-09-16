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

const CACHE_NAME = 'amaterasu-shell-v1';
const APP_SHELL_URL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(APP_SHELL_URL))
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

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // On ne touche jamais aux appels API (/products, /orders, etc.) : ils
  // doivent échouer normalement si le réseau est coupé, pour que
  // useOfflineSync.js puisse détecter l'erreur et basculer en local.
  const url = new URL(request.url);
  const estAppelApi = url.origin !== self.location.origin;
  if (estAppelApi) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(APP_SHELL_URL))
    );
    return;
  }

  if (request.method === 'GET') {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        });
      })
    );
  }
});

// --- Notifications push (système d'alertes manager) ---
// Sans rapport avec l'app shell / le cache ci-dessus : gère uniquement
// l'affichage des notifications reçues du serveur via l'API Push.

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
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
