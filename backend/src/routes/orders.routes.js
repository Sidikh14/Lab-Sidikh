const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');

const TVA_RATE = 18; // Taux de TVA appliqué quand la case est cochée (%)
const MOYENS_PAIEMENT = ['especes', 'wave', 'orange_money', 'cheque', 'virement'];

const router = express.Router();
router.use(authenticate);

// Construit un numéro de commande lisible à partir du compteur interne (order_seq).
function formatOrderNumber(order) {
  const annee = new Date(order.created_at).getFullYear();
  const numero = String(order.order_seq).padStart(4, '0');
  return `CMD-${annee}-${numero}`;
}

// GET /orders — liste des commandes récentes du commerçant
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.id, o.order_seq, o.status, o.total_amount, o.subtotal_amount, o.tva_applicable,
              o.tva_amount, o.payment_method, o.amount_received, o.change_given,
              o.created_at, o.assigned_cashier_id, o.returned_at, o.returned_reason,
              c.full_name AS client_name
       FROM orders o
       LEFT JOIN clients c ON c.id = o.client_id
       WHERE o.merchant_id = $1
       ORDER BY o.created_at DESC
       LIMIT 100`,
      [req.user.merchantId]
    );
    const rows = result.rows.map((o) => ({ ...o, order_number: formatOrderNumber(o) }));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des commandes.' });
  }
});

// GET /orders/:id — détail d'une commande avec ses lignes
router.get('/:id', async (req, res) => {
  try {
    const orderResult = await pool.query(
      `SELECT o.*, c.full_name AS client_name
       FROM orders o LEFT JOIN clients c ON c.id = o.client_id
       WHERE o.id = $1 AND o.merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const order = orderResult.rows[0];
    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable.' });
    }

    const itemsResult = await pool.query(
      `SELECT oi.id, oi.product_id, p.name AS product_name, oi.quantity, oi.unit_price, oi.line_total,
              oi.packaging_label, oi.packaging_quantity
       FROM order_items oi JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`,
      [order.id]
    );

    res.json({ ...order, order_number: formatOrderNumber(order), items: itemsResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération de la commande.' });
  }
});

// POST /orders
// Crée une commande avec ses lignes, déduit le stock automatiquement et
// enregistre le mouvement de stock correspondant. Tout se fait dans une
// transaction : si un produit n'a pas assez de stock, rien n'est enregistré.
// Le caissier ne crée pas de vente, il encaisse celles créées par le vendeur.
router.post('/', requireRole('manager', 'gerant', 'vendeur'), async (req, res) => {
  const { clientId, items, notes, tvaApplicable } = req.body;
  // items attendu : [{ productId, quantity, unitId }, ...]
  // quantity = nombre de conditionnements vendus (ex: 2 cartons) ; unitId
  // facultatif = référence vers product_units (sinon vente au détail).

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'La commande doit contenir au moins un article.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let subtotalAmount = 0;
    const resolvedItems = [];

    for (const item of items) {
      if (!item.productId || !Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw { status: 400, message: 'Article de commande invalide.' };
      }

      const productResult = await client.query(
        `SELECT id, name, unit_price, quantity_in_stock
         FROM products WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
        [item.productId, req.user.merchantId]
      );
      const product = productResult.rows[0];
      if (!product) {
        throw { status: 404, message: `Produit ${item.productId} introuvable.` };
      }

      let prixParConditionnement = Number(product.unit_price);
      let quantitePerUnite = 1;
      let packagingLabel = null;

      if (item.unitId) {
        const uniteResult = await client.query(
          `SELECT price, quantity_per_unit, label FROM product_units
           WHERE id = $1 AND product_id = $2 AND merchant_id = $3`,
          [item.unitId, product.id, req.user.merchantId]
        );
        const unite = uniteResult.rows[0];
        if (!unite) throw { status: 400, message: `Conditionnement invalide pour ${product.name}.` };
        prixParConditionnement = Number(unite.price);
        quantitePerUnite = unite.quantity_per_unit;
        packagingLabel = unite.label;
      }

      const baseQuantity = item.quantity * quantitePerUnite;
      if (product.quantity_in_stock < baseQuantity) {
        throw { status: 400, message: `Stock insuffisant pour ${product.name}.` };
      }

      const lineTotal = prixParConditionnement * item.quantity;
      subtotalAmount += lineTotal;
      resolvedItems.push({
        product,
        baseQuantity,
        unitPrice: prixParConditionnement / quantitePerUnite,
        packagingLabel,
        packagingQuantity: packagingLabel ? item.quantity : null,
      });
    }

    // Arrondi en FCFA entiers (pas de centimes) : on arrondit le montant de
    // TVA lui-même, pas un ratio intermédiaire, pour éviter les décimales.
    const tvaAmount = tvaApplicable ? Math.round(subtotalAmount * (TVA_RATE / 100)) : 0;
    const totalAmount = Math.round(subtotalAmount + tvaAmount);

    const orderResult = await client.query(
      `INSERT INTO orders (merchant_id, client_id, created_by, status, subtotal_amount, tva_applicable, tva_rate, tva_amount, total_amount, notes)
       VALUES ($1, $2, $3, 'en_attente', $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        req.user.merchantId,
        clientId || null,
        req.user.id,
        subtotalAmount,
        Boolean(tvaApplicable),
        TVA_RATE,
        tvaAmount,
        totalAmount,
        notes || null,
      ]
    );
    const order = orderResult.rows[0];

    for (const resolved of resolvedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, packaging_label, packaging_quantity)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, resolved.product.id, resolved.baseQuantity, resolved.unitPrice, resolved.packagingLabel, resolved.packagingQuantity]
      );

      const newQuantity = resolved.product.quantity_in_stock - resolved.baseQuantity;
      await client.query(`UPDATE products SET quantity_in_stock = $1 WHERE id = $2`, [
        newQuantity,
        resolved.product.id,
      ]);

      await client.query(
        `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason)
         VALUES ($1, $2, $3, 'sortie', $4, $5)`,
        [req.user.merchantId, resolved.product.id, req.user.id, resolved.baseQuantity, `Commande ${order.id}`]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ ...order, order_number: formatOrderNumber(order) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création de la commande.' });
  } finally {
    client.release();
  }
});

