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

// Télécharge un fichier binaire (PDF) en conservant l'en-tête d'authentification,
// puis déclenche le téléchargement dans le navigateur.
async function downloadFile(path, filename) {
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
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

  getClients: () => request('/clients'),
  getClient: (id) => request(`/clients/${id}`),
  createClient: (data) =>
    request('/clients', { method: 'POST', body: JSON.stringify(data) }),

  getOrders: () => request('/orders'),
  getOrder: (id) => request(`/orders/${id}`),
  createOrder: (data) =>
    request('/orders', { method: 'POST', body: JSON.stringify(data) }),
  updateOrderStatus: (id, status) =>
    request(`/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  recordOrderPayment: (id, data) =>
    request(`/orders/${id}/payment`, { method: 'PATCH', body: JSON.stringify(data) }),

  getUsers: () => request('/users'),
  createUser: (data) =>
    request('/users', { method: 'POST', body: JSON.stringify(data) }),
  setUserStatus: (id, isActive) =>
    request(`/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),
  setUserPermissions: (id, modules) =>
    request(`/users/${id}/permissions`, { method: 'PATCH', body: JSON.stringify({ modules }) }),

  getSuppliers: () => request('/suppliers'),
  createSupplier: (data) =>
    request('/suppliers', { method: 'POST', body: JSON.stringify(data) }),
  deleteSupplier: (id) => request(`/suppliers/${id}`, { method: 'DELETE' }),

  getPurchaseOrders: () => request('/purchase-orders'),
  getPurchaseOrder: (id) => request(`/purchase-orders/${id}`),
  createPurchaseOrder: (data) =>
    request('/purchase-orders', { method: 'POST', body: JSON.stringify(data) }),
  updatePurchaseOrderStatus: (id, status) =>
    request(`/purchase-orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  downloadPurchaseOrderPdf: (id) =>
    downloadFile(`/purchase-orders/${id}/pdf`, `bon-de-commande-${id.slice(0, 8)}.pdf`),

  getActivityToday: () => request('/activity/today'),
};
