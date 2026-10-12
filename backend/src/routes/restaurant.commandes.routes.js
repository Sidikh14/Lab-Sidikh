// Commandes passées depuis le QR de table, validation par la caisse, tableau des tables.
// Montage dans app.js (en plus de restaurant.routes) :
//   const restaurantCommandes = require('./routes/restaurant.commandes.routes');
//   app.use('/restaurant', restaurantCommandes.router);
//   app.use('/public', restaurantCommandes.publicRouter);
const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { broadcast } = require('../utils/eventsBus');
const { validerSelections } = require('../utils/selectionOptions');

const router = express.Router();
const publicRouter = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Limite simple en mémoire (une seule instance du serveur). À remplacer par un stockage partagé si plusieurs instances.
const compteurs = new Map();
function dansLaLimite(cle, max, fenetreMs) {
  const maintenant = Date.now();
  if (compteurs.size > 10000) compteurs.clear();
  const entree = compteurs.get(cle) || { debut: maintenant, n: 0 };
  if (maintenant - entree.debut > fenetreMs) {
    entree.debut = maintenant;
    entree.n = 0;
  }
  entree.n += 1;
  compteurs.set(cle, entree);
  return entree.n <= max;
}

async function exigerRestaurant(req, res, next) {
  if (req.user.sector !== 'restauration') {
    return res.status(400).json({ error: 'Cette fonction est réservée aux restaurants.' });
  }
  next();
}

// Options (groupes et choix) d'un plat, dans le format attendu par selectionOptions.js.
async function chargerGroupes(client, productId, merchantId) {
  const { rows } = await client.query(
    `SELECT g.id, g.name, g.selection_mode, g.required, g.min_choices, g.max_choices,
            o.id AS option_id, o.name AS option_name, o.price_delta
       FROM product_group_links l
       JOIN product_option_groups g ON g.id = l.group_id
       LEFT JOIN product_options o ON o.group_id = g.id
      WHERE l.product_id = $1 AND g.merchant_id = $2
      ORDER BY g.name, o.position`,
    [productId, merchantId]
  );
  const groupes = new Map();
  for (const r of rows) {
    if (!groupes.has(r.id)) {
      groupes.set(r.id, {
        id: r.id, name: r.name, mode: r.selection_mode, required: r.required,
        min: r.min_choices, max: r.max_choices, options: [],
      });
    }
    if (r.option_id) {
      groupes.get(r.id).options.push({ id: r.option_id, name: r.option_name, priceDelta: Number(r.price_delta) });
    }
  }
  return [...groupes.values()];
}

// Prix TTC du moment : règle horaire, puis prix du jour, sinon prix de base.
// L'heure est celle du serveur (UTC, identique à Dakar).
async function prixDuMoment(client, productId, merchantId, prixBase) {
  const heure = new Date().toISOString().slice(11, 19);
  const regle = await client.query(
    `SELECT price FROM product_price_rules
      WHERE product_id = $1 AND merchant_id = $2 AND start_time <= $3::time AND end_time > $3::time
      ORDER BY start_time LIMIT 1`,
    [productId, merchantId, heure]
  );
  if (regle.rows[0]) return Number(regle.rows[0].price);
  const jour = await client.query(
    `SELECT price_override FROM product_availability
      WHERE product_id = $1 AND merchant_id = $2 AND available_on = CURRENT_DATE`,
    [productId, merchantId]
  );
  if (jour.rows[0] && jour.rows[0].price_override !== null) return Number(jour.rows[0].price_override);
  return Number(prixBase);
}

async function tableDuToken(token) {
  const { rows } = await pool.query(
    `SELECT id, label, merchant_id, warehouse_id FROM dining_tables WHERE qr_token = $1 AND is_active = TRUE`,
    [token]
  );
  return rows[0] || null;
}

// ---------- Public : commande depuis le QR (sans connexion) ----------

