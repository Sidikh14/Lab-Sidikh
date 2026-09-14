// db.js — couche d'accès IndexedDB pour le mode hors-ligne (Amaterasu).
// Pas de dépendance externe : utilise l'API IndexedDB native du navigateur.
//
// Object stores :
//   - pendingOrders   : ventes créées hors-ligne, en attente de synchronisation
//   - productsCache   : dernier stock connu de chaque produit (mis à jour en ligne)
//   - clientsCache     : liste des clients, pour pouvoir rattacher une vente à crédit hors-ligne

// db.js — couche d'accès IndexedDB pour le mode hors-ligne (Amaterasu).
// Pas de dépendance externe : utilise l'API IndexedDB native du navigateur.
//
// Object stores :
//   - pendingOrders   : ventes créées hors-ligne, en attente de synchronisation
//   - pendingPayments : encaissements (PATCH /orders/:id/payment) faits hors-ligne
//                       sur une commande qui existe déjà côté serveur
//   - productsCache   : dernier stock connu de chaque produit (mis à jour en ligne)
//   - clientsCache     : liste des clients, pour pouvoir rattacher une vente à crédit hors-ligne

const DB_NAME = 'amaterasu-offline';
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains('pendingOrders')) {
        const store = db.createObjectStore('pendingOrders', { keyPath: 'localId' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('status', 'status');
      }
      if (!db.objectStoreNames.contains('pendingPayments')) {
        const store = db.createObjectStore('pendingPayments', { keyPath: 'localId' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('status', 'status');
      }
      if (!db.objectStoreNames.contains('productsCache')) {
        db.createObjectStore('productsCache', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('clientsCache')) {
        db.createObjectStore('clientsCache', { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(storeName, mode, callback) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = callback(store);

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---------- Ventes en attente ----------

// order = { items, clientId, paymentMethod, ... } — la forme attendue par api.createOrder,
// sans l'id serveur puisqu'elle n'existe pas encore.
export async function addPendingOrder(order) {
  const localId = crypto.randomUUID();
  const record = {
    localId,
    payload: order,
    status: 'pending_sync', // 'pending_sync' | 'syncing' | 'sync_failed'
    createdAt: new Date().toISOString(),
    error: null,
  };
  await withStore('pendingOrders', 'readwrite', (store) => store.add(record));
  return record;
}

export async function getPendingOrders() {
  const db = await openDB();
  const tx = db.transaction('pendingOrders', 'readonly');
  const store = tx.objectStore('pendingOrders');
  const index = store.index('createdAt');
  const all = await requestToPromise(index.getAll());
  return all; // déjà triées par createdAt croissant (ordre de création)
}

export async function updatePendingOrder(localId, patch) {
  return withStore('pendingOrders', 'readwrite', async (store) => {
    const existing = await requestToPromise(store.get(localId));
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    store.put(updated);
    return updated;
  });
}

export async function removePendingOrder(localId) {
  return withStore('pendingOrders', 'readwrite', (store) => store.delete(localId));
}

// ---------- Cache produits (pour bloquer une vente si le stock local est à 0) ----------

// products = résultat de api.getProducts(), appelé pendant qu'on est en ligne.
export async function cacheProducts(products) {
  return withStore('productsCache', 'readwrite', (store) => {
    products.forEach((p) => store.put(p));
  });
}

export async function getCachedProducts() {
  const db = await openDB();
  const tx = db.transaction('productsCache', 'readonly');
  return requestToPromise(tx.objectStore('productsCache').getAll());
}

// Décrémente le stock EN CACHE LOCAL uniquement (jamais renvoyé au serveur) —
// sert seulement à empêcher le caissier de vendre plus que ce qu'il reste,
// tant qu'on n'a pas pu revérifier auprès du serveur.
export async function decrementCachedStock(productId, quantity) {
  return withStore('productsCache', 'readwrite', async (store) => {
    const product = await requestToPromise(store.get(productId));
    if (!product) return null;
    const updated = { ...product, stock_quantity: Math.max(0, Number(product.stock_quantity) - quantity) };
    store.put(updated);
    return updated;
  });
}

// ---------- Cache clients (pour les ventes à crédit hors-ligne) ----------

export async function cacheClients(clients) {
  return withStore('clientsCache', 'readwrite', (store) => {
    clients.forEach((c) => store.put(c));
  });
}

export async function getCachedClients() {
  const db = await openDB();
  const tx = db.transaction('clientsCache', 'readonly');
  return requestToPromise(tx.objectStore('clientsCache').getAll());
}

// ---------- Encaissements en attente (commande déjà existante côté serveur) ----------

export async function addPendingPayment(orderId, payload) {
  const localId = crypto.randomUUID();
  const record = {
    localId,
    orderId,
    payload, // { paymentMethod, amountReceived }
    status: 'pending_sync',
    createdAt: new Date().toISOString(),
    error: null,
  };
  await withStore('pendingPayments', 'readwrite', (store) => store.add(record));
  return record;
}

export async function getPendingPayments() {
  const db = await openDB();
  const tx = db.transaction('pendingPayments', 'readonly');
  const index = tx.objectStore('pendingPayments').index('createdAt');
  return requestToPromise(index.getAll());
}

export async function updatePendingPayment(localId, patch) {
  return withStore('pendingPayments', 'readwrite', async (store) => {
    const existing = await requestToPromise(store.get(localId));
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    store.put(updated);
    return updated;
  });
}

export async function removePendingPayment(localId) {
  return withStore('pendingPayments', 'readwrite', (store) => store.delete(localId));
}
