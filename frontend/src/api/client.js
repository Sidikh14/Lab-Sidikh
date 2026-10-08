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

// Le backend répond 503 + code "maintenance" quand le secteur du commerçant
// est en maintenance. On mémorise ce qu'il faut à la page statique
// /maintenance.html (secteur pour la couleur, URL de l'API pour savoir quand
// revenir, message et heure de retour) puis on y redirige.
function signalerMaintenance(body) {
  try {
    if (body?.sector) localStorage.setItem('secteurActif', body.sector);
    localStorage.setItem('maintenanceInfo', JSON.stringify({
      apiUrl: API_URL,
      sector: body?.sector || null,
      message: body?.message || null,
      returnAt: body?.returnAt || null,
    }));
  } catch {
    // localStorage indisponible : la page s'affichera avec ses valeurs par défaut.
  }
  if (!window.location.pathname.startsWith('/maintenance')) {
    window.location.replace('/maintenance.html');
  }
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

  if (response.status === 503 && body?.code === 'maintenance') {
    signalerMaintenance(body);
    throw new Error(body.error);
  }

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
    if (response.status === 503 && body?.code === 'maintenance') {
      signalerMaintenance(body);
    }
    throw new Error(body?.error || `Erreur ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // On laisse un délai avant de révoquer l'URL, le temps que l'onglet charge le fichier.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Génère un PDF à partir de données envoyées (POST) et renvoie le Blob, pour un aperçu
// intégré à la page (télécharger / imprimer) au lieu d'un nouvel onglet.
async function requestBlob(path, payload) {
  const token = getToken();
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  });
  if (response.status === 401) {
    signalerSessionExpiree();
    throw new Error('Votre session a expiré. Veuillez vous reconnecter.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Erreur ${response.status}`);
  }
  return response.blob();
}

