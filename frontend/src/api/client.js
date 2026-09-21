const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function getToken() {
  return localStorage.getItem('token');
}

// Quand le token est absent/invalide/expiré, le backend répond 401. On
// vide le token stocké et on prévient le reste de l'appli (AuthContext
// écoute cet événement) pour forcer un retour à l'écran de connexion,
// au lieu de laisser l'utilisateur face à une erreur JSON brute.
function signalerSessionExpiree() {
  localStorage.removeItem('token');
  window.dispatchEvent(new CustomEvent('session-expired'));
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

  if (response.status === 401) {
    signalerSessionExpiree();
    throw new Error('Votre session a expiré. Veuillez vous reconnecter.');
  }

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
  if (response.status === 401) {
    signalerSessionExpiree();
    throw new Error('Votre session a expiré. Veuillez vous reconnecter.');
  }
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

  getWarehouses: () => request('/warehouses'),
  createWarehouse: (data) =>
    request('/warehouses', { method: 'POST', body: JSON.stringify(data) }),
  updateWarehouse: (id, data) =>
    request(`/warehouses/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  setWarehouseStatus: (id, isActive) =>
    request(`/warehouses/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),

  getStockTransfers: () => request('/stock-transfers'),
  getStockTransfer: (id) => request(`/stock-transfers/${id}`),
  createStockTransfer: (data) =>
    request('/stock-transfers', { method: 'POST', body: JSON.stringify(data) }),
  receiveStockTransfer: (id) => request(`/stock-transfers/${id}/receive`, { method: 'PATCH' }),
  cancelStockTransfer: (id) => request(`/stock-transfers/${id}/cancel`, { method: 'PATCH' }),

  getProducts: (warehouseId) => request(`/products${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  createProduct: (data) =>
    request('/products', { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (id, data) =>
    request(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  recordStockMovement: (id, data) =>
    request(`/products/${id}/stock-movement`, { method: 'POST', body: JSON.stringify(data) }),
  recordStockPurchase: (data) =>
    request('/products/purchases', { method: 'POST', body: JSON.stringify(data) }),
  deleteProduct: (id) => request(`/products/${id}`, { method: 'DELETE' }),
  addProductUnit: (productId, data) =>
    request(`/products/${productId}/units`, { method: 'POST', body: JSON.stringify(data) }),
  deleteProductUnit: (productId, unitId) =>
    request(`/products/${productId}/units/${unitId}`, { method: 'DELETE' }),

  getClients: () => request('/clients'),
  getClient: (id) => request(`/clients/${id}`),
  createClient: (data) =>
    request('/clients', { method: 'POST', body: JSON.stringify(data) }),
  updateClient: (id, data) =>
    request(`/clients/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  recordCreditPayment: (id, data) =>
    request(`/clients/${id}/credit-payments`, { method: 'POST', body: JSON.stringify(data) }),
  getClientWhatsappStatement: (id) =>
    request(`/clients/${id}/whatsapp-statement`, { method: 'POST' }),
  downloadClientUnpaidInvoicesPdf: (id) => previewFile(`/clients/${id}/unpaid-invoices-pdf`),

  getOrders: (warehouseId) => request(`/orders${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
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
  downloadOrdersPdf: (from, to) => previewFile(`/orders/pdf?from=${from}&to=${to}`),
  returnOrderToSeller: (id, reason) =>
    request(`/orders/${id}/return-to-seller`, { method: 'PATCH', body: JSON.stringify({ reason }) }),

  getUsers: () => request('/users'),
  createUser: (data) =>
    request('/users', { method: 'POST', body: JSON.stringify(data) }),
  setUserStatus: (id, isActive) =>
    request(`/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),
  setUserRole: (id, role) =>
    request(`/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),
  setUserPermissions: (id, modules) =>
    request(`/users/${id}/permissions`, { method: 'PATCH', body: JSON.stringify({ modules }) }),
  resetUserPassword: (id, newPassword) =>
    request(`/users/${id}/password`, { method: 'PATCH', body: JSON.stringify({ newPassword }) }),
  setUserWarehouse: (id, warehouseId) =>
    request(`/users/${id}/warehouse`, { method: 'PATCH', body: JSON.stringify({ warehouseId }) }),

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
  downloadSupplierPurchasesPdf: (from, to) => previewFile(`/suppliers/purchases/pdf?from=${from}&to=${to}`),

  getPurchaseOrders: (warehouseId) => request(`/purchase-orders${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
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
  getRevenue: () => request('/activity/revenue'),
  getRevenueByWarehouse: () => request('/activity/revenue-by-warehouse'),

  getMerchantProfile: () => request('/merchant/profile'),
  updateMerchantProfile: (data) =>
    request('/merchant/profile', { method: 'PATCH', body: JSON.stringify(data) }),

  // Réservé au rôle owner (propriétaire de la plateforme).
  getAdminMerchants: () => request('/admin/merchants'),
  setMerchantStatus: (id, isActive) =>
    request(`/admin/merchants/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),
  setMerchantLimit: (id, maxTeamMembers) =>
    request(`/admin/merchants/${id}/limit`, { method: 'PATCH', body: JSON.stringify({ maxTeamMembers }) }),
  setMerchantWarehouseLimit: (id, maxWarehouses) =>
    request(`/admin/merchants/${id}/warehouse-limit`, { method: 'PATCH', body: JSON.stringify({ maxWarehouses }) }),
  deleteMerchant: (id) => request(`/admin/merchants/${id}`, { method: 'DELETE' }),
  getMerchantTeam: (id) => request(`/admin/merchants/${id}/users`),
  setAdminUserStatus: (id, isActive) =>
    request(`/admin/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),
  deleteAdminUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),

  getCashSummary: (date, warehouseId) =>
    request(`/cash/summary?${date ? `date=${date}&` : ''}${warehouseId ? `warehouseId=${warehouseId}` : ''}`),
  getCashBalances: (warehouseId) => request(`/cash/balances${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  createCashClosing: (data) =>
    request('/cash/closings', { method: 'POST', body: JSON.stringify(data) }),
  getCashClosings: (from, to) => request(`/cash/closings?from=${from}&to=${to}`),
  createCashExpense: (data) =>
    request('/cash/expenses', { method: 'POST', body: JSON.stringify(data) }),
  getCashExpenses: (from, to, method, warehouseId) =>
    request(`/cash/expenses?from=${from}&to=${to}${method ? `&method=${method}` : ''}${warehouseId ? `&warehouseId=${warehouseId}` : ''}`),
  createCashDeposit: (data) =>
    request('/cash/deposits', { method: 'POST', body: JSON.stringify(data) }),
  getCashDeposits: (from, to, method, warehouseId) =>
    request(`/cash/deposits?from=${from}&to=${to}${method ? `&method=${method}` : ''}${warehouseId ? `&warehouseId=${warehouseId}` : ''}`),
  getCashMovements: (method, from, to, cashier, warehouseId) =>
    request(`/cash/movements?method=${method}&from=${from}&to=${to}${cashier && cashier !== 'tous' ? `&cashier=${cashier}` : ''}${warehouseId ? `&warehouseId=${warehouseId}` : ''}`),
  downloadCashMovementsPdf: (method, from, to, cashier, warehouseId) =>
    previewFile(`/cash/movements/pdf?method=${method}&from=${from}&to=${to}${cashier && cashier !== 'tous' ? `&cashier=${cashier}` : ''}${warehouseId ? `&warehouseId=${warehouseId}` : ''}`),
  getCashCashiers: (warehouseId) => request(`/cash/cashiers${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  downloadProductsPdf: (warehouseId) => previewFile(`/products/pdf${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),

  getSalaries: (month) => request(`/salaries${month ? `?month=${month}` : ''}`),
  setSalary: (userId, data) =>
    request(`/salaries/${userId}`, { method: 'PUT', body: JSON.stringify(data) }),
  paySalary: (userId, data) =>
    request(`/salaries/${userId}/pay`, { method: 'POST', body: JSON.stringify(data) }),
  getSalaryAlert: () => request('/salaries/alert'),
  getSalaryMaxMonth: () => request('/salaries/max-month'),

  getInventorySessions: (warehouseId) => request(`/inventory-sessions${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  getInventorySession: (id) => request(`/inventory-sessions/${id}`),
  createInventorySession: (warehouseId) => request('/inventory-sessions', { method: 'POST', body: JSON.stringify({ warehouseId }) }),
  setInventoryItemCount: (sessionId, itemId, countedQuantity) =>
    request(`/inventory-sessions/${sessionId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ countedQuantity }),
    }),
  closeInventorySession: (id) => request(`/inventory-sessions/${id}/close`, { method: 'PATCH' }),
  adjustInventorySession: (id) => request(`/inventory-sessions/${id}/adjust`, { method: 'PATCH' }),
};
