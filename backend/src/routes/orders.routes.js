const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');
const { broadcast } = require('../utils/eventsBus');
const { COULEURS, formatMontant, dessinerEntete, dessinerEnteteTableau, dessinerPiedDePage, traitSeparateur, enregistrerPolices } = require('../utils/pdfHelpers');

const TVA_RATE = 18; // Taux de TVA appliqué quand la case est cochée (%)
const MOYENS_PAIEMENT = ['especes', 'wave', 'orange_money', 'cheque', 'virement', 'a_credit'];

const router = express.Router();
router.use(authenticate);

// Filet de sécurité commun à toutes les générations de PDF de ce fichier :
// si pdfkit échoue en cours de flux (logo corrompu, débordement de texte,
// etc.) APRÈS que l'en-tête HTTP "Content-Type: application/pdf" soit déjà
// parti, il est trop tard pour répondre du JSON — on ne peut qu'arrêter
// proprement la connexion, sans jamais laisser une exception non catchée
// remonter et faire planter tout le processus Node (déjà rencontré :
// RangeError pdfkit → ERR_STREAM_WRITE_AFTER_END → crash total du serveur).
function attacherFiletSecuritePdf(doc, res, label) {
  doc.on('error', (err) => {
    console.error(`Erreur pdfkit (${label}) :`, err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
    } else if (!res.writableEnded) {
      res.end();
    }
  });
}

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
              c.full_name AS client_name,
              cr.status AS credit_request_status, cr.rejection_reason AS credit_request_reason
       FROM orders o
       LEFT JOIN clients c ON c.id = o.client_id
       LEFT JOIN LATERAL (
         SELECT status, rejection_reason FROM credit_requests
         WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1
       ) cr ON true
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

