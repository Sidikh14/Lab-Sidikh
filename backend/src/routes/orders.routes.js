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
const TYPES_REDUCTION = ['remise', 'rabais', 'ristourne', 'escompte'];
const MODES_REDUCTION = ['pourcentage', 'montant'];

const router = express.Router();
router.use(authenticate);

// Même logique que dans products_routes.js : manager choisit toujours
// explicitement la boutique, les autres rôles utilisent la leur (assignée
// via req.user.warehouseId), sans jamais faire confiance à un warehouseId
// envoyé par un rôle assigné.
async function resolveWarehouseId(req, dbClient, providedId) {
  const runner = dbClient || pool;

  if (req.user.role === 'manager') {
    if (!providedId) {
      throw { status: 400, message: 'La boutique est requise.' };
    }
    const result = await runner.query(
      `SELECT id FROM warehouses WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
      [providedId, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      throw { status: 404, message: 'Boutique introuvable.' };
    }
    return providedId;
  }

  if (!req.user.warehouseId) {
    throw { status: 403, message: "Vous n'êtes assigné à aucune boutique." };
  }
  return req.user.warehouseId;
}

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

// GET /orders — liste des commandes récentes du commerçant. Un employé
// assigné à une boutique ne voit QUE les commandes de sa boutique ; le
// manager voit tout, ou une boutique précise via ?warehouseId=.
router.get('/', async (req, res) => {
  try {
    const conditions = ['o.merchant_id = $1'];
    const params = [req.user.merchantId];

    if (req.user.role !== 'manager') {
      if (!req.user.warehouseId) {
        return res.status(403).json({ error: "Vous n'êtes assigné à aucune boutique." });
      }
      params.push(req.user.warehouseId);
      conditions.push(`o.warehouse_id = $${params.length}`);
    } else if (req.query.warehouseId) {
      params.push(req.query.warehouseId);
      conditions.push(`o.warehouse_id = $${params.length}`);
    }

    const result = await pool.query(
      `SELECT o.id, o.order_seq, o.status, o.total_amount, o.subtotal_amount, o.tva_applicable,
              o.tva_amount, o.payment_method, o.amount_received, o.change_given,
              o.created_at, o.assigned_cashier_id, o.returned_at, o.returned_reason,
              o.warehouse_id, w.name AS warehouse_name,
              c.full_name AS client_name,
              cr.status AS credit_request_status, cr.rejection_reason AS credit_request_reason
       FROM orders o
       LEFT JOIN clients c ON c.id = o.client_id
       LEFT JOIN warehouses w ON w.id = o.warehouse_id
       LEFT JOIN LATERAL (
         SELECT status, rejection_reason FROM credit_requests
         WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1
       ) cr ON true
       WHERE ${conditions.join(' AND ')}
       ORDER BY o.created_at DESC
       LIMIT 100`,
      params
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

  const conditions = ['o.merchant_id = $1', 'o.created_at::date BETWEEN $2 AND $3'];
  const params = [req.user.merchantId, from, to];

  if (req.user.role !== 'manager') {
    if (!req.user.warehouseId) {
      return res.status(403).json({ error: "Vous n'êtes assigné à aucune boutique." });
    }
    params.push(req.user.warehouseId);
    conditions.push(`o.warehouse_id = $${params.length}`);
  } else if (req.query.warehouseId) {
    params.push(req.query.warehouseId);
    conditions.push(`o.warehouse_id = $${params.length}`);
  }

  try {
    const merchantResult = await pool.query(`SELECT business_name FROM merchants WHERE id = $1`, [req.user.merchantId]);
    const businessName = merchantResult.rows[0]?.business_name;

    const result = await pool.query(
      `SELECT o.order_seq, o.created_at, o.status, o.total_amount, o.payment_method,
              c.full_name AS client_name
       FROM orders o
       LEFT JOIN clients c ON c.id = o.client_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY o.created_at ASC`,
      params
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
    if (req.user.role !== 'manager' && order.warehouse_id !== req.user.warehouseId) {
      return res.status(403).json({ error: 'Cette commande ne concerne pas votre boutique.' });
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
  const { clientId, items, notes, tvaApplicable, clientOrderId, warehouseId: warehouseIdInput } = req.body;
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
    const warehouseId = await resolveWarehouseId(req, client, warehouseIdInput);

    await client.query('BEGIN');

    let subtotalAmount = 0;
    let stockOverrideUtilise = false;
    const resolvedItems = [];

    for (const item of items) {
      if (!item.productId || typeof item.quantity !== 'number' || item.quantity <= 0) {
        throw { status: 400, message: 'Article de commande invalide.' };
      }

      const productResult = await client.query(
        `SELECT p.id, p.name, p.unit_price, p.is_weighted,
                COALESCE(ps.quantity_in_stock, 0) AS quantity_in_stock
         FROM products p
         LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.warehouse_id = $3
         WHERE p.id = $1 AND p.merchant_id = $2 FOR UPDATE OF p`,
        [item.productId, req.user.merchantId, warehouseId]
      );
      const product = productResult.rows[0];
      if (!product) {
        throw { status: 404, message: `Produit ${item.productId} introuvable.` };
      }
      if (!product.is_weighted && !Number.isInteger(item.quantity)) {
        throw { status: 400, message: `${product.name} n'est pas vendu au poids : la quantité doit être un nombre entier.` };
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
      `INSERT INTO orders (merchant_id, client_id, created_by, status, subtotal_amount, tva_applicable, tva_rate, tva_amount, total_amount, notes, stock_override, client_order_id, warehouse_id)
       VALUES ($1, $2, $3, 'en_attente', $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
        warehouseId,
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
      await client.query(
        `INSERT INTO product_stock (merchant_id, product_id, warehouse_id, quantity_in_stock)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id, warehouse_id)
         DO UPDATE SET quantity_in_stock = $4`,
        [req.user.merchantId, resolved.product.id, warehouseId, newQuantity]
      );

      await client.query(
        `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, warehouse_id)
         VALUES ($1, $2, $3, 'sortie', $4, $5, $6)`,
        [req.user.merchantId, resolved.product.id, req.user.id, resolved.baseQuantity, `Commande ${order.id}`, warehouseId]
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

// PATCH /orders/:id/payment — encaissement par le caissier, le manager, ou
// le gérant (uniquement pour une vente qu'il a créée lui-même — voir la
// vérification plus bas juste après la récupération de la commande).
// Enregistre le moyen de paiement, le montant reçu, calcule la monnaie à
// rendre, et fait passer la commande au statut "validée".
router.patch('/:id/payment', requireRole('manager', 'caissier', 'gerant'), async (req, res) => {
  const {
    paymentMethod, amountReceived, needsDelivery, deliveryFee, deliveryAddress,
    discountType, discountMode, discountValue, advanceAmount, advancePaymentMethod,
  } = req.body;

  if (!MOYENS_PAIEMENT.includes(paymentMethod)) {
    return res.status(400).json({ error: 'Moyen de paiement invalide.' });
  }

  // Réduction commerciale (remise/rabais/ristourne/escompte) : réservée au
  // manager, comme le prix personnalisé et la vente en rupture autorisée.
  const aReduction = discountType !== undefined && discountType !== null && discountType !== '';
  if (aReduction) {
    if (req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Seul le manager peut appliquer une réduction commerciale.' });
    }
    if (!TYPES_REDUCTION.includes(discountType)) {
      return res.status(400).json({ error: 'Type de réduction invalide.' });
    }
    if (!MODES_REDUCTION.includes(discountMode)) {
      return res.status(400).json({ error: 'Mode de réduction invalide (pourcentage ou montant).' });
    }
    if (typeof discountValue !== 'number' || discountValue <= 0) {
      return res.status(400).json({ error: 'Valeur de réduction invalide.' });
    }
    if (discountMode === 'pourcentage' && discountValue > 100) {
      return res.status(400).json({ error: 'Le pourcentage de réduction ne peut pas dépasser 100.' });
    }
  }

  const estACredit = paymentMethod === 'a_credit';

  // Avance versée directement par le client au moment de la vente à
  // crédit (optionnelle) : réduit immédiatement la créance et impacte la
  // caisse du moyen de paiement choisi pour l'avance (jamais 'a_credit').
  const MOYENS_PAIEMENT_CONCRETS = ['especes', 'wave', 'orange_money', 'cheque', 'virement'];
  const aAvance = estACredit && typeof advanceAmount === 'number' && advanceAmount > 0;
  if (estACredit && advanceAmount !== undefined && advanceAmount !== null && advanceAmount !== 0) {
    if (typeof advanceAmount !== 'number' || advanceAmount < 0) {
      return res.status(400).json({ error: "Montant de l'avance invalide." });
    }
    if (!MOYENS_PAIEMENT_CONCRETS.includes(advancePaymentMethod)) {
      return res.status(400).json({ error: "Moyen de paiement de l'avance invalide." });
    }
  }

  if (!estACredit && (typeof amountReceived !== 'number' || amountReceived < 0)) {
    return res.status(400).json({ error: 'Montant reçu invalide.' });
  }

  // La livraison n'est prise en compte que si la case est cochée ; sinon on
  // ignore tout montant/adresse envoyé par erreur (pas de frais ni d'adresse
  // sans livraison). L'adresse est obligatoire dès que la livraison est
  // prévue — c'est elle qui apparaît sur la facture.
  const aLivrer = Boolean(needsDelivery);
  let fraisLivraison = 0;
  let adresseLivraison = null;
  if (aLivrer) {
    if (deliveryFee !== undefined && deliveryFee !== null) {
      if (typeof deliveryFee !== 'number' || deliveryFee < 0) {
        return res.status(400).json({ error: 'Montant de livraison invalide.' });
      }
      fraisLivraison = deliveryFee;
    }
    if (typeof deliveryAddress !== 'string' || !deliveryAddress.trim()) {
      return res.status(400).json({ error: "L'adresse de livraison est requise." });
    }
    adresseLivraison = deliveryAddress.trim();
  }

  try {
    const orderResult = await pool.query(
      `SELECT id, total_amount, status, client_id, warehouse_id, created_by FROM orders WHERE id = $1 AND merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    if (req.user.role !== 'manager' && order.warehouse_id !== req.user.warehouseId) {
      return res.status(403).json({ error: 'Cette commande ne concerne pas votre boutique.' });
    }
    // Le gérant ne peut encaisser que les ventes qu'il a lui-même créées ;
    // au-delà, c'est au caissier (ou au manager) de s'en charger.
    if (req.user.role === 'gerant' && order.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Vous ne pouvez encaisser que les ventes que vous avez vous-même créées.' });
    }
    if (order.status !== 'en_attente') {
      return res.status(400).json({ error: 'Cette commande a déjà été traitée.' });
    }

    // Une vente à crédit n'est autorisée que pour un client déjà enregistré
    // — un client de passage doit d'abord être créé (via une demande de
    // validation gérant/manager, à venir).
    if (estACredit && !order.client_id) {
      return res.status(400).json({ error: 'La vente à crédit n\'est autorisée que pour un client déjà enregistré.' });
    }

    // Réduction calculée sur le total avant frais de livraison, jamais
    // au-delà du total (le total ne peut pas devenir négatif).
    let montantReduction = 0;
    if (aReduction) {
      montantReduction =
        discountMode === 'pourcentage'
          ? Math.round(Number(order.total_amount) * (discountValue / 100))
          : Math.round(discountValue);
      montantReduction = Math.min(montantReduction, Number(order.total_amount));
    }

    // Montant total réellement dû, réduction déduite et frais de livraison inclus.
    const montantDu = Number(order.total_amount) - montantReduction + fraisLivraison;

    if (aAvance && advanceAmount > montantDu) {
      return res.status(400).json({ error: "L'avance ne peut pas dépasser le montant total de la facture." });
    }

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
         delivery_address = $10,
         discount_type = $11,
         discount_mode = $12,
         discount_value = $13,
         discount_amount = $14,
         total_amount = total_amount + $9 - $14
         ${marqueeLivreeTouteSuite ? ', delivered_by = $4, delivered_at = now()' : ''}
       WHERE id = $5 AND merchant_id = $6
       RETURNING *`,
      [
        paymentMethod,
        montantRecuFinal,
        changeGiven,
        req.user.id,
        req.params.id,
        req.user.merchantId,
        marqueeLivreeTouteSuite ? 'livree' : 'validee',
        aLivrer,
        fraisLivraison,
        adresseLivraison,
        aReduction ? discountType : null,
        aReduction ? discountMode : null,
        aReduction ? discountValue : null,
        montantReduction,
      ]
    );
    const orderMisAJour = result.rows[0];

    if (aReduction) {
      await logActivity({
        merchantId: req.user.merchantId,
        userId: req.user.id,
        action: 'order_discount',
        description: `a appliqué une ${discountType} de ${discountMode === 'pourcentage' ? `${discountValue}%` : formatMontant(discountValue)} (${formatMontant(montantReduction)}) sur la commande ${formatOrderNumber(orderMisAJour)}`,
      });
    }

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

    if (aAvance) {
      await pool.query(
        `INSERT INTO credit_payments (merchant_id, client_id, recorded_by, amount, payment_method, warehouse_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.user.merchantId, order.client_id, req.user.id, advanceAmount, advancePaymentMethod, order.warehouse_id]
      );

      await logActivity({
        merchantId: req.user.merchantId,
        userId: req.user.id,
        action: 'order_credit_advance',
        description: `a encaissé une avance de ${formatMontant(advanceAmount)} sur la commande ${formatOrderNumber(orderMisAJour)}`,
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
      `SELECT id, status, warehouse_id FROM orders WHERE id = $1 AND merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    if (req.user.role !== 'manager' && order.warehouse_id !== req.user.warehouseId) {
      return res.status(403).json({ error: 'Cette commande ne concerne pas votre boutique.' });
    }
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
    if (req.user.role !== 'manager' && orderExistant.warehouse_id !== req.user.warehouseId) {
      throw { status: 403, message: 'Cette commande ne concerne pas votre boutique.' };
    }

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
          `INSERT INTO product_stock (merchant_id, product_id, warehouse_id, quantity_in_stock)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (product_id, warehouse_id)
           DO UPDATE SET quantity_in_stock = product_stock.quantity_in_stock + $4`,
          [req.user.merchantId, item.product_id, orderExistant.warehouse_id, item.quantity]
        );
        await client.query(
          `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, warehouse_id)
           VALUES ($1, $2, $3, 'entree', $4, $5, $6)`,
          [req.user.merchantId, item.product_id, req.user.id, item.quantity, `Annulation commande ${formatOrderNumber(orderExistant)}`, orderExistant.warehouse_id]
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
    if (req.user.role !== 'manager' && order.warehouse_id !== req.user.warehouseId) {
      throw { status: 403, message: 'Cette commande ne concerne pas votre boutique.' };
    }
    // La boutique de la commande ne change pas lors d'une modification —
    // elle reste celle d'origine (order.warehouse_id).
    const warehouseId = order.warehouse_id;

    // 1. On remet en stock les anciens articles avant d'appliquer les nouveaux.
    const anciensItems = await client.query(
      `SELECT product_id, quantity FROM order_items WHERE order_id = $1`,
      [order.id]
    );
    for (const ancien of anciensItems.rows) {
      await client.query(
        `INSERT INTO product_stock (merchant_id, product_id, warehouse_id, quantity_in_stock)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id, warehouse_id)
         DO UPDATE SET quantity_in_stock = product_stock.quantity_in_stock + $4`,
        [req.user.merchantId, ancien.product_id, warehouseId, ancien.quantity]
      );
      await client.query(
        `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, warehouse_id)
         VALUES ($1, $2, $3, 'entree', $4, $5, $6)`,
        [req.user.merchantId, ancien.product_id, req.user.id, ancien.quantity, `Correction commande ${formatOrderNumber(order)} (retour caissier)`, warehouseId]
      );
    }
    await client.query(`DELETE FROM order_items WHERE order_id = $1`, [order.id]);

    // 2. On applique les nouveaux articles — même logique que la création.
    let subtotalAmount = 0;
    let stockOverrideUtilise = false;
    const resolvedItems = [];

    for (const item of items) {
      if (!item.productId || typeof item.quantity !== 'number' || item.quantity <= 0) {
        throw { status: 400, message: 'Article de commande invalide.' };
      }

      const productResult = await client.query(
        `SELECT p.id, p.name, p.unit_price, p.is_weighted,
                COALESCE(ps.quantity_in_stock, 0) AS quantity_in_stock
         FROM products p
         LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.warehouse_id = $3
         WHERE p.id = $1 AND p.merchant_id = $2 FOR UPDATE OF p`,
        [item.productId, req.user.merchantId, warehouseId]
      );
      const product = productResult.rows[0];
      if (!product) {
        throw { status: 404, message: `Produit ${item.productId} introuvable.` };
      }
      if (!product.is_weighted && !Number.isInteger(item.quantity)) {
        throw { status: 400, message: `${product.name} n'est pas vendu au poids : la quantité doit être un nombre entier.` };
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
      await client.query(
        `INSERT INTO product_stock (merchant_id, product_id, warehouse_id, quantity_in_stock)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id, warehouse_id)
         DO UPDATE SET quantity_in_stock = $4`,
        [req.user.merchantId, resolved.product.id, warehouseId, newQuantity]
      );

      await client.query(
        `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, warehouse_id)
         VALUES ($1, $2, $3, 'sortie', $4, $5, $6)`,
        [req.user.merchantId, resolved.product.id, req.user.id, resolved.baseQuantity, `Commande ${formatOrderNumber(order)} (modifiée)`, warehouseId]
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
            m.business_name, m.currency, m.ninea, m.rccm,
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
  // La facture doit tenir sur une seule page : PDFKit ajoute automatiquement
  // une page dès qu'un texte positionné (même avec x/y explicites) risque
  // de déborder du bas de la page en cours — même bug déjà rencontré et
  // corrigé sur le ticket de caisse (voir genererTicketEtroit). On préfère
  // un léger débordement en bas plutôt que des pages parasites quasi vides.
  doc.addPage = function () { return this; };
  doc.pipe(res);
  enregistrerPolices(doc);

  const merchant = {
    ninea: order.ninea,
    rccm: order.rccm,
    address: order.merchant_address,
    bank_details: order.bank_details,
    mobile_money_details: order.mobile_money_details,
    payment_terms: order.payment_terms,
  };

  const largeurPage = doc.page.width;
  const largeurContenu = largeurPage - 100;

  // Titre "FACTURE" seul en haut de page, très grand, en gras sans-serif —
  // exactement comme sur la maquette envoyée par l'utilisateur.
  doc.font('Helvetica-Bold').fontSize(40).fillColor(COULEURS.encre)
    .text('FACTURE', 50, 45, { width: largeurContenu, align: 'right' });
  doc.font('Helvetica').fontSize(13).fillColor(COULEURS.muted)
    .text(order.order_number, 50, 92, { width: largeurContenu, align: 'right' });

  // Les deux blocs (émetteur à gauche, client à droite) démarrent tous les
  // deux SOUS le titre, avec un espace net entre les deux zones.
  let yG = 160;
  doc.font('Helvetica-Bold').fontSize(15).fillColor(COULEURS.encre)
    .text(order.business_name || 'Commerce', 50, yG, { width: 260 });
  yG += 24;
  doc.font('Helvetica').fontSize(10).fillColor(COULEURS.encre);
  [merchant.address, merchant.ninea && `NINEA ${merchant.ninea}`, merchant.rccm && `RCCM ${merchant.rccm}`]
    .filter(Boolean)
    .forEach((ligne) => { doc.text(ligne, 50, yG, { width: 260 }); yG += 15; });

  let yD = 160;
  const droite = (texte, opts = {}) => {
    doc.text(texte, 320, yD, { width: 225, align: 'right', ...opts });
    yD += opts.hauteur || 15;
  };
  doc.font('Helvetica').fontSize(10).fillColor(COULEURS.encre);
  droite(`Date d'émission : ${new Date(order.validated_at || order.created_at).toLocaleDateString('fr-FR')}`, { hauteur: 18 });
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COULEURS.encre);
  droite(order.client_name, { hauteur: 17 });
  doc.font('Helvetica').fontSize(10).fillColor(COULEURS.encre);
  if (order.client_phone) droite(order.client_phone);
  if (order.client_address) droite(order.client_address);
  droite(`Vendeur : ${order.vendeur_name || '—'}`);
  droite(`Caissier : ${order.caissier_name || '—'}`);
  droite(`Paiement : ${MOYENS_PAIEMENT_LABEL[order.payment_method] || '—'}`);
  droite(`Livraison : ${order.needs_delivery ? 'à livrer' : 'remise en main propre'}`);

  let y = Math.max(yG, yD) + 30;

  // Encart "Adresse de livraison" bien visible, juste avant les articles —
  // uniquement si une livraison est prévue sur cette commande.
  if (order.needs_delivery && order.delivery_address) {
    const largeurTexte = largeurContenu - 24;
    doc.font('Helvetica').fontSize(10.5);
    const hauteurTexte = doc.heightOfString(order.delivery_address, { width: largeurTexte });
    const hauteurEncart = 28 + hauteurTexte;
    doc.roundedRect(50, y, largeurContenu, hauteurEncart, 4).fillAndStroke('#f6f6f6', COULEURS.bordure);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COULEURS.muted)
      .text('ADRESSE DE LIVRAISON', 62, y + 8, { characterSpacing: 0.5 });
    doc.font('Helvetica').fontSize(10.5).fillColor(COULEURS.encre)
      .text(order.delivery_address, 62, y + 21, { width: largeurTexte });
    y += hauteurEncart + 20;
  }

  // Grand titre de section, gras sans-serif, comme sur la maquette.
  doc.font('Helvetica-Bold').fontSize(28).fillColor(COULEURS.encre).text('Description', 50, y);
  y += 42;
  traitSeparateur(doc, y);
  y += 22;

  order.items.forEach((item) => {
    const quantiteAffichee = item.packaging_label ? item.packaging_quantity : item.quantity;
    const prixUnitaire = item.line_total / quantiteAffichee;
    const sousLigne = item.packaging_label
      ? `${item.packaging_label} · ${quantiteAffichee} × ${formatMontant(prixUnitaire)} ${order.currency}`
      : `${quantiteAffichee} × ${formatMontant(prixUnitaire)} ${order.currency}`;

    doc.font('Helvetica').fontSize(13).fillColor(COULEURS.encre)
      .text(item.product_name, 50, y, { width: 320 });
    doc.font('Helvetica').fontSize(13).fillColor(COULEURS.encre)
      .text(`${formatMontant(item.line_total)} ${order.currency}`, 350, y, { width: 195, align: 'right' });
    doc.font('Helvetica').fontSize(8.5).fillColor(COULEURS.muted).text(sousLigne, 50, y + 17, { width: 320 });

    y += 42;
  });

  traitSeparateur(doc, y);
  y += 24;

  // Bloc des totaux, aligné à droite, en gras — même esprit que la maquette
  // (libellé directement collé à sa valeur, hiérarchie par la taille).
  const xLabel = 280, wLabel = 165, xValeur = 445, wValeur = 100;
  const ligneTotal = (label, valeur, { grand = false, discret = false } = {}) => {
    const taille = grand ? 20 : 12.5;
    const xLbl = grand ? 260 : xLabel;
    const wLbl = grand ? 115 : wLabel;
    const xVal = grand ? 380 : xValeur;
    const wVal = grand ? 165 : wValeur;
    doc.font('Helvetica-Bold').fontSize(taille).fillColor(discret ? COULEURS.muted : COULEURS.encre)
      .text(label, xLbl, y, { width: wLbl, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(taille).fillColor(discret ? COULEURS.muted : COULEURS.encre)
      .text(`${formatMontant(valeur)} ${order.currency}`, xVal, y, { width: wVal, align: 'right' });
    y += grand ? 30 : 20;
  };

  ligneTotal('Sous total :', order.subtotal_amount);
  if (order.tva_applicable) ligneTotal(`TVA (${TVA_RATE}%) :`, order.tva_amount);
  if (order.discount_type && Number(order.discount_amount) > 0) {
    const labelReduction = { remise: 'Remise', rabais: 'Rabais', ristourne: 'Ristourne', escompte: 'Escompte' }[order.discount_type] || 'Réduction';
    const detailReduction = order.discount_mode === 'pourcentage' ? ` (${order.discount_value}%)` : '';
    ligneTotal(`${labelReduction}${detailReduction} :`, -Math.round(Number(order.discount_amount)), { discret: true });
  }
  if (order.needs_delivery && Number(order.delivery_fee) > 0) {
    ligneTotal('Frais de livraison :', order.delivery_fee);
  }
  y += 4;
  ligneTotal('TOTAL :', order.total_amount, { grand: true });
  y += 8;

  if (order.payment_method === 'a_credit' && creditInfo) {
    ligneTotal('Déjà réglé :', creditInfo.avance, { discret: true });
    ligneTotal('Reste à payer :', creditInfo.reste);
  } else {
    ligneTotal('Montant reçu :', order.amount_received, { discret: true });
    if (Number(order.change_given) > 0) ligneTotal('Monnaie rendue :', order.change_given, { discret: true });
  }

  y += 34;

  // Pied de page en deux colonnes (informations de paiement / conditions),
  // comme sur la maquette — seulement si le commerçant a renseigné l'un ou
  // l'autre.
  const infosPaiement = [merchant.bank_details && `Coordonnées bancaires : ${merchant.bank_details}`, merchant.mobile_money_details && `Mobile Money : ${merchant.mobile_money_details}`].filter(Boolean);
  const conditions = merchant.payment_terms;

  if (infosPaiement.length > 0 || conditions) {
    traitSeparateur(doc, y);
    y += 16;

    let yFG = y;
    let yFD = y;
    const largeurCol = 240;
    if (infosPaiement.length > 0) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COULEURS.encre).text('Informations de paiement', 50, yFG, { width: largeurCol });
      yFG += 15;
      doc.font('Helvetica').fontSize(8.5).fillColor(COULEURS.muted);
      infosPaiement.forEach((ligne) => {
        doc.text(ligne, 50, yFG, { width: largeurCol });
        yFG += doc.heightOfString(ligne, { width: largeurCol }) + 3;
      });
    }
    if (conditions) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COULEURS.encre).text('Conditions et termes', 305, yFD, { width: largeurCol, align: 'right' });
      yFD += 15;
      doc.font('Helvetica').fontSize(8.5).fillColor(COULEURS.muted)
        .text(conditions, 305, yFD, { width: largeurCol, align: 'right' });
    }
  }

  doc.font('Helvetica').fillColor(COULEURS.encre);
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
