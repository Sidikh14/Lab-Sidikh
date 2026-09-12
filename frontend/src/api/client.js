const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function getToken() {
  return localStorage.getItem('token');
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await response.json() : null;

  if (!response.ok) {
    const message = body?.error || `Erreur ${response.status}`;
    throw new Error(message);
  }

  return body;
}

// Ouvre un PDF en aperçu dans un nouvel onglet (au lieu de le télécharger
// directement) : l'utilisateur peut ensuite l'imprimer ou l'enregistrer
// depuis la visionneuse PDF du navigateur.
async function previewFile(path) {
  const token = getToken();
  const response = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Erreur ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // On laisse un délai avant de révoquer l'URL, le temps que l'onglet charge le fichier.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export const api = {
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  register: (data, adminKey) =>
    request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
      headers: { 'X-Admin-Key': adminKey || '' },
    }),

  getProducts: () => request('/products'),
  createProduct: (data) =>
    request('/products', { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (id, data) =>
    request(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  recordStockMovement: (id, data) =>
    request(`/products/${id}/stock-movement`, { method: 'POST', body: JSON.stringify(data) }),
  deleteProduct: (id) => request(`/products/${id}`, { method: 'DELETE' }),
  addProductUnit: (productId, data) =>
    request(`/products/${productId}/units`, { method: 'POST', body: JSON.stringify(data) }),
  deleteProductUnit: (productId, unitId) =>
    request(`/products/${productId}/units/${unitId}`, { method: 'DELETE' }),

  getClients: () => request('/clients'),
  getClient: (id) => request(`/clients/${id}`),
  createClient: (data) =>
    request('/clients', { method: 'POST', body: JSON.stringify(data) }),

  getOrders: () => request('/orders'),
  getOrder: (id) => request(`/orders/${id}`),
  createOrder: (data) =>
    request('/orders', { method: 'POST', body: JSON.stringify(data) }),
  updateOrder: (id, data) =>
    request(`/orders/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  updateOrderStatus: (id, status) =>
    request(`/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  recordOrderPayment: (id, data) =>
    request(`/orders/${id}/payment`, { method: 'PATCH', body: JSON.stringify(data) }),
  previewOrderReceipt: (id) => previewFile(`/orders/${id}/receipt-pdf`),
  returnOrderToSeller: (id, reason) =>
    request(`/orders/${id}/return-to-seller`, { method: 'PATCH', body: JSON.stringify({ reason }) }),

  getUsers: () => request('/users'),
  createUser: (data) =>
    request('/users', { method: 'POST', body: JSON.stringify(data) }),
  setUserStatus: (id, isActive) =>
    request(`/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),
  setUserPermissions: (id, modules) =>
    request(`/users/${id}/permissions`, { method: 'PATCH', body: JSON.stringify({ modules }) }),
  resetUserPassword: (id, newPassword) =>
    request(`/users/${id}/password`, { method: 'PATCH', body: JSON.stringify({ newPassword }) }),

  getCreditRequests: (status) => request(`/credit-requests${status ? `?status=${status}` : ''}`),
  createCreditRequest: (data) =>
    request('/credit-requests', { method: 'POST', body: JSON.stringify(data) }),
  approveCreditRequest: (id) => request(`/credit-requests/${id}/approve`, { method: 'PATCH' }),
  rejectCreditRequest: (id, reason) =>
    request(`/credit-requests/${id}/reject`, { method: 'PATCH', body: JSON.stringify({ reason }) }),

  getSuppliers: () => request('/suppliers'),
  getSupplier: (id) => request(`/suppliers/${id}`),
  createSupplier: (data) =>
    request('/suppliers', { method: 'POST', body: JSON.stringify(data) }),
  createSupplierPayment: (id, data) =>
    request(`/suppliers/${id}/payments`, { method: 'POST', body: JSON.stringify(data) }),
  deleteSupplier: (id) => request(`/suppliers/${id}`, { method: 'DELETE' }),

  getPurchaseOrders: () => request('/purchase-orders'),
  getPurchaseOrder: (id) => request(`/purchase-orders/${id}`),
  createPurchaseOrder: (data) =>
    request('/purchase-orders', { method: 'POST', body: JSON.stringify(data) }),
  updatePurchaseOrderStatus: (id, status) =>
    request(`/purchase-orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  downloadPurchaseOrderPdf: (id) =>
    previewFile(`/purchase-orders/${id}/pdf`),

  getActivityToday: () => request('/activity/today'),
  getActivityRange: (from, to) => request(`/activity/range?from=${from}&to=${to}`),
  downloadActivityPdf: (from, to) => previewFile(`/activity/pdf?from=${from}&to=${to}`),
  downloadProductsPdf: () => previewFile('/products/pdf'),

  getInventorySessions: () => request('/inventory-sessions'),
  getInventorySession: (id) => request(`/inventory-sessions/${id}`),
  createInventorySession: () => request('/inventory-sessions', { method: 'POST' }),
  setInventoryItemCount: (sessionId, itemId, countedQuantity) =>
    request(`/inventory-sessions/${sessionId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ countedQuantity }),
    }),
  closeInventorySession: (id) => request(`/inventory-sessions/${id}/close`, { method: 'PATCH' }),
  adjustInventorySession: (id) => request(`/inventory-sessions/${id}/adjust`, { method: 'PATCH' }),
};