// GET /orders/pdf?from=YYYY-MM-DD&to=YYYY-MM-DD — export PDF de l'historique
// des ventes sur une période, comme le journal d'activité. Placée avant
// GET /:id pour que 'pdf' ne soit pas interprété comme un identifiant.
router.get('/pdf', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'La période (from/to) est requise.' });
  }
  try {
    const merchantResult = await pool.query(`SELECT business_name FROM merchants WHERE id = $1`, [req.user.merchantId]);
    const businessName = merchantResult.rows[0]?.business_name;

    const result = await pool.query(
      `SELECT o.order_seq, o.created_at, o.status, o.total_amount, o.payment_method,
              c.full_name AS client_name
       FROM orders o
       LEFT JOIN clients c ON c.id = o.client_id
       WHERE o.merchant_id = $1 AND o.created_at::date BETWEEN $2 AND $3
       ORDER BY o.created_at ASC`,
      [req.user.merchantId, from, to]
    );
    const rows = result.rows.map((o) => ({ ...o, order_number: formatOrderNumber(o) }));

    genererListeVentesPdf(res, rows, from, to, businessName);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
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
//
// Deux actions sont réservées au manager, et bloquées pour tout autre rôle :
// - customPrice sur un article : vendre à un prix différent du prix normal
//   (réduction ou majoration).
// - authorizeOutOfStock sur un article : vendre un produit dont le stock
//   disponible est insuffisant (vente en rupture autorisée). Le stock ne
//   descend jamais sous zéro : il est simplement ramené à 0.
router.post('/', requireRole('manager', 'gerant', 'vendeur'), async (req, res) => {
  const { clientId, items, notes, tvaApplicable, clientOrderId } = req.body;
  // items attendu : [{ productId, quantity, unitId, customPrice, authorizeOutOfStock }, ...]
  // quantity = nombre de conditionnements vendus (ex: 2 cartons) ; unitId
  // facultatif = référence vers product_units (sinon vente au détail).
  // customPrice et authorizeOutOfStock : réservés au manager (voir ci-dessus).
  //
  // clientOrderId (facultatif) : UUID généré côté navigateur pour une vente
  // créée hors-ligne (voir useOfflineSync.js). Sert de clé d'idempotence :
  // si la synchro renvoie deux fois la même vente (ex : coupure juste avant
  // de recevoir la réponse du premier envoi), on renvoie la commande déjà
  // créée au lieu d'en créer une deuxième.

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'La commande doit contenir au moins un article.' });
  }

  if (clientOrderId) {
    const existante = await pool.query(
      `SELECT * FROM orders WHERE client_order_id = $1 AND merchant_id = $2`,
      [clientOrderId, req.user.merchantId]
    );
    if (existante.rows[0]) {
      // Déjà synchronisée lors d'un essai précédent : on renvoie la même
      // commande (200, pas 201, puisqu'on n'en crée pas de nouvelle).
      return res.status(200).json({ ...existante.rows[0], order_number: formatOrderNumber(existante.rows[0]) });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let subtotalAmount = 0;
    let stockOverrideUtilise = false;
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

      // Prix personnalisé (réduction ou majoration) : réservé au manager.
      let originalUnitPrice = null;
      if (item.customPrice !== undefined && item.customPrice !== null) {
        if (req.user.role !== 'manager') {
          throw { status: 403, message: 'Seul le manager peut vendre à un prix personnalisé.' };
        }
        if (typeof item.customPrice !== 'number' || item.customPrice < 0) {
          throw { status: 400, message: `Prix personnalisé invalide pour ${product.name}.` };
        }
        originalUnitPrice = prixParConditionnement;
        prixParConditionnement = item.customPrice;
      }

      const baseQuantity = item.quantity * quantitePerUnite;
      const rupture = product.quantity_in_stock < baseQuantity;
      if (rupture) {
        if (req.user.role !== 'manager' || !item.authorizeOutOfStock) {
          throw { status: 400, message: `Stock insuffisant pour ${product.name}.` };
        }
        stockOverrideUtilise = true;
      }

      const lineTotal = prixParConditionnement * item.quantity;
      subtotalAmount += lineTotal;
      resolvedItems.push({
        product,
        baseQuantity,
        unitPrice: prixParConditionnement / quantitePerUnite,
        originalUnitPrice: originalUnitPrice !== null ? originalUnitPrice / quantitePerUnite : null,
        packagingLabel,
        packagingQuantity: packagingLabel ? item.quantity : null,
        rupture,
      });
    }

    // Arrondi en FCFA entiers (pas de centimes) : on arrondit le montant de
    // TVA lui-même, pas un ratio intermédiaire, pour éviter les décimales.
    const tvaAmount = tvaApplicable ? Math.round(subtotalAmount * (TVA_RATE / 100)) : 0;
    const totalAmount = Math.round(subtotalAmount + tvaAmount);

    const orderResult = await client.query(
      `INSERT INTO orders (merchant_id, client_id, created_by, status, subtotal_amount, tva_applicable, tva_rate, tva_amount, total_amount, notes, stock_override, client_order_id)
       VALUES ($1, $2, $3, 'en_attente', $4, $5, $6, $7, $8, $9, $10, $11)
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
        stockOverrideUtilise,
        clientOrderId || null,
      ]
    );
    const order = orderResult.rows[0];

    for (const resolved of resolvedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, original_unit_price, packaging_label, packaging_quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [order.id, resolved.product.id, resolved.baseQuantity, resolved.unitPrice, resolved.originalUnitPrice, resolved.packagingLabel, resolved.packagingQuantity]
      );

      // Le stock ne descend jamais sous zéro, même en vente autorisée en rupture.
      const newQuantity = Math.max(0, resolved.product.quantity_in_stock - resolved.baseQuantity);
      await client.query(`UPDATE products SET quantity_in_stock = $1 WHERE id = $2`, [
        newQuantity,
        resolved.product.id,
      ]);

      await client.query(
        `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason)
         VALUES ($1, $2, $3, 'sortie', $4, $5)`,
        [req.user.merchantId, resolved.product.id, req.user.id, resolved.baseQuantity, `Commande ${order.id}`]
      );

      if (resolved.originalUnitPrice !== null) {
        await logActivity({
          merchantId: req.user.merchantId,
          userId: req.user.id,
          action: 'order_custom_price',
          description: `a vendu ${resolved.product.name} à un prix personnalisé (${Math.round(resolved.originalUnitPrice)} → ${Math.round(resolved.unitPrice)} FCFA) sur la commande ${formatOrderNumber(order)}`,
        });
      }
      if (resolved.rupture) {
        await logActivity({
          merchantId: req.user.merchantId,
          userId: req.user.id,
          action: 'order_stock_override',
          description: `a autorisé une vente en rupture de stock pour ${resolved.product.name} sur la commande ${formatOrderNumber(order)}`,
        });
      }
    }

    await client.query('COMMIT');
    const orderComplet = { ...order, order_number: formatOrderNumber(order) };
    // Diffusion en temps réel : la caisse (OrdersPage.jsx côté caissier)
    // n'a pas besoin d'actualiser la page pour voir apparaître cette vente.
    broadcast(req.user.merchantId, 'order:created', orderComplet);
    res.status(201).json(orderComplet);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    // Violation de la contrainte UNIQUE sur client_order_id : une synchro
    // concurrente a inséré la commande entre notre vérification et notre
    // insertion. On renvoie la commande existante plutôt qu'une erreur 500.
    if (err.code === '23505' && clientOrderId) {
      const existante = await pool.query(
        `SELECT * FROM orders WHERE client_order_id = $1 AND merchant_id = $2`,
        [clientOrderId, req.user.merchantId]
      );
      if (existante.rows[0]) {
        return res.status(200).json({ ...existante.rows[0], order_number: formatOrderNumber(existante.rows[0]) });
      }
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
  const { paymentMethod, amountReceived, needsDelivery, deliveryFee } = req.body;

  if (!MOYENS_PAIEMENT.includes(paymentMethod)) {
    return res.status(400).json({ error: 'Moyen de paiement invalide.' });
  }

  const estACredit = paymentMethod === 'a_credit';

  if (!estACredit && (typeof amountReceived !== 'number' || amountReceived < 0)) {
    return res.status(400).json({ error: 'Montant reçu invalide.' });
  }

  // La livraison n'est prise en compte que si la case est cochée ; sinon on
  // ignore tout montant envoyé par erreur (pas de frais sans livraison).
  const aLivrer = Boolean(needsDelivery);
  let fraisLivraison = 0;
  if (aLivrer) {
    if (deliveryFee !== undefined && deliveryFee !== null) {
      if (typeof deliveryFee !== 'number' || deliveryFee < 0) {
        return res.status(400).json({ error: 'Montant de livraison invalide.' });
      }
      fraisLivraison = deliveryFee;
    }
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

    // Une vente à crédit n'est autorisée que pour un client déjà enregistré
    // — un client de passage doit d'abord être créé (via une demande de
    // validation gérant/manager, à venir).
    if (estACredit && !order.client_id) {
      return res.status(400).json({ error: 'La vente à crédit n\'est autorisée que pour un client déjà enregistré.' });
    }

    // Montant total réellement dû, frais de livraison inclus.
    const montantDu = Number(order.total_amount) + fraisLivraison;

    if (!estACredit && amountReceived < montantDu) {
      return res.status(400).json({ error: 'Le montant reçu est inférieur au total à payer.' });
    }

    // À crédit : rien n'est reçu maintenant, le montant total (livraison
    // incluse) devient une créance sur le client, réglable plus tard.
    const montantRecuFinal = estACredit ? 0 : amountReceived;
    const changeGiven = estACredit ? 0 : Math.round(amountReceived - montantDu);
    // Pas de livraison prévue (case décochée) : la commande est directement
    // marquée comme livrée dès l'encaissement, qu'il s'agisse d'un client de
    // passage ou d'un client enregistré qui repart avec sa commande.
    const marqueeLivreeTouteSuite = !aLivrer;

    const result = await pool.query(
      `UPDATE orders SET
         status = $7,
         payment_method = $1,
         amount_received = $2,
         change_given = $3,
         validated_by = $4,
         validated_at = now(),
         needs_delivery = $8,
         delivery_fee = $9,
         total_amount = total_amount + $9
         ${marqueeLivreeTouteSuite ? ', delivered_by = $4, delivered_at = now()' : ''}
       WHERE id = $5 AND merchant_id = $6
       RETURNING *`,
      [paymentMethod, montantRecuFinal, changeGiven, req.user.id, req.params.id, req.user.merchantId, marqueeLivreeTouteSuite ? 'livree' : 'validee', aLivrer, fraisLivraison]
    );
    const orderMisAJour = result.rows[0];

    if (marqueeLivreeTouteSuite) {
      await logActivity({
        merchantId: req.user.merchantId,
        userId: req.user.id,
        action: 'order_delivered',
        description: `a livré la commande ${formatOrderNumber(orderMisAJour)}`,
      });
    } else {
      await logActivity({
        merchantId: req.user.merchantId,
        userId: req.user.id,
        action: 'order_delivery_scheduled',
        description: `a planifié une livraison pour la commande ${formatOrderNumber(orderMisAJour)}${fraisLivraison > 0 ? ` (frais : ${fraisLivraison})` : ''}`,
      });
    }

    if (estACredit) {
      await logActivity({
        merchantId: req.user.merchantId,
        userId: req.user.id,
        action: 'order_credit_sale',
        description: `a enregistré la commande ${formatOrderNumber(orderMisAJour)} à crédit (${formatMontant(orderMisAJour.total_amount)})`,
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
    let stockOverrideUtilise = false;
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

      // Prix personnalisé (réduction ou majoration) : réservé au manager.
      let originalUnitPrice = null;
      if (item.customPrice !== undefined && item.customPrice !== null) {
        if (req.user.role !== 'manager') {
          throw { status: 403, message: 'Seul le manager peut vendre à un prix personnalisé.' };
        }
        if (typeof item.customPrice !== 'number' || item.customPrice < 0) {
          throw { status: 400, message: `Prix personnalisé invalide pour ${product.name}.` };
        }
        originalUnitPrice = prixParConditionnement;
        prixParConditionnement = item.customPrice;
      }

      const baseQuantity = item.quantity * quantitePerUnite;
      const rupture = product.quantity_in_stock < baseQuantity;
      if (rupture) {
        if (req.user.role !== 'manager' || !item.authorizeOutOfStock) {
          throw { status: 400, message: `Stock insuffisant pour ${product.name}.` };
        }
        stockOverrideUtilise = true;
      }

      const lineTotal = prixParConditionnement * item.quantity;
      subtotalAmount += lineTotal;
      resolvedItems.push({
        product,
        baseQuantity,
        unitPrice: prixParConditionnement / quantitePerUnite,
        originalUnitPrice: originalUnitPrice !== null ? originalUnitPrice / quantitePerUnite : null,
        packagingLabel,
        packagingQuantity: packagingLabel ? item.quantity : null,
        rupture,
      });
    }

    const tvaAmount = tvaApplicable ? Math.round(subtotalAmount * (TVA_RATE / 100)) : 0;
    const totalAmount = Math.round(subtotalAmount + tvaAmount);

    for (const resolved of resolvedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, original_unit_price, packaging_label, packaging_quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [order.id, resolved.product.id, resolved.baseQuantity, resolved.unitPrice, resolved.originalUnitPrice, resolved.packagingLabel, resolved.packagingQuantity]
      );

      // Le stock ne descend jamais sous zéro, même en vente autorisée en rupture.
      const newQuantity = Math.max(0, resolved.product.quantity_in_stock - resolved.baseQuantity);
      await client.query(`UPDATE products SET quantity_in_stock = $1 WHERE id = $2`, [
        newQuantity,
        resolved.product.id,
      ]);

      await client.query(
        `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason)
         VALUES ($1, $2, $3, 'sortie', $4, $5)`,
        [req.user.merchantId, resolved.product.id, req.user.id, resolved.baseQuantity, `Commande ${formatOrderNumber(order)} (modifiée)`]
      );

      if (resolved.originalUnitPrice !== null) {
        await logActivity({
          merchantId: req.user.merchantId,
          userId: req.user.id,
          action: 'order_custom_price',
          description: `a vendu ${resolved.product.name} à un prix personnalisé (${Math.round(resolved.originalUnitPrice)} → ${Math.round(resolved.unitPrice)} FCFA) sur la commande ${formatOrderNumber(order)}`,
        });
      }
      if (resolved.rupture) {
        await logActivity({
          merchantId: req.user.merchantId,
          userId: req.user.id,
          action: 'order_stock_override',
          description: `a autorisé une vente en rupture de stock pour ${resolved.product.name} sur la commande ${formatOrderNumber(order)}`,
        });
      }
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
         returned_reason = NULL,
         stock_override = stock_override OR $8
       WHERE id = $7
       RETURNING *`,
      [clientId || null, notes || null, Boolean(tvaApplicable), tvaAmount, subtotalAmount, totalAmount, order.id, stockOverrideUtilise]
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

