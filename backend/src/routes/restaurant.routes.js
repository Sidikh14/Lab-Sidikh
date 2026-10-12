// Routes du secteur restauration : import de la carte, tables et QR codes, réglages, menu public par QR.
// Montage dans app.js :
//   const restaurant = require('./routes/restaurant.routes');
//   app.use('/restaurant', restaurant.router);
//   app.use('/public', restaurant.publicRouter);
const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { validerMenu, importerMenu } = require('../utils/menuImport');
const { genererQrToken } = require('../utils/qrToken');

const router = express.Router();
const publicRouter = express.Router();

// URL publique de l'application (frontend). À définir dans les variables d'environnement Render.
const URL_PUBLIQUE = process.env.PUBLIC_APP_URL || 'https://gestock-bfdn.vercel.app';

// Vérifie que le commerce connecté est bien un restaurant.
async function exigerRestaurant(req, res, next) {
  if (req.user.sector !== 'restauration') {
    return res.status(400).json({ error: 'Cette fonction est réservée aux restaurants.' });
  }
  next();
}

// ---------- Import de la carte (manager) ----------

// POST /restaurant/menu/import — corps : { categories: [...] } (voir menuImport.js)
// Dry run possible : ?verifier=1 valide sans rien écrire.
router.post('/menu/import', authenticate, requireRole('manager'), exigerRestaurant, async (req, res) => {
  const validation = validerMenu(req.body);
  if (!validation.ok) {
    return res.status(400).json({ error: 'Fichier de carte invalide.', erreurs: validation.erreurs });
  }
  if (req.query.verifier === '1') {
    return res.json({ ok: true, message: 'Fichier valide, rien n\'a été importé.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rapport = await importerMenu(client, req.user.merchantId, validation.menu);
    await client.query('COMMIT');
    res.status(201).json(rapport);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de l\'import de la carte. Aucune donnée n\'a été enregistrée.' });
  } finally {
    client.release();
  }
});

// ---------- Tables et QR codes (manager, gérant) ----------

