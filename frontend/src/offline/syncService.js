// syncService.js — détecte le retour du réseau et synchronise les ventes
// créées hors-ligne, dans l'ordre où elles ont été passées. Diffuse des
// événements DOM pour que l'UI (OfflineBanner, etc.) réagisse sans avoir
// besoin d'un store global.
//
// Événements diffusés sur `window` :
//   'amaterasu:sync-start'   — la synchro démarre
//   'amaterasu:sync-progress' { detail: { localId, status } }
//   'amaterasu:sync-done'    { detail: { synced: number, failed: number } }

import {
  getPendingOrders, updatePendingOrder, removePendingOrder,
  getPendingPayments, updatePendingPayment, removePendingPayment,
} from './db';

let syncing = false;

function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

// api doit exposer createOrder(data) — on réutilise api.createOrder de client.js,
// injecté ici plutôt qu'importé directement pour éviter toute dépendance circulaire.
export async function syncPendingOrders(api) {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  emit('amaterasu:sync-start');

  let synced = 0;
  let failed = 0;

  try {
    const pending = await getPendingOrders();
    // On traite dans l'ordre de création (createdAt croissant, déjà garanti par getPendingOrders)
    // pour préserver la séquence des ventes de la journée.
    for (const order of pending) {
      if (order.status === 'syncing') continue; // déjà en cours (appel concurrent)

      await updatePendingOrder(order.localId, { status: 'syncing' });
      emit('amaterasu:sync-progress', { localId: order.localId, status: 'syncing' });

      try {
        // clientOrderId : clé d'idempotence envoyée au serveur, pour que deux
        // tentatives de synchro de la même vente (ex : coupure pendant l'envoi)
        // ne créent pas deux commandes. Nécessite le support côté backend
        // (voir migration_013 + orders.routes.js).
        await api.createOrder({ ...order.payload, clientOrderId: order.localId });
        await removePendingOrder(order.localId);
        synced += 1;
        emit('amaterasu:sync-progress', { localId: order.localId, status: 'synced' });
      } catch (err) {
        failed += 1;
        await updatePendingOrder(order.localId, { status: 'sync_failed', error: err.message });
        emit('amaterasu:sync-progress', { localId: order.localId, status: 'sync_failed', error: err.message });
        // On continue avec les suivantes plutôt que d'interrompre toute la synchro
        // pour une seule vente en échec (ex : conflit de stock à régulariser).
      }
    }

    // Encaissements en attente (PATCH /orders/:id/payment) — la commande
    // existe déjà côté serveur, pas besoin de clé d'idempotence : si le
    // paiement a déjà été enregistré (coupure juste avant la réponse), le
    // serveur répondra "Cette commande a déjà été traitée." et on retire
    // simplement l'entrée locale plutôt que de la marquer en échec.
    const pendingPayments = await getPendingPayments();
    for (const payment of pendingPayments) {
      if (payment.status === 'syncing') continue;

      await updatePendingPayment(payment.localId, { status: 'syncing' });
      emit('amaterasu:sync-progress', { localId: payment.localId, status: 'syncing' });

      try {
        await api.recordOrderPayment(payment.orderId, payment.payload);
        await removePendingPayment(payment.localId);
        synced += 1;
        emit('amaterasu:sync-progress', { localId: payment.localId, status: 'synced' });
      } catch (err) {
        if (err.message?.includes('déjà été traitée')) {
          await removePendingPayment(payment.localId);
          synced += 1;
        } else {
          failed += 1;
          await updatePendingPayment(payment.localId, { status: 'sync_failed', error: err.message });
          emit('amaterasu:sync-progress', { localId: payment.localId, status: 'sync_failed', error: err.message });
        }
      }
    }
  } finally {
    syncing = false;
    emit('amaterasu:sync-done', { synced, failed });
  }
}

// À appeler une fois au démarrage de l'app (ex : dans main.jsx ou App.jsx).
export function startAutoSync(api) {
  window.addEventListener('online', () => syncPendingOrders(api));
  // Filet de sécurité : si l'événement 'online' du navigateur ne se déclenche
  // pas de façon fiable (arrive sur certains réseaux mobiles), on retente
  // périodiquement tant qu'il reste des ventes en attente.
  setInterval(() => {
    if (navigator.onLine) syncPendingOrders(api);
  }, 30000);

  // Tentative immédiate au chargement, au cas où des ventes seraient restées
  // en attente d'une session précédente.
  if (navigator.onLine) syncPendingOrders(api);
}