// Récupère toutes les données nécessaires au reçu : commande, client (si
// enregistré), commerce, vendeur, caissier, et articles.
async function getOrderReceiptDetail(merchantId, id) {
  const orderResult = await pool.query(
    `SELECT o.*, 
            c.full_name AS client_name, c.phone AS client_phone, c.address AS client_address,
            m.business_name, m.currency, m.logo_data, m.ninea, m.rccm,
            m.address AS merchant_address, m.bank_details, m.mobile_money_details, m.payment_terms,
            uv.full_name AS vendeur_name,
            uc.full_name AS caissier_name
     FROM orders o
     JOIN merchants m ON m.id = o.merchant_id
     LEFT JOIN clients c ON c.id = o.client_id
     LEFT JOIN users uv ON uv.id = o.created_by
     LEFT JOIN users uc ON uc.id = o.validated_by
     WHERE o.id = $1 AND o.merchant_id = $2`,
    [id, merchantId]
  );
  const order = orderResult.rows[0];
  if (!order) return null;

  const itemsResult = await pool.query(
    `SELECT oi.id, oi.product_id, p.name AS product_name, oi.quantity, oi.unit_price, oi.line_total,
            oi.packaging_label, oi.packaging_quantity
     FROM order_items oi JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1`,
    [order.id]
  );

  return { ...order, items: itemsResult.rows, order_number: formatOrderNumber(order) };
}

