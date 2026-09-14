import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/tokens.css';
import './styles/app.css';
import { api } from './api/client';
import { startAutoSync } from './offline/syncService';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Service worker : rend l'app consultable même sans réseau (app shell).
// N'a aucun rapport avec les données métier — voir syncService.js pour ça.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('Échec de l\'enregistrement du service worker', err);
    });
  });
}

// Démarre la resynchronisation automatique des ventes créées hors-ligne
// (écoute l'événement 'online' + tentative périodique de secours).
startAutoSync(api);
