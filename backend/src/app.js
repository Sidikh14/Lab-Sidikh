const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

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

const app = express();

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
