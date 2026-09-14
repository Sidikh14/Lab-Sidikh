// useOfflineSync.js — hook React qui expose l'état réseau, la file de ventes
// en attente, et une fonction pour créer une vente en mode hors-ligne.
import { useCallback, useEffect, useState } from 'react';
import {
  addPendingOrder,
  getPendingOrders,
  getCachedProducts,
  decrementCachedStock,
  addPendingPayment,
  getPendingPayments,
} from './db';
import { syncPendingOrders } from './syncService';

export function useOfflineSync(api) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [pendingPayments, setPendingPayments] = useState([]);
  const [syncing, setSyncing] = useState(false);

  const refreshPending = useCallback(async () => {
    setPendingOrders(await getPendingOrders());
    setPendingPayments(await getPendingPayments());
  }, []);

  useEffect(() => {
    refreshPending();

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleSyncStart = () => setSyncing(true);
    const handleSyncProgress = () => refreshPending();
    const handleSyncDone = () => {
      setSyncing(false);
      refreshPending();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('amaterasu:sync-start', handleSyncStart);
    window.addEventListener('amaterasu:sync-progress', handleSyncProgress);
    window.addEventListener('amaterasu:sync-done', handleSyncDone);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('amaterasu:sync-start', handleSyncStart);
      window.removeEventListener('amaterasu:sync-progress', handleSyncProgress);
      window.removeEventListener('amaterasu:sync-done', handleSyncDone);
    };
  }, [refreshPending]);

  // À appeler à la place de api.createOrder() dans la page de vente. Décide
  // elle-même si on est en ligne (envoi direct) ou hors-ligne (mise en file).
  const createOrder = useCallback(
    async (orderData) => {
      if (navigator.onLine) {
        try {
          return await api.createOrder(orderData);
        } catch (err) {
          // Une erreur réseau peut survenir même si navigator.onLine dit "true"
          // (ex : coupure au moment précis de l'envoi) — on bascule en local.
          if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
            return queueOrderLocally(orderData);
          }
          throw err; // erreur métier (ex : stock insuffisant côté serveur) : on la remonte telle quelle
        }
      }
      return queueOrderLocally(orderData);
    },
    [api]
  );

  async function queueOrderLocally(orderData) {
    // Vérification du stock EN CACHE avant de mettre en file — bloque la vente
    // si le stock local connu est à 0, comme décidé pour la V1.
    const produitsEnCache = await getCachedProducts();
    for (const item of orderData.items || []) {
      const produit = produitsEnCache.find((p) => p.id === item.productId);
      if (produit && Number(produit.stock_quantity) < item.quantity) {
        throw new Error(
          `Stock insuffisant pour "${produit.name}" (${produit.stock_quantity} restant en cache local). Vente refusée hors-ligne.`
        );
      }
    }

    const record = await addPendingOrder(orderData);
    for (const item of orderData.items || []) {
      await decrementCachedStock(item.productId, item.quantity);
    }
    await refreshPending();
    return { offline: true, localId: record.localId };
  }

  const syncNow = useCallback(() => syncPendingOrders(api), [api]);

  // À appeler à la place de api.recordOrderPayment() dans ModaleEncaissement.
  // La commande existe déjà côté serveur (vue via GET /orders en ligne) :
  // pas besoin d'idempotence par UUID ici, juste une file d'attente.
  const recordPayment = useCallback(
    async (orderId, payload) => {
      if (navigator.onLine) {
        try {
          return await api.recordOrderPayment(orderId, payload);
        } catch (err) {
          if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
            const record = await addPendingPayment(orderId, payload);
            await refreshPending();
            return { offline: true, localId: record.localId };
          }
          throw err; // erreur métier (ex : montant reçu insuffisant) : à corriger tout de suite, pas à mettre en file
        }
      }
      const record = await addPendingPayment(orderId, payload);
      await refreshPending();
      return { offline: true, localId: record.localId };
    },
    [api, refreshPending]
  );

  return {
    isOnline,
    pendingOrders,
    pendingPayments,
    pendingCount: pendingOrders.filter((o) => o.status !== 'sync_failed').length
      + pendingPayments.filter((p) => p.status !== 'sync_failed').length,
    failedCount: pendingOrders.filter((o) => o.status === 'sync_failed').length
      + pendingPayments.filter((p) => p.status === 'sync_failed').length,
    syncing,
    createOrder,
    recordPayment,
    syncNow,
  };
}