const MOYENS_PAIEMENT_LABEL = {
  especes: 'Espèces', wave: 'Wave', orange_money: 'Orange Money', cheque: 'Chèque', virement: 'Virement', a_credit: 'À crédit',
};

const LABEL_STATUT_PDF = {
  en_attente: 'En attente', validee: 'À livrer', livree: 'Livrée', renvoyee_vendeur: 'Renvoyée au vendeur', annulee: 'Annulée',
};

// Historique des ventes sur une période, format liste (comme le journal
// d'activité) — une ligne par commande, pagination automatique.
function genererListeVentesPdf(res, orders, from, to, businessName) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="ventes-${from}-au-${to}.pdf"`);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  attacherFiletSecuritePdf(doc, res, 'liste des ventes');
  doc.pipe(res);

  const COLONNES = [
    { texte: 'N° commande', x: 56, largeur: 95 },
    { texte: 'Date', x: 155, largeur: 75 },
    { texte: 'Client', x: 235, largeur: 150 },
    { texte: 'Statut', x: 390, largeur: 95 },
    { texte: 'Montant', x: 485, largeur: 60, aligner: 'right' },
  ];

  function dessinerEnTete() {
    let y0 = dessinerEntete(doc, {
      businessName,
      titre: 'Historique des ventes',
      sousTitre: `Du ${new Date(from).toLocaleDateString('fr-FR')} au ${new Date(to).toLocaleDateString('fr-FR')}`,
    });
    return dessinerEnteteTableau(doc, y0, COLONNES);
  }

  let y = dessinerEnTete();

  if (orders.length === 0) {
    doc.fontSize(10).fillColor(COULEURS.muted).text('Aucune vente sur cette période.', 56, y + 10);
  }

  let totalGeneral = 0;
  orders.forEach((o, index) => {
    if (y > doc.page.height - 90) {
      doc.addPage();
      y = dessinerEnTete();
    }
    if (index % 2 === 1) {
      doc.rect(50, y, doc.page.width - 100, 20).fill(COULEURS.fondAlterne);
    }
    doc.fillColor(COULEURS.encre).font('Helvetica').fontSize(9);
    doc.text(o.order_number, 56, y + 6, { width: 95 });
    doc.text(new Date(o.created_at).toLocaleDateString('fr-FR'), 155, y + 6, { width: 75 });
    doc.text(o.client_name || 'Client de passage', 235, y + 6, { width: 150 });
    doc.text(LABEL_STATUT_PDF[o.status] || o.status, 390, y + 6, { width: 95 });
    doc.text(formatMontant(o.total_amount), 485, y + 6, { width: 60, align: 'right' });
    totalGeneral += Number(o.total_amount);
    y += 20;
  });

  traitSeparateur(doc, y + 4);
  y += 16;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COULEURS.encre);
  doc.text(`${orders.length} vente${orders.length > 1 ? 's' : ''}`, 235, y, { width: 150 });
  doc.text('TOTAL', 390, y, { width: 95 });
  doc.text(formatMontant(totalGeneral), 485, y, { width: 60, align: 'right' });

  doc.end();
}

// Mesure la hauteur réelle nécessaire pour le ticket (gère les noms de
// produits qui passent sur plusieurs lignes) via un document PDFKit
// jetable, jamais envoyé nulle part — juste utilisé pour heightOfString.
function mesurerHauteurTicket(order, largeurContenu) {
  const mesure = new PDFDocument({ margin: 0 });

  let hauteur = 176; // en-tête + bloc totaux fixe + marge basse (sans pied de page)
  if (order.tva_applicable) hauteur += 13;
  if (Number(order.change_given) > 0) hauteur += 12;

  order.items.forEach((item) => {
    mesure.font('Helvetica').fontSize(8.5);
    hauteur += mesure.heightOfString(item.product_name, { width: largeurContenu }) + 3;
    if (item.packaging_label) {
      mesure.fontSize(7.5);
      hauteur += mesure.heightOfString(item.packaging_label, { width: largeurContenu }) + 3;
    }
    hauteur += 14; // ligne quantité/prix
  });

  return hauteur;
}

// Ticket de caisse étroit (format imprimante thermique 80mm), pour un
// client de passage. La hauteur de page est mesurée à l'avance en
// fonction du texte réel (avec ses retours à la ligne), PDFKit ne
// supportant pas les pages à hauteur "automatique".
function genererTicketEtroit(res, order) {
  const LARGEUR = 227; // 80mm
  const MARGE = 14;
  const largeurContenu = LARGEUR - MARGE * 2;

  const hauteur = mesurerHauteurTicket(order, largeurContenu) + MARGE + 20; // marge de sécurité

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="ticket-${order.order_number}.pdf"`);

  const doc = new PDFDocument({ margin: MARGE, size: [LARGEUR, hauteur] });
  attacherFiletSecuritePdf(doc, res, 'ticket de caisse');
  // Le ticket doit impérativement tenir sur une seule page : si un
  // débordement se produit malgré la marge de sécurité ci-dessus, on
  // préfère ignorer l'ajout de page (au pire un léger chevauchement en
  // bas) plutôt que de laisser PDFKit créer des pages Letter parasites.
  doc.addPage = function () { return this; };
  doc.pipe(res);
  enregistrerPolices(doc);

  let y = MARGE;
  doc.fillColor(COULEURS.encre).font('Titre').fontSize(13)
    .text((order.business_name || 'Commerce').toUpperCase(), MARGE, y, { width: largeurContenu, align: 'center' });
  y += 20;
  doc.fillColor(COULEURS.muted).font('Helvetica').fontSize(7.5)
    .text('TICKET DE CAISSE', MARGE, y, { width: largeurContenu, align: 'center', characterSpacing: 1 });
  y += 16;
  doc.fillColor(COULEURS.encre).fontSize(9).font('Helvetica-Bold')
    .text(order.order_number, MARGE, y, { width: largeurContenu, align: 'center' });
  y += 13;
  doc.fillColor(COULEURS.muted).font('Helvetica').fontSize(7.5)
    .text(new Date(order.validated_at || order.created_at).toLocaleString('fr-FR'), MARGE, y, { width: largeurContenu, align: 'center' });
  y += 18;

  traitSeparateur(doc, y);
  y += 10;

  order.items.forEach((item) => {
    doc.fillColor(COULEURS.encre).font('Helvetica').fontSize(8.5);
    const hNom = doc.heightOfString(item.product_name, { width: largeurContenu });
    doc.text(item.product_name, MARGE, y, { width: largeurContenu });
    y += hNom + 3;

    if (item.packaging_label) {
      doc.fillColor(COULEURS.muted).fontSize(7.5);
      const hLabel = doc.heightOfString(item.packaging_label, { width: largeurContenu });
      doc.text(item.packaging_label, MARGE, y, { width: largeurContenu });
      y += hLabel + 3;
    }

    const quantiteAffichee = item.packaging_label ? item.packaging_quantity : item.quantity;
    doc.fillColor(COULEURS.muted).fontSize(8)
      .text(`${quantiteAffichee} × ${formatMontant(item.unit_price * (item.packaging_label ? item.quantity / item.packaging_quantity : 1))}`, MARGE, y, { width: largeurContenu - 70 });
    doc.fillColor(COULEURS.encre).font('Helvetica-Bold')
      .text(formatMontant(item.line_total), MARGE, y, { width: largeurContenu, align: 'right' });
    y += 14;
  });

  traitSeparateur(doc, y);
  y += 10;

  doc.font('Helvetica').fontSize(8.5).fillColor(COULEURS.muted);
  doc.text('Sous-total', MARGE, y, { width: largeurContenu - 70 });
  doc.fillColor(COULEURS.encre).text(`${formatMontant(order.subtotal_amount)} ${order.currency}`, MARGE, y, { width: largeurContenu, align: 'right' });
  y += 13;

  if (order.tva_applicable) {
    doc.fillColor(COULEURS.muted).text(`TVA (${TVA_RATE} %)`, MARGE, y, { width: largeurContenu - 70 });
    doc.fillColor(COULEURS.encre).text(`${formatMontant(order.tva_amount)} ${order.currency}`, MARGE, y, { width: largeurContenu, align: 'right' });
    y += 13;
  }

  y += 3;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COULEURS.encre);
  doc.text('TOTAL', MARGE, y, { width: largeurContenu - 90 });
  doc.text(`${formatMontant(order.total_amount)} ${order.currency}`, MARGE, y, { width: largeurContenu, align: 'right' });
  y += 20;

  doc.font('Helvetica').fontSize(8).fillColor(COULEURS.muted);
  doc.text(MOYENS_PAIEMENT_LABEL[order.payment_method] || order.payment_method || '', MARGE, y, { width: largeurContenu - 90 });
  doc.text(`Reçu : ${formatMontant(order.amount_received)}`, MARGE, y, { width: largeurContenu, align: 'right' });
  y += 12;
  if (Number(order.change_given) > 0) {
    doc.text('Monnaie rendue', MARGE, y, { width: largeurContenu - 90 });
    doc.text(formatMontant(order.change_given), MARGE, y, { width: largeurContenu, align: 'right' });
    y += 12;
  }

  y += 14;

  doc.end();
}

