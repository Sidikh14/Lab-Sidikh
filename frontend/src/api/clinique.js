// Client API du module clinique.
// Reprend les mêmes règles que api/client.js (jeton, expiration de session, mot de passe provisoire)
// sans modifier ce fichier : il suffit donc d'importer ce module dans les écrans cliniques.

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function qs(params = {}) {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') s.set(k, v);
  });
  const texte = s.toString();
  return texte ? `?${texte}` : '';
}

async function request(chemin, options = {}) {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const reponse = await fetch(`${API_URL}${chemin}`, { ...options, headers });
  const estJson = reponse.headers.get('content-type')?.includes('application/json');
  const corps = estJson ? await reponse.json() : null;

  if (reponse.status === 401) {
    window.dispatchEvent(new CustomEvent('session-expired'));
    throw new Error('Votre session a expiré. Veuillez vous reconnecter.');
  }
  if (reponse.status === 403 && corps?.code === 'PASSWORD_CHANGE_REQUIRED') {
    window.dispatchEvent(new CustomEvent('password-change-required'));
    throw new Error(corps.error);
  }
  if (!reponse.ok) {
    const erreur = new Error(corps?.error || `Erreur ${reponse.status}`);
    // Conflit (ex. patient en double) : la fiche existante est transmise à l'écran.
    if (corps?.doublon) erreur.doublon = corps.doublon;
    throw erreur;
  }
  return corps;
}