// Comme previewFile, mais pour envoyer un fichier (multipart/form-data) au
// lieu d'en recevoir un — jamais de Content-Type manuel : le navigateur doit
// fixer lui-même la boundary du multipart.
async function requestFormData(path, formData) {
  const token = getToken();
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await response.json() : null;

  if (response.status === 503 && body?.code === 'maintenance') {
    signalerMaintenance(body);
    throw new Error(body.error);
  }

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

function qs(params = {}) {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') s.set(k, v);
  });
  const texte = s.toString();
  return texte ? `?${texte}` : '';
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
  // Bon de transfert (PDF) à remettre au livreur : ouvert en aperçu, prêt à imprimer.
  downloadStockTransferPdf: (id) => previewFile(`/stock-transfers/${id}/pdf`),
  // Rappels fiscaux (déclarations à déposer) pour le tableau de bord.
  getFiscalAlerts: () => request('/accounting/fiscal-alerts'),

  getProducts: (warehouseId) => request(`/products${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  createProduct: (data) =>
    request('/products', { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (id, data) =>
    request(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  recordStockMovement: (id, data) =>
    request(`/products/${id}/stock-movement`, { method: 'POST', body: JSON.stringify(data) }),
  recordStockPurchase: (data) =>
    request('/products/purchases', { method: 'POST', body: JSON.stringify(data) }),
  previewStockPurchase: (data) =>
    request('/products/purchases/preview', { method: 'POST', body: JSON.stringify(data) }),
  deleteProduct: (id) => request(`/products/${id}`, { method: 'DELETE' }),
  getProductLots: (id, warehouseId) =>
    request(`/products/${id}/lots${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  getExpiringLots: (warehouseId) =>
    request(`/products/expiring-lots${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  getExpiredLots: (warehouseId) =>
    request(`/products/expired-lots${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  getLotDestructions: (warehouseId) =>
    request(`/products/destructions${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  destroyProductLot: (id, lotId, warehouseId) =>
    request(`/products/${id}/lots/${lotId}${warehouseId ? `?warehouseId=${warehouseId}` : ''}`, { method: 'DELETE' }),
  addProductUnit: (productId, data) =>
    request(`/products/${productId}/units`, { method: 'POST', body: JSON.stringify(data) }),
  declareStockLoss: (productId, data) =>
    request(`/products/${productId}/losses`, { method: 'POST', body: JSON.stringify(data) }),
  deleteProductUnit: (productId, unitId) =>
    request(`/products/${productId}/units/${unitId}`, { method: 'DELETE' }),

  // Reliquat : commandes clients en attente sur rupture de stock.
  getPendingReservations: (warehouseId) =>
    request(`/products/reservations${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  cancelReservation: (id) => request(`/products/reservations/${id}/cancel`, { method: 'PATCH' }),
  deliverReservation: (id) => request(`/products/reservations/${id}/deliver`, { method: 'PATCH' }),

  getCategories: () => request('/categories'),
  createCategory: (data) =>
    request('/categories', { method: 'POST', body: JSON.stringify(data) }),
  updateCategory: (id, data) =>
    request(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCategory: (id) => request(`/categories/${id}`, { method: 'DELETE' }),

  getProductEquivalences: () => request('/products/equivalences'),
  addProductEquivalence: (productId1, productId2) =>
    request('/products/equivalences', { method: 'POST', body: JSON.stringify({ productId1, productId2 }) }),
  removeProductEquivalence: (linkId) =>
    request(`/products/equivalences/${linkId}`, { method: 'DELETE' }),

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

  getPrescriptions: (warehouseId, renewableOnly) => {
    const params = new URLSearchParams();
    if (warehouseId) params.set('warehouseId', warehouseId);
    if (renewableOnly) params.set('renewable', 'true');
    const qs = params.toString();
    return request(`/prescriptions${qs ? `?${qs}` : ''}`);
  },
  createPrescription: (data) =>
    request('/prescriptions', { method: 'POST', body: JSON.stringify(data) }),

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
  previewOrderReceipt: (id, format) => previewFile(`/orders/${id}/receipt-pdf${format ? `?format=${format}` : ''}`),
  previewDeliveryNote: (id) => previewFile(`/orders/${id}/delivery-note-pdf`),
  downloadOrdersPdf: (from, to) => previewFile(`/orders/pdf?from=${from}&to=${to}`),
  getZakat: () => request('/zakat'),
  getInventoryReport: (from, to, warehouseId) =>
    request(`/products/inventory-report?from=${from}&to=${to}${warehouseId ? `&warehouseId=${warehouseId}` : ''}`),
  downloadInventoryReportPdf: (from, to, warehouseId) =>
    previewFile(`/products/inventory-report/pdf?from=${from}&to=${to}${warehouseId ? `&warehouseId=${warehouseId}` : ''}`),
  returnOrderToSeller: (id, reason) =>
    request(`/orders/${id}/return-to-seller`, { method: 'PATCH', body: JSON.stringify({ reason }) }),

  getReturns: (warehouseId) => request(`/returns${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  createReturn: (data) =>
    request('/returns', { method: 'POST', body: JSON.stringify(data) }),

  // Pharmacie uniquement : demande de retour caissier, à valider par manager/gérant.
  getReturnRequests: (warehouseId) => request(`/returns/requests${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  createReturnRequest: (data) =>
    request('/returns/requests', { method: 'POST', body: JSON.stringify(data) }),
  approveReturnRequest: (id) => request(`/returns/requests/${id}/approve`, { method: 'PATCH' }),
  rejectReturnRequest: (id, rejectionReason) =>
    request(`/returns/requests/${id}/reject`, { method: 'PATCH', body: JSON.stringify({ rejectionReason }) }),

  getVapidPublicKey: () => request('/push/vapid-public-key'),
  subscribePush: (subscription) =>
    request('/push/subscribe', { method: 'POST', body: JSON.stringify(subscription) }),
  unsubscribePush: (endpoint) =>
    request('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }),

  getUsers: () => request('/users'),
  createUser: (data) =>
    request('/users', { method: 'POST', body: JSON.stringify(data) }),
  setUserStatus: (id, isActive) =>
    request(`/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),
  // `roles` : liste des rôles cochés (un seul rôle sous forme de texte reste accepté).
  setUserRole: (id, roles) =>
    request(`/users/${id}/role`, { method: 'PATCH', body: JSON.stringify(Array.isArray(roles) ? { roles } : { role: roles }) }),
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

  getInsurers: () => request('/insurers'),
  getInsurer: (id) => request(`/insurers/${id}`),
  createInsurer: (data) =>
    request('/insurers', { method: 'POST', body: JSON.stringify(data) }),
  createInsurerPayment: (id, data) =>
    request(`/insurers/${id}/payments`, { method: 'POST', body: JSON.stringify(data) }),
  deleteInsurer: (id) => request(`/insurers/${id}`, { method: 'DELETE' }),
  downloadInsurerStatementPdf: (id, month) => previewFile(`/insurers/${id}/statement-pdf?month=${month}`),

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
  getProfit: () => request('/activity/profit'),
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

  // Accès au module comptabilité, donné par l'owner commerçant par commerçant.
  setMerchantAccounting: (id, enabled) =>
    request(`/admin/merchants/${id}/accounting`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),

  // Accès aux modules Paie et Fiscalité, donné par l'owner (comme la comptabilité).
  setMerchantPayroll: (id, enabled) =>
    request(`/admin/merchants/${id}/payroll`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  setMerchantFiscalite: (id, enabled) =>
    request(`/admin/merchants/${id}/fiscalite`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  getModulesAccess: () => request('/modules/access'),

  // Comptabilité (manager, si le module est activé).
  getAccountingAccess: () => request('/accounting/access'),
  getAccountingAccounts: () => request('/accounting/accounts'),
  createAccountingAccount: (data) =>
    request('/accounting/accounts', { method: 'POST', body: JSON.stringify(data) }),
  updateAccountingAccount: (id, data) =>
    request(`/accounting/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getAccountingJournals: () => request('/accounting/journals'),
  getAccountingEntries: (params) => request(`/accounting/entries${qs(params)}`),
  createAccountingEntry: (data) =>
    request('/accounting/entries', { method: 'POST', body: JSON.stringify(data) }),
  deleteAccountingEntry: (id) => request(`/accounting/entries/${id}`, { method: 'DELETE' }),
  getAccountingLedger: (params) => request(`/accounting/ledger${qs(params)}`),
  getAccountingTrialBalance: (params) => request(`/accounting/trial-balance${qs(params)}`),
  getAccountingIncomeStatement: (params) => request(`/accounting/income-statement${qs(params)}`),
  getAccountingBalanceSheet: (params) => request(`/accounting/balance-sheet${qs(params)}`),
  syncAccounting: () => request('/accounting/sync', { method: 'POST' }),
  getAccountingCashFlow: (params) => request(`/accounting/cash-flow${qs(params)}`),
  getAccountingControls: () => request('/accounting/controls'),
  getOpeningBalances: () => request('/accounting/opening-balances'),
  saveOpeningBalances: (data) =>
    request('/accounting/opening-balances', { method: 'POST', body: JSON.stringify(data) }),
  getAttachments: (sourceType, sourceId) => request(`/accounting/attachments${qs({ sourceType, sourceId })}`),
  deleteAttachment: (id) => request(`/accounting/attachments/${id}`, { method: 'DELETE' }),
  previewAttachment: (id) => previewFile(`/accounting/attachments/${id}/file`),
  // Le fichier part tel quel (image ou PDF) : les informations de la pièce sont dans l'adresse.
  uploadAttachment: async (sourceType, sourceId, blob, fileName) => {
    const token = getToken();
    const response = await fetch(
      `${API_URL}/accounting/attachments${qs({ sourceType, sourceId, fileName })}`,
      { method: 'POST', headers: { 'Content-Type': blob.type, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: blob }
    );
    if (response.status === 401) {
      signalerSessionExpiree();
      throw new Error('Votre session a expiré. Veuillez vous reconnecter.');
    }
    const body = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
    if (!response.ok) throw new Error(body?.error || `Erreur ${response.status}`);
    return body;
  },
  getAccountingGeneralLedger: (params) => request(`/accounting/general-ledger${qs(params)}`),

  // Natures de charges proposées dans « Nouvelle sortie de caisse » (page Caisse).
  getCaisseNatures: () => request('/accounting/caisse/natures'),

  // Factures de charges à payer plus tard ou payées par virement (page Caisse).
  getCaisseFactures: () => request('/accounting/caisse/factures'),
  createCaisseFacture: (data) =>
    request('/accounting/caisse/factures', { method: 'POST', body: JSON.stringify(data) }),
  payCaisseFacture: (id, data) =>
    request(`/accounting/caisse/factures/${id}/payer`, { method: 'POST', body: JSON.stringify(data) }),
  deleteChargeBill: (id) => request(`/accounting/charge-bills/${id}`, { method: 'DELETE' }),

  // Immobilisations et amortissements.
  getAccountingAssetCategories: () => request('/accounting/assets/categories'),
  getAccountingAssets: () => request('/accounting/assets'),
  createAccountingAsset: (data) =>
    request('/accounting/assets', { method: 'POST', body: JSON.stringify(data) }),
  payAccountingAsset: (id, data) =>
    request(`/accounting/assets/${id}/pay`, { method: 'POST', body: JSON.stringify(data) }),
  disposeAccountingAsset: (id, data) =>
    request(`/accounting/assets/${id}/dispose`, { method: 'POST', body: JSON.stringify(data) }),
  deleteAccountingAsset: (id) => request(`/accounting/assets/${id}`, { method: 'DELETE' }),

  // Capital, apports, emprunts et remboursements.
  getAccountingFinancing: () => request('/accounting/financing'),
  createAccountingFinancing: (data) =>
    request('/accounting/financing', { method: 'POST', body: JSON.stringify(data) }),
  deleteAccountingFinancing: (id) => request(`/accounting/financing/${id}`, { method: 'DELETE' }),

  // Régularisations de fin de période (charges constatées d'avance, charges à payer).
  getAccountingAdjustments: () => request('/accounting/adjustments'),
  createAccountingAdjustment: (data) =>
    request('/accounting/adjustments', { method: 'POST', body: JSON.stringify(data) }),
  deleteAccountingAdjustment: (id) => request(`/accounting/adjustments/${id}`, { method: 'DELETE' }),

  // Rapprochement caisse / banque / mobile money (solde réel vs solde comptable).
  getReconciliationBalances: (params) => request(`/accounting/reconciliations/balances${qs(params)}`),
  getReconciliations: (params) => request(`/accounting/reconciliations${qs(params)}`),
  createReconciliation: (data) =>
    request('/accounting/reconciliations', { method: 'POST', body: JSON.stringify(data) }),
  deleteReconciliation: (id) => request(`/accounting/reconciliations/${id}`, { method: 'DELETE' }),

  // Balance âgée (clients, fournisseurs, assureurs).
  getAgedBalance: (params) => request(`/accounting/aged-balance${qs(params)}`),

  // Impôts et cotisations dus à l'État (TVA, retenues sur salaires, CSS, IPRES, CFCE, IS).
  getAccountingStateDues: (params) => request(`/accounting/state-dues${qs(params)}`),
  getAccountingStatePayments: () => request('/accounting/state-payments'),
  createAccountingStatePayment: (data) =>
    request('/accounting/state-payments', { method: 'POST', body: JSON.stringify(data) }),
  cancelAccountingStatePayment: (id) =>
    request(`/accounting/state-payments/${id}`, { method: 'DELETE' }),

  // Impôt sur les résultats et clôture d'exercice.
  buildAccountingPdf: (payload) => requestBlob('/accounting/pdf', payload),
  // Fiscalité : profil du contribuable, déclarations DGID préparées, dépôts enregistrés.
  getTaxProfile: () => request('/accounting/tax-profile'),
  setTaxProfile: (data) =>
    request('/accounting/tax-profile', { method: 'PUT', body: JSON.stringify(data) }),
  getTaxDeclaration: (kind, params) => request(`/accounting/declarations/${kind}${qs(params)}`),
  getBrsEntries: (month) => request(`/accounting/brs-entries${qs({ month })}`),
  createBrsEntry: (data) =>
    request('/accounting/brs-entries', { method: 'POST', body: JSON.stringify(data) }),
  deleteBrsEntry: (id) => request(`/accounting/brs-entries/${id}`, { method: 'DELETE' }),
  getTaxFilings: () => request('/accounting/filings'),
  createTaxFiling: (data) =>
    request('/accounting/filings', { method: 'POST', body: JSON.stringify(data) }),
  deleteTaxFiling: (id) => request(`/accounting/filings/${id}`, { method: 'DELETE' }),
  getAccountingTaxSettings: () => request('/accounting/tax-settings'),
  setAccountingTaxSettings: (data) =>
    request('/accounting/tax-settings', { method: 'PUT', body: JSON.stringify(data) }),
  getAccountingFiscalYears: () => request('/accounting/fiscal-years'),
  getAccountingClosingPreview: (params) => request(`/accounting/closing-preview${qs(params)}`),
  bookAccountingIncomeTax: (data) =>
    request('/accounting/income-tax', { method: 'POST', body: JSON.stringify(data) }),
  closeAccountingFiscalYear: (year, data) =>
    request(`/accounting/fiscal-years/${year}/close`, { method: 'POST', body: JSON.stringify(data || {}) }),
  reopenAccountingFiscalYear: (year) =>
    request(`/accounting/fiscal-years/${year}/reopen`, { method: 'POST' }),

  // Maintenance par secteur (owner).
  getMaintenance: () => request('/admin/maintenance'),
  setMaintenance: (sector, data) =>
    request(`/admin/maintenance/${sector}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Import en masse de produits par l'owner, pour un commerçant choisi.
  getMerchantWarehouses: (id) => request(`/admin/merchants/${id}/warehouses`),
  downloadMerchantProductsTemplate: (id) => previewFile(`/admin/merchants/${id}/products-template`),
  importMerchantProducts: (id, warehouseId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('warehouseId', warehouseId);
    return requestFormData(`/admin/merchants/${id}/products-import`, formData);
  },
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

  // Paie / bulletins de salaire
  getPayrollSettings: () => request('/payroll/settings'),
  updatePayrollSettings: (data) =>
    request('/payroll/settings', { method: 'PUT', body: JSON.stringify(data) }),
  getSalaryBonuses: (userId, month) =>
    request(`/payroll/${userId}/bonuses${month ? `?month=${month}` : ''}`),
  generatePayslip: (userId, data) =>
    request(`/payroll/${userId}/generate`, { method: 'POST', body: JSON.stringify(data) }),
  getPayslip: (userId, month) => request(`/payroll/${userId}/${month}`),
  previewPayslipPdf: (userId, month) => previewFile(`/payroll/${userId}/${month}/pdf`),
  getMyPayslips: () => request('/payroll/mine'),

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