// Facture A4, pour un client enregistré — téléchargeable/imprimable,
// même identité visuelle que les autres documents de l'application.
// Calcule, pour UNE facture à crédit précise, la part déjà réglée (les
// règlements sont enregistrés au niveau du client, imputés à la plus
// ancienne facture d'abord — FIFO, même logique que clients.routes.js) et
// le reste à payer. Utilisé pour l'afficher directement sur la facture PDF.
async function calculerAvanceFacture(merchantId, clientId, orderId) {
  const ventesResult = await pool.query(
    `SELECT id, total_amount
     FROM orders
     WHERE client_id = $1 AND merchant_id = $2 AND payment_method = 'a_credit' AND status != 'annulee'
     ORDER BY created_at, id`,
    [clientId, merchantId]
  );
  const paiementsResult = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total_paye FROM credit_payments WHERE client_id = $1 AND merchant_id = $2`,
    [clientId, merchantId]
  );
  let totalPaye = Number(paiementsResult.rows[0].total_paye);

  for (const vente of ventesResult.rows) {
    const montant = Number(vente.total_amount);
    const avanceImputee = Math.min(Math.max(totalPaye, 0), montant);
    totalPaye -= avanceImputee;
    if (vente.id === orderId) {
      return { avance: avanceImputee, reste: montant - avanceImputee };
    }
  }
  return { avance: 0, reste: 0 };
}

function genererFactureA4(res, order, creditInfo) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="facture-${order.order_number}.pdf"`);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  attacherFiletSecuritePdf(doc, res, 'facture A4');
  doc.pipe(res);

  const merchant = {
    logo_data: order.logo_data,
    ninea: order.ninea,
    rccm: order.rccm,
    address: order.merchant_address,
    bank_details: order.bank_details,
    mobile_money_details: order.mobile_money_details,
    payment_terms: order.payment_terms,
  };

  let y = dessinerEntete(doc, {
    businessName: order.business_name,
    titre: 'Facture',
    sousTitre: `${order.order_number} · ${new Date(order.validated_at || order.created_at).toLocaleDateString('fr-FR')}`,
    merchant,
  });

  // Bloc client (gauche) et bloc vente (droite)
  doc.fontSize(9).fillColor(COULEURS.muted).text('FACTURÉ À', 50, y);
  doc.text('DÉTAILS DE LA VENTE', 320, y);
  y += 14;

  doc.fontSize(11).fillColor(COULEURS.encre).font('Helvetica-Bold').text(order.client_name, 50, y);
  doc.font('Helvetica').fontSize(9).fillColor(COULEURS.muted);
  doc.text(`Vendeur : ${order.vendeur_name || '—'}`, 320, y);
  y += 15;

  if (order.client_phone) { doc.text(order.client_phone, 50, y); }
  doc.text(`Caissier : ${order.caissier_name || '—'}`, 320, y);
  y += 13;

  if (order.client_address) { doc.text(order.client_address, 50, y); }
  doc.text(`Paiement : ${MOYENS_PAIEMENT_LABEL[order.payment_method] || '—'}`, 320, y);
  y += 13;

  y += 16;

  y = dessinerEnteteTableau(doc, y, [
    { texte: 'Produit', x: 56, largeur: 220 },
    { texte: 'Qté', x: 290, largeur: 50, aligner: 'right' },
    { texte: 'Prix unitaire', x: 360, largeur: 85, aligner: 'right' },
    { texte: 'Total', x: 460, largeur: 85, aligner: 'right' },
  ]);

  order.items.forEach((item, index) => {
    const hauteurLigne = item.packaging_label ? 28 : 20;
    if (index % 2 === 1) {
      doc.rect(50, y, doc.page.width - 100, hauteurLigne).fill(COULEURS.fondAlterne);
      doc.fillColor(COULEURS.encre);
    }
    const quantiteAffichee = item.packaging_label ? item.packaging_quantity : item.quantity;
    doc.fontSize(9.5).fillColor(COULEURS.encre);
    doc.text(item.product_name, 56, y + 5, { width: 220 });
    if (item.packaging_label) {
      doc.fontSize(8).fillColor(COULEURS.muted).text(item.packaging_label, 56, y + 17, { width: 220 });
      doc.fontSize(9.5).fillColor(COULEURS.encre);
    }
    doc.text(String(quantiteAffichee), 290, y + 5, { width: 50, align: 'right' });
    doc.text(`${formatMontant(item.line_total / quantiteAffichee)} ${order.currency}`, 360, y + 5, { width: 85, align: 'right' });
    doc.text(`${formatMontant(item.line_total)} ${order.currency}`, 460, y + 5, { width: 85, align: 'right' });
    y += hauteurLigne;
  });

  traitSeparateur(doc, y + 4);
  y += 16;

  doc.fontSize(9).fillColor(COULEURS.muted).text('SOUS-TOTAL', 300, y, { width: 145, align: 'right' });
  doc.fontSize(10).fillColor(COULEURS.encre).text(`${formatMontant(order.subtotal_amount)} ${order.currency}`, 460, y, { width: 85, align: 'right' });
  y += 16;

  if (order.tva_applicable) {
    doc.fontSize(9).fillColor(COULEURS.muted).text(`TVA (${TVA_RATE} %)`, 300, y, { width: 145, align: 'right' });
    doc.fontSize(10).fillColor(COULEURS.encre).text(`${formatMontant(order.tva_amount)} ${order.currency}`, 460, y, { width: 85, align: 'right' });
    y += 16;
  }

  y += 4;
  doc.fontSize(9).fillColor(COULEURS.muted).text('MONTANT TOTAL', 300, y, { width: 145, align: 'right' });
  doc.fontSize(16).fillColor(COULEURS.encre).font('Titre')
    .text(`${formatMontant(order.total_amount)} ${order.currency}`, 460, y - 4, { width: 85, align: 'right' });
  doc.fillColor(COULEURS.encre).font('Helvetica');
  y += 30;

  if (order.payment_method === 'a_credit' && creditInfo) {
    doc.fontSize(9).fillColor(COULEURS.muted).text('DÉJÀ RÉGLÉ', 300, y, { width: 145, align: 'right' });
    doc.fontSize(10).fillColor(COULEURS.encre).text(`${formatMontant(creditInfo.avance)} ${order.currency}`, 460, y, { width: 85, align: 'right' });
    y += 16;

    doc.fontSize(9).fillColor(COULEURS.muted).text('RESTE À PAYER', 300, y, { width: 145, align: 'right' });
    doc.fontSize(11).font('Helvetica-Bold').fillColor(COULEURS.encre).text(`${formatMontant(creditInfo.reste)} ${order.currency}`, 460, y, { width: 85, align: 'right' });
    doc.font('Helvetica');
    y += 16;
  } else {
    doc.fontSize(9).fillColor(COULEURS.muted).text('MONTANT REÇU', 300, y, { width: 145, align: 'right' });
    doc.fontSize(10).fillColor(COULEURS.encre).text(`${formatMontant(order.amount_received)} ${order.currency}`, 460, y, { width: 85, align: 'right' });
    y += 16;

    if (Number(order.change_given) > 0) {
      doc.fontSize(9).fillColor(COULEURS.muted).text('MONNAIE RENDUE', 300, y, { width: 145, align: 'right' });
      doc.fontSize(10).fillColor(COULEURS.encre).text(`${formatMontant(order.change_given)} ${order.currency}`, 460, y, { width: 85, align: 'right' });
      y += 16;
    }
  }

  doc.fontSize(9).fillColor(COULEURS.mutedClair)
    .text('Merci pour votre confiance.', 50, doc.page.height - 85, { width: doc.page.width - 100, align: 'center' });

  dessinerPiedDePage(doc, merchant);
  doc.end();
}

// GET /orders/:id/receipt-pdf — reçu de caisse : ticket étroit pour un
// client de passage, facture A4 pour un client enregistré.
router.get('/:id/receipt-pdf', async (req, res) => {
  try {
    const order = await getOrderReceiptDetail(req.user.merchantId, req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });

    if (order.client_id) {
      let creditInfo = null;
      if (order.payment_method === 'a_credit') {
        creditInfo = await calculerAvanceFacture(req.user.merchantId, order.client_id, order.id);
      }
      genererFactureA4(res, order, creditInfo);
    } else {
      genererTicketEtroit(res, order);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la génération du reçu.' });
  }
});

module.exports = router;