// PATCH /orders/:id/payment — encaissement par le caissier (ou le manager)
// Enregistre le moyen de paiement, le montant reçu, calcule la monnaie à
// rendre, et fait passer la commande au statut "validée".
router.patch('/:id/payment', requireRole('manager', 'caissier'), async (req, res) => {
  const { paymentMethod, amountReceived } = req.body;

  if (!MOYENS_PAIEMENT.includes(paymentMethod)) {
    return res.status(400).json({ error: 'Moyen de paiement invalide.' });
  }
  if (typeof amountReceived !== 'number' || amountReceived < 0) {
    return res.status(400).json({ error: 'Montant reçu invalide.' });
  }

  try {
    const orderResult = await pool.query(
      `SELECT id, total_amount, status, client_id FROM orders WHERE id = $1 AND merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    if (order.status !== 'en_attente') {
      return res.status(400).json({ error: 'Cette commande a déjà été traitée.' });
    }
    if (amountReceived < Number(order.total_amount)) {
      return res.status(400).json({ error: 'Le montant reçu est inférieur au total à payer.' });
    }

    const changeGiven = Math.round(amountReceived - Number(order.total_amount));
    // Un client de passage n'a pas de livraison à faire : la commande est
    // directement marquée comme livrée dès l'encaissement.
    const estClientDePassage = !order.client_id;

    const result = await pool.query(
      `UPDATE orders SET
         status = $7,
         payment_method = $1,
         amount_received = $2,
         change_given = $3,
         validated_by = $4,
         validated_at = now()
         ${estClientDePassage ? ', delivered_by = $4, delivered_at = now()' : ''}
       WHERE id = $5 AND merchant_id = $6
       RETURNING *`,
      [paymentMethod, amountReceived, changeGiven, req.user.id, req.params.id, req.user.merchantId, estClientDePassage ? 'livree' : 'validee']
    );
    const orderMisAJour = result.rows[0];

    if (estClientDePassage) {
      await logActivity({
        merchantId: req.user.merchantId,
        userId: req.user.id,
        action: 'order_delivered',
        description: `a livré la commande ${formatOrderNumber(orderMisAJour)} (client de passage)`,
      });
    }

    res.json({ ...orderMisAJour, order_number: formatOrderNumber(orderMisAJour) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'encaissement." });
  }
});

// PATCH /orders/:id/return-to-seller — le caissier renvoie la facture au
// vendeur (avant encaissement) pour qu'il la modifie ou l'annule. On garde
// une trace de qui l'a renvoyée (assigned_cashier_id) pour que, une fois
// corrigée, elle revienne directement à ce même caissier plutôt que dans
// la file générale.
router.patch('/:id/return-to-seller', requireRole('manager', 'caissier'), async (req, res) => {
  const { reason } = req.body;

  try {
    const orderResult = await pool.query(
      `SELECT id, status FROM orders WHERE id = $1 AND merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    if (order.status !== 'en_attente') {
      return res.status(400).json({ error: 'Seule une commande en attente d\'encaissement peut être renvoyée au vendeur.' });
    }

    const result = await pool.query(
      `UPDATE orders SET
         status = 'renvoyee_vendeur',
         assigned_cashier_id = $1,
         returned_at = now(),
         returned_reason = $2
       WHERE id = $3 AND merchant_id = $4
       RETURNING *`,
      [req.user.id, reason || null, req.params.id, req.user.merchantId]
    );
    const orderMisAJour = result.rows[0];

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'order_returned_to_seller',
      description: `a retourné la commande ${formatOrderNumber(orderMisAJour)} au vendeur${reason ? ` (${reason})` : ''}`,
    });

    res.json({ ...orderMisAJour, order_number: formatOrderNumber(orderMisAJour) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du retour de la commande au vendeur.' });
  }
});

// PATCH /orders/:id/status — changements manuels de statut (livraison, annulation)
// Le vendeur a un droit limité : il ne peut qu'annuler une commande qui lui
// a été renvoyée par le caissier (statut 'renvoyee_vendeur'), rien d'autre.
router.patch('/:id/status', requireRole('manager', 'gerant', 'caissier', 'vendeur'), async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['en_attente', 'validee', 'livree', 'annulee'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Statut invalide.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      `SELECT * FROM orders WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
      [req.params.id, req.user.merchantId]
    );
    const orderExistant = orderResult.rows[0];
    if (!orderExistant) throw { status: 404, message: 'Commande introuvable.' };

    if (req.user.role === 'vendeur') {
      if (status !== 'annulee') {
        throw { status: 403, message: "Vous n'avez pas les droits nécessaires pour cette action." };
      }
      if (orderExistant.status !== 'renvoyee_vendeur') {
        throw { status: 403, message: 'Vous ne pouvez annuler que les commandes qui vous ont été renvoyées.' };
      }
    }

    // Annuler une commande qui n'a pas encore été encaissée (en_attente ou
    // renvoyee_vendeur) doit remettre le stock déduit à la vente. Une fois
    // encaissée/livrée, on ne touche plus au stock ici.
    if (status === 'annulee' && ['en_attente', 'renvoyee_vendeur'].includes(orderExistant.status)) {
      const items = await client.query(
        `SELECT product_id, quantity FROM order_items WHERE order_id = $1`,
        [orderExistant.id]
      );
      for (const item of items.rows) {
        await client.query(
          `UPDATE products SET quantity_in_stock = quantity_in_stock + $1 WHERE id = $2 AND merchant_id = $3`,
          [item.quantity, item.product_id, req.user.merchantId]
        );
        await client.query(
          `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason)
           VALUES ($1, $2, $3, 'entree', $4, $5)`,
          [req.user.merchantId, item.product_id, req.user.id, item.quantity, `Annulation commande ${formatOrderNumber(orderExistant)}`]
        );
      }
    }

    let colonnes = '';
    if (status === 'livree') colonnes = ', delivered_by = $4, delivered_at = now()';
    if (status === 'annulee') colonnes = ', cancelled_by = $4, cancelled_at = now()';

    const params = colonnes
      ? [status, req.params.id, req.user.merchantId, req.user.id]
      : [status, req.params.id, req.user.merchantId];

    const result = await client.query(
      `UPDATE orders SET status = $1${colonnes} WHERE id = $2 AND merchant_id = $3 RETURNING *`,
      params
    );

    await client.query('COMMIT');

    const order = result.rows[0];
    if (status === 'livree') {
      await logActivity({
        merchantId: req.user.merchantId,
        userId: req.user.id,
        action: 'order_delivered',
        description: `a livré la commande ${formatOrderNumber(order)}`,
      });
    }
    if (status === 'annulee') {
      await logActivity({
        merchantId: req.user.merchantId,
        userId: req.user.id,
        action: 'order_cancelled',
        description: `a annulé la commande ${formatOrderNumber(order)}`,
      });
    }

    res.json({ ...order, order_number: formatOrderNumber(order) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du statut.' });
  } finally {
    client.release();
  }
});

// PUT /orders/:id — modification d'une commande par le vendeur, uniquement
// possible quand le caissier l'a renvoyée (statut 'renvoyee_vendeur'). On
// remet en stock les anciens articles, on applique les nouveaux (mêmes
// règles que la création), on recalcule les totaux, et la commande repart
// au statut 'en_attente' — assigned_cashier_id n'est pas touché, donc elle
// reste rattachée au même caissier que precedemment.
router.put('/:id', requireRole('manager', 'gerant', 'vendeur'), async (req, res) => {
  const { clientId, items, notes, tvaApplicable } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'La commande doit contenir au moins un article.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      `SELECT * FROM orders WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
      [req.params.id, req.user.merchantId]
    );
    const order = orderResult.rows[0];
    if (!order) throw { status: 404, message: 'Commande introuvable.' };
    if (order.status !== 'renvoyee_vendeur') {
      throw { status: 400, message: 'Seule une commande renvoyée par le caissier peut être modifiée.' };
    }

    // 1. On remet en stock les anciens articles avant d'appliquer les nouveaux.
    const anciensItems = await client.query(
      `SELECT product_id, quantity FROM order_items WHERE order_id = $1`,
      [order.id]
    );
    for (const ancien of anciensItems.rows) {
      await client.query(
        `UPDATE products SET quantity_in_stock = quantity_in_stock + $1 WHERE id = $2 AND merchant_id = $3`,
        [ancien.quantity, ancien.product_id, req.user.merchantId]
      );
      await client.query(
        `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason)
         VALUES ($1, $2, $3, 'entree', $4, $5)`,
        [req.user.merchantId, ancien.product_id, req.user.id, ancien.quantity, `Correction commande ${formatOrderNumber(order)} (retour caissier)`]
      );
    }
    await client.query(`DELETE FROM order_items WHERE order_id = $1`, [order.id]);

    // 2. On applique les nouveaux articles — même logique que la création.
    let subtotalAmount = 0;
    const resolvedItems = [];

    for (const item of items) {
      if (!item.productId || !Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw { status: 400, message: 'Article de commande invalide.' };
      }

      const productResult = await client.query(
        `SELECT id, name, unit_price, quantity_in_stock
         FROM products WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
        [item.productId, req.user.merchantId]
      );
      const product = productResult.rows[0];
      if (!product) {
        throw { status: 404, message: `Produit ${item.productId} introuvable.` };
      }

      let prixParConditionnement = Number(product.unit_price);
      let quantitePerUnite = 1;
      let packagingLabel = null;

      if (item.unitId) {
        const uniteResult = await client.query(
          `SELECT price, quantity_per_unit, label FROM product_units
           WHERE id = $1 AND product_id = $2 AND merchant_id = $3`,
          [item.unitId, product.id, req.user.merchantId]
        );
        const unite = uniteResult.rows[0];
        if (!unite) throw { status: 400, message: `Conditionnement invalide pour ${product.name}.` };
        prixParConditionnement = Number(unite.price);
        quantitePerUnite = unite.quantity_per_unit;
        packagingLabel = unite.label;
      }

      const baseQuantity = item.quantity * quantitePerUnite;
      if (product.quantity_in_stock < baseQuantity) {
        throw { status: 400, message: `Stock insuffisant pour ${product.name}.` };
      }

      const lineTotal = prixParConditionnement * item.quantity;
      subtotalAmount += lineTotal;
      resolvedItems.push({
        product,
        baseQuantity,
        unitPrice: prixParConditionnement / quantitePerUnite,
        packagingLabel,
        packagingQuantity: packagingLabel ? item.quantity : null,
      });
    }

    const tvaAmount = tvaApplicable ? Math.round(subtotalAmount * (TVA_RATE / 100)) : 0;
    const totalAmount = Math.round(subtotalAmount + tvaAmount);

    for (const resolved of resolvedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, packaging_label, packaging_quantity)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, resolved.product.id, resolved.baseQuantity, resolved.unitPrice, resolved.packagingLabel, resolved.packagingQuantity]
      );

      const newQuantity = resolved.product.quantity_in_stock - resolved.baseQuantity;
      await client.query(`UPDATE products SET quantity_in_stock = $1 WHERE id = $2`, [
        newQuantity,
        resolved.product.id,
      ]);

      await client.query(
        `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason)
         VALUES ($1, $2, $3, 'sortie', $4, $5)`,
        [req.user.merchantId, resolved.product.id, req.user.id, resolved.baseQuantity, `Commande ${formatOrderNumber(order)} (modifiée)`]
      );
    }

    // 3. On remet la commande en attente d'encaissement.
    const updateResult = await client.query(
      `UPDATE orders SET
         client_id = $1,
         notes = $2,
         tva_applicable = $3,
         tva_amount = $4,
         subtotal_amount = $5,
         total_amount = $6,
         status = 'en_attente',
         returned_reason = NULL
       WHERE id = $7
       RETURNING *`,
      [clientId || null, notes || null, Boolean(tvaApplicable), tvaAmount, subtotalAmount, totalAmount, order.id]
    );
    const orderMisAJour = updateResult.rows[0];

    await client.query('COMMIT');

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'order_modified',
      description: `a modifié la commande ${formatOrderNumber(orderMisAJour)} suite à un retour caissier`,
    });

    res.json({ ...orderMisAJour, order_number: formatOrderNumber(orderMisAJour) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la modification de la commande.' });
  } finally {
    client.release();
  }
});

module.exports = router;
