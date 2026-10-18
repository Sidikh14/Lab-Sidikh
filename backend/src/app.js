const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { brandingContext } = require('./utils/brandingContext');

const authRoutes = require('./routes/auth.routes');
const productsRoutes = require('./routes/products.routes');
const clientsRoutes = require('./routes/clients.routes');
const ordersRoutes = require('./routes/orders.routes');
const usersRoutes = require('./routes/users.routes');
const suppliersRoutes = require('./routes/suppliers.routes');
const purchaseOrdersRoutes = require('./routes/purchase-orders.routes');
const activityRoutes = require('./routes/activity.routes');
const inventorySessionsRoutes = require('./routes/inventory-sessions.routes');
const creditRequestsRoutes = require('./routes/credit-requests.routes');
const cashRoutes = require('./routes/cash.routes');
const eventsRoutes = require('./routes/events.routes');
const alertsRoutes = require('./routes/alerts.routes');
const pushRoutes = require('./routes/push.routes');
const merchantRoutes = require('./routes/merchant.routes');
const adminRoutes = require('./routes/admin.routes');
const salariesRoutes = require('./routes/salaries.routes');
const warehousesRoutes = require('./routes/warehouses.routes');
const stockTransfersRoutes = require('./routes/stock-transfers.routes');
const categoriesRoutes = require('./routes/categories.routes');
const prescriptionsRoutes = require('./routes/prescriptions.routes');
const returnsRoutes = require('./routes/returns.routes');
const payrollRoutes = require('./routes/payroll.routes');
const insurersRoutes = require('./routes/insurers.routes');
const zakatRoutes = require('./routes/zakat.routes');
const maintenanceRoutes = require('./routes/maintenance.routes');
const accountingRoutes = require('./routes/accounting.routes');
const modulesRoutes = require('./routes/modules.routes');
const employeesRoutes = require('./routes/employees.routes');
const hrDocumentsRoutes = require('./routes/hr-documents.routes');
const restaurantRoutes = require('./routes/restaurant.routes'); // secteur restauration : carte, tables, QR, réglages
const restaurantCommandes = require('./routes/restaurant.commandes.routes'); // commandes QR, validation caisse, tableau des tables
const patientsCliniqueRoutes = require('./routes/patients_clinique.routes');
const rendezvousCliniqueRoutes = require('./routes/rendezvous_clinique.routes');
const consultationsCliniqueRoutes = require('./routes/consultations_clinique.routes');
const facturationCliniqueRoutes = require('./routes/facturation_clinique.routes');
const pharmacieCliniqueRoutes = require('./routes/pharmacie_clinique.routes');
const examensCliniqueRoutes = require('./routes/examens_clinique.routes');
const hospitalisationCliniqueRoutes = require('./routes/hospitalisation_clinique.routes');
const materniteVaccinationCliniqueRoutes = require('./routes/maternite_vaccination_clinique.routes'); // clinique : grossesse, accouchement, nouveau-nés, vaccins, carnet
const planningCliniqueRoutes = require('./routes/planning_clinique.routes');
const portailCliniqueRoutes = require('./routes/portail_clinique.routes'); // clinique : portail patient (personnel et patient)
const alertesRapportsCliniqueRoutes = require('./routes/alertes_rapports_clinique.routes'); // clinique : alertes, rapport d'activité // clinique : planning, gardes, primes // clinique : lits, admissions, surveillance, sortie, urgences // clinique : examens, résultats, validation, publication, pièces jointes // clinique : pharmacie interne, entrées, sorties FEFO, consommables // clinique : actes, tarifs, honoraires, rapports de recettes // clinique : consultations, signature, documents médicaux, modèles // clinique : agenda, rendez-vous, liste d'attente, file et écran d'appel

const app = express();

app.set('trust proxy', 1);

// Force HTTPS en production (Render passe par un proxy, donc on lit x-forwarded-proto).
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

// En production, seule l'origine du frontend déployé est autorisée.
// CORS_ORIGIN peut contenir plusieurs origines séparées par des virgules.
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').filter(Boolean);

app.use(helmet());
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
  })
);
// Limite relevée à 3 Mo (au lieu des 100 Ko par défaut d'Express) pour
// accepter le logo de l'entreprise encodé en base64 dans le JSON.
app.use(express.json({ limit: '3mb' }));
app.use(morgan('dev'));
// Charte personnalisée du commerçant connecté : mise à disposition des PDF pendant la requête (voir utils/brandingContext.js).
app.use(brandingContext);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/auth', authRoutes);
app.use('/products', productsRoutes);
app.use('/clients', clientsRoutes);
app.use('/orders', ordersRoutes);
app.use('/users', usersRoutes);
app.use('/suppliers', suppliersRoutes);
app.use('/purchase-orders', purchaseOrdersRoutes);
app.use('/activity', activityRoutes);
app.use('/inventory-sessions', inventorySessionsRoutes);
app.use('/credit-requests', creditRequestsRoutes);
app.use('/cash', cashRoutes);
app.use('/events', eventsRoutes);
app.use('/alerts', alertsRoutes);
app.use('/push', pushRoutes);
app.use('/merchant', merchantRoutes);
app.use('/admin', adminRoutes);
app.use('/salaries', salariesRoutes);
app.use('/warehouses', warehousesRoutes);
app.use('/stock-transfers', stockTransfersRoutes);
app.use('/categories', categoriesRoutes);
app.use('/prescriptions', prescriptionsRoutes);
app.use('/returns', returnsRoutes);
app.use('/payroll', payrollRoutes);
app.use('/insurers', insurersRoutes);
app.use('/zakat', zakatRoutes);
app.use('/maintenance', maintenanceRoutes); // public : état de maintenance d'un secteur
app.use('/accounting', accountingRoutes); // module comptabilité (activé par l'owner)
app.use('/modules', modulesRoutes); // modules activés par l'owner (menu latéral)
app.use('/employees', employeesRoutes); // fiches employés, absences, heures sup, avances (module Paie)
app.use('/hr-documents', hrDocumentsRoutes); // documents RH : attestations, certificats, contrats (module Paie)
app.use('/restaurant', restaurantRoutes.router); // restauration : import de la carte, tables, QR, réglages
app.use('/public', restaurantRoutes.publicRouter); // restauration : menu public par QR (sans connexion)
app.use('/restaurant', restaurantCommandes.router);
app.use('/public', restaurantCommandes.publicRouter);
app.use('/clinique', patientsCliniqueRoutes);
app.use('/clinique', rendezvousCliniqueRoutes);
app.use('/clinique', consultationsCliniqueRoutes);
app.use('/clinique', facturationCliniqueRoutes);
app.use('/clinique', pharmacieCliniqueRoutes);
app.use('/clinique', examensCliniqueRoutes);
app.use('/clinique', hospitalisationCliniqueRoutes);
app.use('/clinique', materniteVaccinationCliniqueRoutes);
app.use('/clinique', planningCliniqueRoutes);
app.use('/clinique', portailCliniqueRoutes.staff);
app.use('/portail', portailCliniqueRoutes.patient); // portail patient : sans compte du personnel
app.use('/clinique', alertesRapportsCliniqueRoutes); // clinique : patients, dossier léger, journal d'accès (secteur clinique uniquement)

// Gestion des routes inconnues
app.use((req, res) => {
  res.status(404).json({ error: 'Ressource introuvable.' });
});

// Gestionnaire d'erreurs global
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

module.exports = app;
