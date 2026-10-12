// Routes du secteur restauration : import de la carte, tables et QR codes, réglages, menu public par QR.
// Un commerçant = un compte ; ses restaurants sont ses boutiques (warehouses).
// Montage dans app.js :
//   const restaurant = require('./routes/restaurant.routes');
//   app.use('/restaurant', restaurant.router);
//   app.use('/public', restaurant.publicRouter);
// Dépend de la migration 091 (table product_warehouses) pour le menu public.
const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { validerMenu, importerMenu } = require('../utils/menuImport');
const { genererQrToken } = require('../utils/qrToken');

const router = express.Router();
const publicRouter = express.Router();

// Gestion de la carte et des tables : le manager et le gérant.
const ROLES_CARTE = ['manager', 'gerant'];

// URL publique de l'application (frontend). À définir dans les variables d'environnement Render.
const URL_PUBLIQUE = process.env.PUBLIC_APP_URL || 'https://gestock-bfdn.vercel.app';

// Vérifie que le commerce connecté est bien un restaurant.
async function exigerRestaurant(req, res, next) {
  if (req.user.sector !== 'restauration') {
    return res.status(400).json({ error: 'Cette fonction est réservée aux restaurants.' });
  }
  next();
}

// Vérifie qu'une boutique appartient au commerce connecté, est active, et que la personne y a accès :
// le manager voit tous les restaurants du commerce, le gérant seulement ceux qui lui sont affectés.
async function boutiqueDuCommerce(warehouseId, user) {
  if (user.role !== 'manager' && !user.warehouseIds.includes(warehouseId)) return false;
  const { rows } = await pool.query(
    'SELECT id FROM warehouses WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE',
    [warehouseId, user.merchantId]
  );
  return rows.length > 0;
}

// Restaurants visibles par la personne : null = tous (manager), sinon la liste de ses lieux.
function restaurantsVisibles(user) {
  return user.role === 'manager' ? null : user.warehouseIds;
}

// ---------- Import de la carte (manager, gérant) ----------

// POST /restaurant/menu/import — corps : { warehouseId, categories: [...] } (voir menuImport.js)
// Les plats importés sont rattachés au restaurant (boutique) indiqué.
// Dry run possible : ?verifier=1 valide sans rien écrire.
router.post('/menu/import', authenticate, requireRole(...ROLES_CARTE), exigerRestaurant, async (req, res) => {
  const { warehouseId } = req.body;
  if (!warehouseId) return res.status(400).json({ error: 'Le restaurant de la carte est requis.' });
  if (!(await boutiqueDuCommerce(warehouseId, req.user))) {
    return res.status(404).json({ error: 'Restaurant introuvable.' });
  }

  const validation = validerMenu(req.body);
  if (!validation.ok) {
    return res.status(400).json({ error: 'Fichier de carte invalide.', erreurs: validation.erreurs });
  }
  if (req.query.verifier === '1') {
    return res.json({ ok: true, message: "Fichier valide, rien n'a été importé." });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // importerMenu doit accepter warehouseId et lier les plats créés à ce restaurant (voir product_warehouses).
    const rapport = await importerMenu(client, req.user.merchantId, validation.menu, warehouseId);
    await client.query('COMMIT');
    res.status(201).json(rapport);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'import de la carte. Aucune donnée n'a été enregistrée." });
  } finally {
    client.release();
  }
});

// ---------- Carte d'un restaurant (manager, gérant) ----------