// GET /restaurant/tables
router.get('/tables', authenticate, requireRole('manager', 'gerant'), exigerRestaurant, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, label, capacity, is_active, qr_token, warehouse_id, created_at
         FROM dining_tables WHERE merchant_id = $1 ORDER BY label`,
      [req.user.merchantId]
    );
    res.json(rows.map((t) => ({ ...t, qrUrl: `${URL_PUBLIQUE}/menu/${t.qr_token}` })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture des tables.' });
  }
});

// POST /restaurant/tables — { label, capacity, warehouseId }
router.post('/tables', authenticate, requireRole('manager'), exigerRestaurant, async (req, res) => {
  const label = typeof req.body.label === 'string' ? req.body.label.trim() : '';
  const capacity = Number.isInteger(req.body.capacity) ? req.body.capacity : 2;
  const warehouseId = req.body.warehouseId;
  if (!label || label.length > 60) return res.status(400).json({ error: 'Libellé de table requis (60 caractères maximum).' });
  if (capacity < 1 || capacity > 50) return res.status(400).json({ error: 'Capacité invalide (1 à 50).' });
  if (!warehouseId) return res.status(400).json({ error: 'La boutique de la table est requise.' });
  try {
    const boutique = await pool.query(
      'SELECT id FROM warehouses WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE',
      [warehouseId, req.user.merchantId]
    );
    if (!boutique.rows.length) return res.status(404).json({ error: 'Boutique introuvable.' });
    const { rows } = await pool.query(
      `INSERT INTO dining_tables (merchant_id, label, capacity, qr_token, warehouse_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, label, capacity, is_active, qr_token, warehouse_id`,
      [req.user.merchantId, label, capacity, genererQrToken(), warehouseId]
    );
    res.status(201).json({ ...rows[0], qrUrl: `${URL_PUBLIQUE}/menu/${rows[0].qr_token}` });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Une table porte déjà ce nom.' });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création de la table.' });
  }
});

// POST /restaurant/tables/:id/regenerer-qr — invalide l'ancien QR (ex. QR photographié ou partagé)
router.post('/tables/:id/regenerer-qr', authenticate, requireRole('manager'), exigerRestaurant, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE dining_tables SET qr_token = $1 WHERE id = $2 AND merchant_id = $3
       RETURNING id, label, qr_token`,
      [genererQrToken(), req.params.id, req.user.merchantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Table introuvable.' });
    res.json({ ...rows[0], qrUrl: `${URL_PUBLIQUE}/menu/${rows[0].qr_token}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la régénération du QR.' });
  }
});

// PATCH /restaurant/tables/:id — { isActive }
router.patch('/tables/:id', authenticate, requireRole('manager'), exigerRestaurant, async (req, res) => {
  if (typeof req.body.isActive !== 'boolean') return res.status(400).json({ error: 'isActive requis (booléen).' });
  try {
    const { rows } = await pool.query(
      'UPDATE dining_tables SET is_active = $1 WHERE id = $2 AND merchant_id = $3 RETURNING id, label, is_active',
      [req.body.isActive, req.params.id, req.user.merchantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Table introuvable.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la table.' });
  }
});

// ---------- Réglages du restaurant ----------

// GET /restaurant/settings — lecture par le manager et le gérant
router.get('/settings', authenticate, requireRole('manager', 'gerant'), exigerRestaurant, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM restaurant_settings WHERE merchant_id = $1', [req.user.merchantId]);
    res.json(rows[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture des réglages.' });
  }
});

// PATCH /restaurant/settings/stock-mode — réservé au propriétaire de la plateforme (admin)
// Corps : { merchantId, stockMode: 'simple' | 'complet' }
router.patch('/settings/stock-mode', authenticate, requireRole('owner'), async (req, res) => {
  const { merchantId, stockMode } = req.body;
  if (!merchantId || !['simple', 'complet'].includes(stockMode)) {
    return res.status(400).json({ error: 'merchantId et stockMode (simple ou complet) requis.' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE restaurant_settings SET stock_mode = $1, updated_at = now()
        WHERE merchant_id = $2 RETURNING merchant_id, stock_mode`,
      [stockMode, merchantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Restaurant introuvable.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du niveau de stock.' });
  }
});

// ---------- Menu public par QR (sans connexion) ----------

// GET /public/menu/:token — carte de la table et du restaurant. Aucune donnée interne :
// ni coût, ni stock, ni TVA. Prix TTC uniquement.
publicRouter.get('/menu/:token', async (req, res) => {
  try {
    const table = await pool.query(
      `SELECT t.id, t.label, t.merchant_id, m.business_name
         FROM dining_tables t JOIN merchants m ON m.id = t.merchant_id
        WHERE t.qr_token = $1 AND t.is_active = TRUE`,
      [req.params.token]
    );
    if (!table.rows.length) return res.status(404).json({ error: 'Table introuvable ou QR désactivé.' });
    const t = table.rows[0];

    const plats = await pool.query(
      `SELECT p.id, p.name, p.description, p.ingredients_text, p.unit_price AS price,
              p.course, p.station, p.attributes, c.name AS categorie
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.merchant_id = $1 AND p.is_dish = TRUE AND p.is_active = TRUE AND p.available = TRUE
        ORDER BY c.name, p.name`,
      [t.merchant_id]
    );

    const options = await pool.query(
      `SELECT l.product_id, g.id AS group_id, g.name AS group_name, g.selection_mode, g.required,
              g.min_choices, g.max_choices, o.name AS option_name, o.price_delta
         FROM product_group_links l
         JOIN product_option_groups g ON g.id = l.group_id
         LEFT JOIN product_options o ON o.group_id = g.id
        WHERE g.merchant_id = $1
        ORDER BY g.name, o.position`,
      [t.merchant_id]
    );

    const optionsParPlat = {};
    for (const o of options.rows) {
      const groupes = (optionsParPlat[o.product_id] = optionsParPlat[o.product_id] || {});
      const g = (groupes[o.group_id] = groupes[o.group_id] || {
        name: o.group_name, mode: o.selection_mode, required: o.required,
        min: o.min_choices, max: o.max_choices, choices: [],
      });
      if (o.option_name) g.choices.push({ name: o.option_name, priceDelta: o.price_delta });
    }

    res.json({
      restaurant: t.business_name,
      table: t.label,
      plats: plats.rows.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        ingredients: p.ingredients_text,
        price: p.price,               // TTC
        categorie: p.categorie,
        service: p.course,
        allergenes: p.attributes?.allergens || [],
        regimes: p.attributes?.regimes || [],
        options: Object.values(optionsParPlat[p.id] || {}),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du chargement de la carte.' });
  }
});

module.exports = { router, publicRouter };