export const apiClinique = {
  // Accueil : agenda et rendez-vous
  getAgenda: (date, serviceId) => request(`/clinique/agenda${qs({ date, serviceId })}`),
  changerStatutRdv: (id, status) =>
    request(`/clinique/rendez-vous/${id}/statut`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  creerRdv: (data) => request('/clinique/rendez-vous', { method: 'POST', body: JSON.stringify(data) }),
  getRappelsDemain: () => request('/clinique/rappels/demain'),

  // Patients
  creerPatient: (data) => request('/clinique/patients', { method: 'POST', body: JSON.stringify(data) }),

  // File d'attente et écran d'appel
  prendreTicket: (data) => request('/clinique/file/tickets', { method: 'POST', body: JSON.stringify(data) }),
  getFile: (serviceId) => request(`/clinique/file${qs({ serviceId })}`),
  appelerTicket: (id, guichet) =>
    request(`/clinique/file/${id}/appeler`, { method: 'POST', body: JSON.stringify({ guichet }) }),
  changerStatutTicket: (id, status) =>
    request(`/clinique/file/${id}/statut`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  getEcranAppel: (serviceId) => request(`/clinique/file/ecran${qs({ serviceId })}`),

  // Liste d'attente
  getListeAttente: () => request('/clinique/liste-attente'),

  // Services (lieux) : la liste vient de /warehouses
  getServices: () => request('/warehouses'),

  // Dossier patient (médecin, soignants)
  getDossier: (patientId) => request(`/clinique/patients/${patientId}/dossier`),
  sauverDossier: (patientId, data) =>
    request(`/clinique/patients/${patientId}/dossier`, { method: 'PUT', body: JSON.stringify(data) }),

  // Consultations
  getConsultations: (patientId) => request(`/clinique/patients/${patientId}/consultations`),
  ouvrirConsultation: (patientId, data) =>
    request(`/clinique/patients/${patientId}/consultations`, { method: 'POST', body: JSON.stringify(data) }),
  sauverConsultation: (patientId, id, data) =>
    request(`/clinique/patients/${patientId}/consultations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  signerConsultation: (patientId, id) =>
    request(`/clinique/patients/${patientId}/consultations/${id}/signer`, { method: 'POST' }),
  ajouterAddendum: (patientId, id, texte) =>
    request(`/clinique/patients/${patientId}/consultations/${id}/addenda`, { method: 'POST', body: JSON.stringify({ texte }) }),

  // Documents médicaux
  getDocuments: (patientId) => request(`/clinique/patients/${patientId}/documents`),
  emettreDocument: (patientId, data) =>
    request(`/clinique/patients/${patientId}/documents`, { method: 'POST', body: JSON.stringify(data) }),
  // Le PDF exige le jeton : on le télécharge puis on l'ouvre dans un nouvel onglet.
  ouvrirPdfDocument: async (patientId, docId) => {
    const token = localStorage.getItem('token');
    const reponse = await fetch(`${API_URL}/clinique/patients/${patientId}/documents/${docId}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!reponse.ok) throw new Error('Impossible d\'ouvrir le document.');
    const url = URL.createObjectURL(await reponse.blob());
    window.open(url, '_blank', 'noopener');
  },

  // Caisse clinique : actes, praticiens, vente et encaissement (routes de vente existantes)
  getActes: (categorie) => request(`/clinique/actes${qs({ categorie })}`),
  getPraticiens: () => request('/clinique/praticiens'),
  creerVente: (data) => request('/orders', { method: 'POST', body: JSON.stringify(data) }),
  encaisserVente: (orderId, data) =>
    request(`/orders/${orderId}/payment`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Laboratoire et imagerie
  getExamensATraiter: (type) => request(`/clinique/examens/a-traiter${qs({ type })}`),
  getExamensPatient: (patientId) => request(`/clinique/patients/${patientId}/examens`),
  demanderExamen: (patientId, data) =>
    request(`/clinique/patients/${patientId}/examens`, { method: 'POST', body: JSON.stringify(data) }),
  saisirResultat: (requestId, data) =>
    request(`/clinique/examens/${requestId}/resultat`, { method: 'POST', body: JSON.stringify(data) }),
  corrigerResultat: (requestId, data) =>
    request(`/clinique/examens/${requestId}/resultat`, { method: 'PATCH', body: JSON.stringify(data) }),
  validerResultat: (requestId) => request(`/clinique/examens/${requestId}/valider`, { method: 'POST' }),
  publierResultat: (requestId) => request(`/clinique/examens/${requestId}/publier`, { method: 'POST' }),

  // Pièces jointes (PDF, JPEG, PNG, WebP ; 1,5 Mo)
  getPiecesJointes: (patientId) => request(`/clinique/patients/${patientId}/pieces-jointes`),
  ajouterPieceJointe: (patientId, data) =>
    request(`/clinique/patients/${patientId}/pieces-jointes`, { method: 'POST', body: JSON.stringify(data) }),
  ouvrirPieceJointe: async (patientId, id) => {
    const token = localStorage.getItem('token');
    const reponse = await fetch(`${API_URL}/clinique/patients/${patientId}/pieces-jointes/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!reponse.ok) throw new Error('Impossible d\'ouvrir la pièce jointe.');
    window.open(URL.createObjectURL(await reponse.blob()), '_blank', 'noopener');
  },

  // Hospitalisation : lits, admissions, surveillance, sortie
  getLits: (serviceId) => request(`/clinique/lits${qs({ serviceId })}`),
  creerLit: (data) => request('/clinique/lits', { method: 'POST', body: JSON.stringify(data) }),
  changerStatutLit: (id, statut) =>
    request(`/clinique/lits/${id}/statut`, { method: 'PATCH', body: JSON.stringify({ statut }) }),
  admettre: (patientId, data) =>
    request(`/clinique/patients/${patientId}/admissions`, { method: 'POST', body: JSON.stringify(data) }),
  getSurveillance: (patientId, admissionId) =>
    request(`/clinique/patients/${patientId}/admissions/${admissionId}/surveillance`),
  ajouterSurveillance: (patientId, admissionId, data) =>
    request(`/clinique/patients/${patientId}/admissions/${admissionId}/surveillance`, { method: 'POST', body: JSON.stringify(data) }),
  sortirPatient: (patientId, admissionId, data) =>
    request(`/clinique/patients/${patientId}/admissions/${admissionId}/sortie`, { method: 'POST', body: JSON.stringify(data) }),

  // Urgences
  getSalleUrgences: () => request('/clinique/urgences/salle'),
  creerPassageUrgence: (data) => request('/clinique/urgences', { method: 'POST', body: JSON.stringify(data) }),
  changerStatutUrgence: (id, statut) =>
    request(`/clinique/urgences/${id}/statut`, { method: 'PATCH', body: JSON.stringify({ statut }) }),

  // Pharmacie interne et consommables
  getStockPharmacie: (warehouseId) => request(`/clinique/pharmacie/stock${qs({ warehouseId })}`),
  enregistrerEntreeStock: (data) => request('/clinique/pharmacie/entrees', { method: 'POST', body: JSON.stringify(data) }),
  sortirConsommable: (data) => request('/clinique/pharmacie/consommations', { method: 'POST', body: JSON.stringify(data) }),
  dispenserAuPatient: (patientId, data) =>
    request(`/clinique/patients/${patientId}/dispensations`, { method: 'POST', body: JSON.stringify(data) }),
  getDispensationsPatient: (patientId) => request(`/clinique/patients/${patientId}/dispensations`),

  // Planning et gardes
  getPlanning: (from, to, serviceId) => request(`/clinique/planning${qs({ from, to, serviceId })}`),
  creerCreneau: (data) => request('/clinique/planning', { method: 'POST', body: JSON.stringify(data) }),
  supprimerCreneau: (id) => request(`/clinique/planning/${id}`, { method: 'DELETE' }),
  getPrimesGarde: (month) => request(`/clinique/primes-garde${qs({ month })}`),
  // Personnel : liste des comptes du commerce (la page filtre les rôles cliniques)
  getPersonnel: () => request('/users'),

  // Alertes et rapports
  verifierAlertes: () => request('/clinique/alertes/verifier', { method: 'POST' }),
  getRapportActivite: (from, to) => request(`/clinique/rapports/activite${qs({ from, to })}`),
  getRapportRecettes: (from, to) => request(`/clinique/rapports/recettes${qs({ from, to })}`),
  getHonoraires: (statut) => request(`/clinique/honoraires${qs({ statut })}`),
  verserHonoraires: (ids) => request('/clinique/honoraires/versements', { method: 'POST', body: JSON.stringify({ ids }) }),

  // Agenda d'un praticien (le médecin voit le sien)
  getAgendaPraticien: (date, practitionerId) => request(`/clinique/agenda${qs({ date, practitionerId })}`),

  // Recherche de patient (dossiers, caisse)
  rechercherPatients: (q) => request(`/clinique/patients${qs({ q })}`),
};