// GET /restaurant/menu?warehouseId=... — plats à la carte de CE restaurant, avec leur disponibilité ici.
router.get('/menu', authenticate, requireRole(...ROLES_CARTE), exigerRestaurant, async (req, res) => {
  const { warehouseId } = req.query;
  if (!warehouseId) return res.status(400).json({ error: 'Le restaurant est requis.' });
  try {
    if (!(await boutiqueDuCommerce(warehouseId, req.user))) {
      return res.status(404).json({ error: 'Restaurant introuvable.' });
    }
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.description, p.ingredients_text, p.unit_price AS price, p.course, p.station,
              p.attributes, c.name AS categorie, pw.available AS disponible_ici,
              (SELECT COUNT(*)::int FROM product_warehouses x WHERE x.product_id = p.id) AS nb_restaurants
         FROM product_warehouses pw
         JOIN products p ON p.id = pw.product_id
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE pw.warehouse_id = $1 AND pw.merchant_id = $2 AND p.is_dish = TRUE AND p.is_active = TRUE
        ORDER BY c.name NULLS LAST, p.name`,
      [warehouseId, req.user.merchantId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture de la carte.' });
  }
});

// PATCH /restaurant/menu/:productId/disponibilite — { warehouseId, available } : rupture ou retour d'un plat dans CE restaurant.
router.patch('/menu/:productId/disponibilite', authenticate, requireRole(...ROLES_CARTE), exigerRestaurant, async (req, res) => {
  const { warehouseId, available } = req.body;
  if (!warehouseId || typeof available !== 'boolean') {
    return res.status(400).json({ error: 'warehouseId et available (booléen) requis.' });
  }
  try {
    if (!(await boutiqueDuCommerce(warehouseId, req.user))) {
      return res.status(404).json({ error: 'Restaurant introuvable.' });
    }
    const { rows } = await pool.query(
      `UPDATE product_warehouses SET available = $1
        WHERE product_id = $2 AND warehouse_id = $3 AND merchant_id = $4
        RETURNING product_id, warehouse_id, available`,
      [available, req.params.productId, warehouseId, req.user.merchantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Plat introuvable dans ce restaurant.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la disponibilité.' });
  }
});

// PATCH /restaurant/menu/:productId — { name?, price?, description?, ingredients? }
// Le plat et son prix sont communs à tous les restaurants où il figure : le gérant ne peut donc le modifier
// que si le plat n'est présent que dans les restaurants qui lui sont affectés (le manager, toujours).
router.patch('/menu/:productId', authenticate, requireRole(...ROLES_CARTE), exigerRestaurant, async (req, res) => {
  const { name, price, description, ingredients } = req.body;
  const champs = [];
  const valeurs = [];
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim() || name.length > 150) return res.status(400).json({ error: 'Nom invalide.' });
    valeurs.push(name.trim()); champs.push(`name = $${valeurs.length}`);
  }
  if (price !== undefined) {
    const n = Number(price);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'Prix TTC invalide.' });
    valeurs.push(Math.round(n)); champs.push(`unit_price = $${valeurs.length}`);
  }
  for (const [cle, colonne] of [['description', 'description'], ['ingredients', 'ingredients_text']]) {
    const v = req.body[cle];
    if (v === undefined) continue;
    if (v !== null && (typeof v !== 'string' || v.length > 500)) return res.status(400).json({ error: `${cle} invalide (500 caractères maximum).` });
    valeurs.push(v ? v.trim() : null); champs.push(`${colonne} = $${valeurs.length}`);
  }
  if (!champs.length) return res.status(400).json({ error: 'Aucune modification.' });
  try {
    const visibles = restaurantsVisibles(req.user);
    const horsPerimetre = await pool.query(
      `SELECT 1 FROM product_warehouses
        WHERE product_id = $1 AND merchant_id = $2 AND $3::uuid[] IS NOT NULL AND NOT (warehouse_id = ANY($3::uuid[])) LIMIT 1`,
      [req.params.productId, req.user.merchantId, visibles]
    );
    if (horsPerimetre.rows.length) {
      return res.status(403).json({ error: "Ce plat figure aussi à la carte d'un restaurant qui ne vous est pas affecté. Demandez au propriétaire." });
    }
    valeurs.push(req.params.productId, req.user.merchantId);
    const { rows } = await pool.query(
      `UPDATE products SET ${champs.join(', ')}, updated_at = now()
        WHERE id = $${valeurs.length - 1} AND merchant_id = $${valeurs.length} AND is_dish = TRUE
        RETURNING id, name, unit_price AS price, description, ingredients_text`,
      valeurs
    );
    if (!rows.length) return res.status(404).json({ error: 'Plat introuvable.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la modification du plat.' });
  }
});

// ---------- Tables et QR codes (manager, gérant) ----------

// GET /restaurant/tables
router.get('/tables', authenticate, requireRole(...ROLES_CARTE), exigerRestaurant, async (req, res) => {
  try {
    const visibles = restaurantsVisibles(req.user);
    const { rows } = await pool.query(
      `SELECT id, label, capacity, is_active, qr_token, warehouse_id, created_at
         FROM dining_tables
        WHERE merchant_id = $1 AND ($2::uuid[] IS NULL OR warehouse_id = ANY($2::uuid[]))
        ORDER BY label`,
      [req.user.merchantId, visibles]
    );
    res.json(rows.map((t) => ({ ...t, qrUrl: `${URL_PUBLIQUE}/menu/${t.qr_token}` })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture des tables.' });
  }
});

// POST /restaurant/tables — { label, capacity, warehouseId }
router.post('/tables', authenticate, requireRole(...ROLES_CARTE), exigerRestaurant, async (req, res) => {
  const label = typeof req.body.label === 'string' ? req.body.label.trim() : '';
  const capacity = Number.isInteger(req.body.capacity) ? req.body.capacity : 2;
  const warehouseId = req.body.warehouseId;
  if (!label || label.length > 60) return res.status(400).json({ error: 'Libellé de table requis (60 caractères maximum).' });
  if (capacity < 1 || capacity > 50) return res.status(400).json({ error: 'Capacité invalide (1 à 50).' });
  if (!warehouseId) return res.status(400).json({ error: 'La boutique de la table est requise.' });
  try {
    if (!(await boutiqueDuCommerce(warehouseId, req.user))) {
      return res.status(404).json({ error: 'Boutique introuvable.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO dining_tables (merchant_id, label, capacity, qr_token, warehouse_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, label, capacity, is_active, qr_token, warehouse_id`,
      [req.user.merchantId, label, capacity, genererQrToken(), warehouseId]
    );
    res.status(201).json({ ...rows[0], qrUrl: `${URL_PUBLIQUE}/menu/${rows[0].qr_token}` });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Une table porte déjà ce nom dans ce restaurant.' });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création de la table.' });
  }
});

