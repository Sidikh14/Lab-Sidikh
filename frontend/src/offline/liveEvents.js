// liveEvents.js — une seule connexion SSE (Server-Sent Events) partagée par
// toute l'application, avec un petit pub/sub pour que n'importe quelle page
// s'abonne juste aux événements qui l'intéressent.
//
// Usage dans un composant :
//   useLiveEvent('order:created', () => charger());
//   useLiveEvent('activity:created', () => rafraichirJournal());
import { useEffect, useRef } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

let eventSource = null;
const listeners = new Map(); // eventName -> Set(callback)

function getToken() {
  return localStorage.getItem('token');
}

function ensureConnected() {
  if (eventSource) return;
  const token = getToken();
  if (!token) return;

  eventSource = new EventSource(`${API_URL}/events?token=${encodeURIComponent(token)}`);

  eventSource.onerror = () => {
    // EventSource réessaie de se reconnecter automatiquement (comportement
    // natif du navigateur) — rien à faire de plus ici. Si le token a
    // expiré entre-temps, la reconnexion échouera en boucle ; à surveiller
    // si des sessions très longues posent problème un jour.
  };
}

function subscribe(eventName, callback) {
  ensureConnected();
  if (!eventSource) return () => {}; // pas connecté (pas de token) : no-op

  if (!listeners.has(eventName)) {
    listeners.set(eventName, new Set());
    eventSource.addEventListener(eventName, (e) => {
      const data = e.data ? JSON.parse(e.data) : null;
      listeners.get(eventName).forEach((cb) => cb(data));
    });
  }
  listeners.get(eventName).add(callback);

  return () => listeners.get(eventName)?.delete(callback);
}

// À appeler une fois après la connexion (ex : dans AuthContext après le
// login) pour (re)ouvrir la connexion SSE avec le nouveau token — sinon
// elle ne s'ouvrira qu'à la prochaine fois qu'une page appelle useLiveEvent.
export function resetLiveConnection() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  ensureConnected();
}

export function useLiveEvent(eventName, callback) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    const unsubscribe = subscribe(eventName, (data) => callbackRef.current(data));
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventName]);
}