// POST /public/table/:token/commande
// Corps : { clientOrderId (UUID), notes, items: [{ productId, quantity, choix: [{ groupId, optionIds }], note }] }
publicRouter.post('/table/:token/commande', async (req, res) => {
  const { items, notes, clientOrderId } = req.body;
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
    return res.status(400).json({ error: 'La commande doit contenir de 1 à 30 plats.' });
  }
  if (clientOrderId !== undefined && !UUID.test(String(clientOrderId))) {
    return res.status(400).json({ error: 'Identifiant de commande invalide.' });
  }
  if (!dansLaLimite(`ip:${req.ip}`, 10, 60000) || !dansLaLimite(`table:${req.params.token}`, 60, 60000)) {
    return res.status(429).json({ error: 'Trop de commandes. Patientez un instant puis réessayez.' });
  }

  const table = await tableDuToken(req.params.token);
  if (!table) return res.status(404).json({ error: 'Table introuvable ou QR désactivé.' });
  if (!table.warehouse_id) return res.status(400).json({ error: 'Cette table n\'est pas encore configurée.' });

  const client = await pool.connect();
  try {
    if (clientOrderId) {
      const deja = await client.query(
        'SELECT id, subtotal_amount, qr_status FROM orders WHERE client_order_id = $1 AND merchant_id = $2',
        [clientOrderId, table.merchant_id]
      );
      if (deja.rows[0]) {
        return res.status(200).json({ orderId: deja.rows[0].id, status: deja.rows[0].qr_status, total: Number(deja.rows[0].subtotal_amount) });
      }
    }

    await client.query('BEGIN');

    const lignes = [];
    for (const it of items) {
      const quantite = Number.isInteger(it.quantity) && it.quantity >= 1 && it.quantity <= 20 ? it.quantity : null;
      if (!quantite) throw { status: 400, message: 'Quantité invalide (1 à 20).' };

      const produit = await client.query(
        `SELECT id, name, unit_price, cost_price FROM products
          WHERE id = $1 AND merchant_id = $2 AND is_dish = TRUE AND is_active = TRUE AND available = TRUE`,
        [it.productId, table.merchant_id]
      );
      if (!produit.rows[0]) throw { status: 400, message: 'Un plat de votre commande n\'est plus disponible.' };
      const p = produit.rows[0];

      const groupes = await chargerGroupes(client, p.id, table.merchant_id);
      const v = validerSelections(groupes, Array.isArray(it.choix) ? it.choix : []);
      if (!v.ok) throw { status: 400, message: `${p.name} : ${v.erreurs.join(' ')}` };

      const base = await prixDuMoment(client, p.id, table.merchant_id, p.unit_price);
      const unitaire = Math.round(base + v.supplement);
      const note = typeof it.note === 'string' ? it.note.trim().slice(0, 200) || null : null;
      lignes.push({ produit: p, quantite, base, unitaire, retenues: v.retenues, note });
    }

    const total = lignes.reduce((s, l) => s + l.unitaire * l.quantite, 0);

    // TVA : non calculée ici. La règle de TVA des commandes restaurant reste à valider (voir dossier).
    const commande = await client.query(
      `INSERT INTO orders (merchant_id, client_id, created_by, status, subtotal_amount, tva_applicable, tva_rate,
                           tva_amount, total_amount, notes, stock_override, client_order_id, warehouse_id,
                           tva_regime, precompte_amount, source, dining_table_id, qr_status)
       VALUES ($1, NULL, NULL, 'en_attente', $2, FALSE, 0, 0, $2, $3, FALSE, $4, $5, 'normal', 0, 'qr', $6, 'a_valider')
       RETURNING id, created_at`,
      [table.merchant_id, total, typeof notes === 'string' ? notes.trim().slice(0, 300) || null : null,
       clientOrderId || null, table.warehouse_id, table.id]
    );
    const commandeId = commande.rows[0].id;

    for (const l of lignes) {
      const ligne = await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, original_unit_price,
                                  packaging_label, packaging_quantity, unit_cost, note)
         VALUES ($1, $2, $3, $4, $5, NULL, 1, $6, $7) RETURNING id`,
        [commandeId, l.produit.id, l.quantite, l.unitaire, l.base, Number(l.produit.cost_price) || 0, l.note]
      );
      for (const r of l.retenues) {
        await client.query(
          `INSERT INTO order_item_options (order_item_id, group_name, option_name, price_delta)
           VALUES ($1, $2, $3, $4)`,
          [ligne.rows[0].id, r.groupe, r.option, r.priceDelta]
        );
      }
    }

    await client.query('COMMIT');

    broadcast(table.merchant_id, 'order:qr', {
      orderId: commandeId,
      warehouseId: table.warehouse_id,
      tableId: table.id,
      tableLabel: table.label,
      total,
      createdAt: commande.rows[0].created_at,
      items: lignes.map((l) => ({
        name: l.produit.name,
        quantity: l.quantite,
        options: l.retenues.map((r) => r.option),
        note: l.note,
      })),
    });

    res.status(201).json({ orderId: commandeId, status: 'a_valider', total });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de l\'envoi de la commande. Réessayez ou appelez le serveur.' });
  } finally {
    client.release();
  }
});

// GET /public/table/:token/commande/:orderId — suivi de la commande par le client
publicRouter.get('/table/:token/commande/:orderId', async (req, res) => {
  if (!UUID.test(req.params.orderId)) return res.status(400).json({ error: 'Identifiant invalide.' });
  const table = await tableDuToken(req.params.token);
  if (!table) return res.status(404).json({ error: 'Table introuvable.' });
  try {
    const { rows } = await pool.query(
      `SELECT id, status, qr_status, subtotal_amount FROM orders
        WHERE id = $1 AND dining_table_id = $2 AND merchant_id = $3`,
      [req.params.orderId, table.id, table.merchant_id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Commande introuvable.' });
    res.json({ orderId: rows[0].id, qrStatus: rows[0].qr_status, total: Number(rows[0].subtotal_amount) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du suivi de la commande.' });
  }
});

// ---------- Caisse : commandes à valider et tableau des tables ----------

// Boutique visible : le caissier et le gérant voient leur boutique ; le manager peut choisir.
function boutiqueDemandee(req) {
  if (req.user.role === 'manager') return req.query.warehouseId || null;
  return req.user.warehouseId || null;
}

// GET /restaurant/commandes-qr?statut=a_valider|acceptee&warehouseId=...
router.get('/commandes-qr', authenticate, requireRole('manager', 'gerant', 'caissier', 'vendeur_caissier'), exigerRestaurant, async (req, res) => {
  const statut = req.query.statut === 'acceptee' ? 'acceptee' : 'a_valider';
  const warehouseId = boutiqueDemandee(req);
  if (!warehouseId) return res.status(400).json({ error: 'Boutique requise.' });
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.total_amount AS total, o.qr_status, o.notes, o.created_at, t.label AS table_label, t.id AS table_id
         FROM orders o JOIN dining_tables t ON t.id = o.dining_table_id
        WHERE o.merchant_id = $1 AND o.warehouse_id = $2 AND o.source = 'qr' AND o.qr_status = $3
        ORDER BY o.created_at`,
      [req.user.merchantId, warehouseId, statut]
    );
    const ids = rows.map((r) => r.id);
    const lignes = ids.length
      ? (await pool.query(
          `SELECT oi.order_id, p.name, oi.quantity, oi.note,
                  COALESCE((SELECT json_agg(oo.option_name ORDER BY oo.group_name, oo.option_name)
                              FROM order_item_options oo WHERE oo.order_item_id = oi.id), '[]') AS options
             FROM order_items oi JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = ANY($1)
            ORDER BY oi.id`,
          [ids]
        )).rows
      : [];
    res.json(rows.map((r) => ({
      ...r,
      items: lignes.filter((l) => l.order_id === r.id).map(({ order_id, ...l }) => l),
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture des commandes.' });
  }
});

// PATCH /restaurant/commandes-qr/:id — { action: 'accepter' | 'refuser', motif? }
// Accepter : la commande part en cuisine. Refuser : rien ne part en cuisine, la commande est annulée.
router.patch('/commandes-qr/:id', authenticate, requireRole('manager', 'gerant', 'caissier', 'vendeur_caissier'), exigerRestaurant, async (req, res) => {
  const { action, motif } = req.body;
  if (!['accepter', 'refuser'].includes(action)) return res.status(400).json({ error: 'Action invalide.' });
  if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  try {
    const { rows } = await pool.query(
      `SELECT id, warehouse_id, qr_status FROM orders WHERE id = $1 AND merchant_id = $2 AND source = 'qr'`,
      [req.params.id, req.user.merchantId]
    );
    const commande = rows[0];
    if (!commande) return res.status(404).json({ error: 'Commande introuvable.' });
    if (req.user.role !== 'manager' && commande.warehouse_id !== req.user.warehouseId) {
      return res.status(403).json({ error: 'Cette commande ne concerne pas votre boutique.' });
    }
    if (commande.qr_status !== 'a_valider') return res.status(400).json({ error: 'Cette commande a déjà été traitée.' });

    if (action === 'accepter') {
      await pool.query(
        `UPDATE orders SET qr_status = 'acceptee', qr_decided_at = now(), qr_decided_by = $1 WHERE id = $2`,
        [req.user.id, commande.id]
      );
      broadcast(req.user.merchantId, 'order:qr:acceptee', { orderId: commande.id, warehouseId: commande.warehouse_id });
      return res.json({ orderId: commande.id, qrStatus: 'acceptee' });
    }

    const raison = typeof motif === 'string' ? motif.trim().slice(0, 200) : '';
    await pool.query(
      `UPDATE orders SET qr_status = 'refusee', status = 'annulee', qr_decided_at = now(), qr_decided_by = $1,
              notes = TRIM(BOTH FROM COALESCE(notes, '') || ' [Refusée : ' || $2 || ']')
        WHERE id = $3`,
      [req.user.id, raison || 'sans motif', commande.id]
    );
    broadcast(req.user.merchantId, 'order:qr:refusee', { orderId: commande.id, warehouseId: commande.warehouse_id, motif: raison });
    res.json({ orderId: commande.id, qrStatus: 'refusee' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du traitement de la commande.' });
  }
});

// GET /restaurant/tables/etat?warehouseId=... — tableau du caissier : état de chaque table
router.get('/tables/etat', authenticate, requireRole('manager', 'gerant', 'caissier', 'vendeur_caissier'), exigerRestaurant, async (req, res) => {
  const warehouseId = boutiqueDemandee(req);
  if (!warehouseId) return res.status(400).json({ error: 'Boutique requise.' });
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.label, t.capacity,
              COUNT(o.id) FILTER (WHERE o.qr_status = 'a_valider') AS a_valider,
              COUNT(o.id) FILTER (WHERE o.qr_status = 'acceptee') AS en_cours,
              COALESCE(SUM(o.total_amount) FILTER (WHERE o.qr_status IN ('a_valider', 'acceptee')), 0) AS montant
         FROM dining_tables t
         LEFT JOIN orders o ON o.dining_table_id = t.id AND o.status = 'en_attente' AND o.source = 'qr'
        WHERE t.merchant_id = $1 AND t.warehouse_id = $2 AND t.is_active = TRUE
        GROUP BY t.id, t.label, t.capacity
        ORDER BY t.label`,
      [req.user.merchantId, warehouseId]
    );
    res.json(rows.map((t) => ({
      ...t,
      a_valider: Number(t.a_valider),
      en_cours: Number(t.en_cours),
      montant: Number(t.montant),
      etat: Number(t.a_valider) > 0 ? 'a_valider' : Number(t.en_cours) > 0 ? 'en_cours' : 'libre',
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture des tables.' });
  }
});

module.exports = { router, publicRouter };