// POST /restaurant/tables/:id/regenerer-qr — invalide l'ancien QR (ex. QR photographié ou partagé)
router.post('/tables/:id/regenerer-qr', authenticate, requireRole(...ROLES_CARTE), exigerRestaurant, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE dining_tables SET qr_token = $1 WHERE id = $2 AND merchant_id = $3
         AND ($4::uuid[] IS NULL OR warehouse_id = ANY($4::uuid[]))
       RETURNING id, label, qr_token`,
      [genererQrToken(), req.params.id, req.user.merchantId, restaurantsVisibles(req.user)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Table introuvable.' });
    res.json({ ...rows[0], qrUrl: `${URL_PUBLIQUE}/menu/${rows[0].qr_token}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la régénération du QR.' });
  }
});

// PATCH /restaurant/tables/:id — { isActive }
router.patch('/tables/:id', authenticate, requireRole(...ROLES_CARTE), exigerRestaurant, async (req, res) => {
  if (typeof req.body.isActive !== 'boolean') return res.status(400).json({ error: 'isActive requis (booléen).' });
  try {
    const { rows } = await pool.query(
      `UPDATE dining_tables SET is_active = $1
        WHERE id = $2 AND merchant_id = $3 AND ($4::uuid[] IS NULL OR warehouse_id = ANY($4::uuid[]))
        RETURNING id, label, is_active`,
      [req.body.isActive, req.params.id, req.user.merchantId, restaurantsVisibles(req.user)]
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
router.get('/settings', authenticate, requireRole(...ROLES_CARTE), exigerRestaurant, async (req, res) => {
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

// GET /public/menu/:token — carte du restaurant de la table. Seuls les plats rattachés à CE restaurant
// (product_warehouses, migration 091) et disponibles aujourd'hui sont montrés.
// Aucune donnée interne : ni coût, ni stock, ni TVA. Prix TTC uniquement.
publicRouter.get('/menu/:token', async (req, res) => {
  try {
    const table = await pool.query(
      `SELECT t.id, t.label, t.merchant_id, t.warehouse_id, m.business_name
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
         JOIN product_warehouses pw ON pw.product_id = p.id AND pw.warehouse_id = $2
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.merchant_id = $1 AND p.is_dish = TRUE AND p.is_active = TRUE
          AND p.available = TRUE AND pw.available = TRUE
        ORDER BY c.name, p.name`,
      [t.merchant_id, t.warehouse_id]
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
