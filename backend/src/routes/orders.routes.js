const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');
const { broadcast } = require('../utils/eventsBus');
const {
  COULEURS, formatMontant, dessinerEntete, dessinerEnteteTableau, dessinerBandeauTotal, dessinerPiedDePage, traitSeparateur, traitPointille,
  enregistrerPolices, dessinerEmblem, lireLogoCommercant, dessinerLogoCommercant,
} = require('../utils/pdfHelpers');
const { FORMATS, TAILLES, MENTION_EDITEUR, mmEnPt, nomFichierPdf, metadonneesPdf } = require('../utils/pdfTheme');
const { creerAlerte, getSeuilVenteElevee, getNomUtilisateur } = require('../services/alerts.service');
const { consumeFEFO } = require('../utils/lots');

const TVA_RATE = 18; // Taux de TVA appliqué aux produits soumis à la TVA (%)

// TVA d'une commande — tous secteurs (pharmacie comprise).
// La TVA se décide produit par produit (products.tva_applicable, réglable
// depuis la page Stock : certains produits sont exonérés). On ne taxe que les
// lignes soumises à la TVA ; tout tvaApplicable envoyé par le client est
// ignoré. Un produit sans valeur (null/undefined) est considéré taxable,
// comme le défaut en base.
// Arrondi en FCFA entiers : on arrondit le montant de TVA lui-même.
const REGIMES_TVA = ['normal', 'export', 'suspension'];
// Type d'opération de la vente : « normal » (TVA selon chaque produit), « export » (exportation) ou
// « suspension » (affaire en suspension de TVA). Les deux derniers ne portent aucune TVA.
function lireRegimeTva(valeur, parDefaut = 'normal') {
  if (valeur === undefined || valeur === null || valeur === '') return parDefaut;
  if (!REGIMES_TVA.includes(valeur)) throw { status: 400, message: "Type d'opération invalide (normal, exportation ou suspension de TVA)." };
  return valeur;
}
function calculerTvaCommande({ resolvedItems, regime = 'normal' }) {
  if (regime !== 'normal') return { tvaAmount: 0, tvaApplicable: false };
  const baseTaxable = resolvedItems.reduce(
    (somme, r) => (r.product.tva_applicable === false ? somme : somme + r.lineTotal),
    0
  );
  const tvaAmount = Math.round(baseTaxable * (TVA_RATE / 100));
  return { tvaAmount, tvaApplicable: tvaAmount > 0 };
}
const SEUIL_ALERTE_PEREMPTION_JOURS = 30; // Pharmacie : lot bientôt périmé, vente réservée au pharmacien responsable
const MOYENS_PAIEMENT = ['especes', 'wave', 'orange_money', 'cheque', 'virement', 'a_credit', 'tiers_payant'];
const TYPES_REDUCTION = ['remise', 'rabais', 'ristourne', 'escompte'];
const MODES_REDUCTION = ['pourcentage', 'montant'];
// Reliquat (commande client en attente sur rupture de stock) : réservé à
// ces secteurs — la pharmacie a déjà ses propres mécanismes (équivalents,
// lots) et ne doit jamais faire attendre un client sur un médicament.
const SECTEURS_RELIQUAT = ['grossiste', 'textile', 'electromenager'];

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
      `SELECT id, type FROM warehouses WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
      [providedId, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      throw { status: 404, message: 'Boutique introuvable.' };
    }
    // Un dépôt sert au stockage uniquement : aucune vente possible dessus.
    if (result.rows[0].type === 'depot') {
      throw { status: 400, message: 'Un dépôt ne peut pas enregistrer de vente. Choisissez une boutique.' };
    }
    return providedId;
  }

  if (!req.user.warehouseId) {
    throw { status: 403, message: "Vous n'êtes assigné à aucune boutique." };
  }
  const assignee = await runner.query(`SELECT type FROM warehouses WHERE id = $1`, [req.user.warehouseId]);
  if (assignee.rows[0]?.type === 'depot') {
    throw { status: 403, message: "Votre lieu d'affectation est un dépôt : aucune vente n'y est possible." };
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
              o.created_at, o.created_by, o.assigned_cashier_id, o.returned_at, o.returned_reason,
              o.warehouse_id, w.name AS warehouse_name,
              c.full_name AS client_name,
              cr.status AS credit_request_status, cr.rejection_reason AS credit_request_reason,
              EXISTS (SELECT 1 FROM product_returns pr WHERE pr.order_id = o.id) AS has_return
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
      `SELECT o.*, c.full_name AS client_name,
              EXISTS (SELECT 1 FROM product_returns pr WHERE pr.order_id = o.id) AS has_return
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

// Ordonnance renouvelable/chronique : vérifie que l'ordonnance n'est pas
// expirée et que chaque produit prescrit garde assez de quantité à délivrer
// (prescrit - déjà délivré sur les commandes non annulées). Le verrou sur la
// ligne de l'ordonnance sérialise les ventes simultanées qui la consomment.
// excludeOrderId : commande en cours de modification (PUT), à ne pas compter.
async function verifierOrdonnanceRenouvelable(dbClient, merchantId, prescriptionId, resolvedItems, excludeOrderId) {
  const prescResult = await dbClient.query(
    `SELECT id, is_renewable, (valid_until IS NOT NULL AND valid_until < CURRENT_DATE) AS expiree
     FROM prescriptions WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
    [prescriptionId, merchantId]
  );
  const prescription = prescResult.rows[0];
  if (!prescription || !prescription.is_renewable) return;

  if (prescription.expiree) {
    throw { status: 400, message: 'Cette ordonnance renouvelable est expirée.' };
  }

  const lignesResult = await dbClient.query(
    `SELECT pi.product_id, pi.quantity_prescribed, pr.name,
            COALESCE((
              SELECT SUM(oi.quantity)
              FROM order_items oi
              JOIN orders o ON o.id = oi.order_id
              WHERE o.prescription_id = pi.prescription_id
                AND oi.product_id = pi.product_id
                AND o.status <> 'annulee'
                AND ($2::uuid IS NULL OR o.id <> $2::uuid)
            ), 0) AS delivered
     FROM prescription_items pi
     JOIN products pr ON pr.id = pi.product_id
     WHERE pi.prescription_id = $1`,
    [prescriptionId, excludeOrderId || null]
  );
  const parProduit = new Map(lignesResult.rows.map((r) => [r.product_id, r]));

  const demandeParProduit = new Map();
  for (const r of resolvedItems) {
    demandeParProduit.set(r.product.id, (demandeParProduit.get(r.product.id) || 0) + r.baseQuantity);
  }

  for (const r of resolvedItems) {
    if (r.product.requires_prescription && !parProduit.has(r.product.id)) {
      throw { status: 400, message: `${r.product.name} n'est pas prescrit sur cette ordonnance renouvelable.` };
    }
  }

  for (const [productId, demande] of demandeParProduit) {
    const ligne = parProduit.get(productId);
    if (!ligne) continue; // produit hors ordonnance (vente libre) : pas de plafond
    const prescrit = Number(ligne.quantity_prescribed);
    const delivre = Number(ligne.delivered);
    const reste = Math.max(0, prescrit - delivre);
    if (demande > reste) {
      throw {
        status: 400,
        message: `Ordonnance : il ne reste que ${reste} ${ligne.name} à délivrer (prescrit ${prescrit}, déjà délivré ${delivre}).`,
      };
    }
  }
}

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
router.post('/', requireRole('manager', 'gerant', 'vendeur', 'vendeur_caissier'), async (req, res) => {
  const { clientId, items, notes, tvaApplicable, clientOrderId, warehouseId: warehouseIdInput, prescriptionId, tvaRegime, precompte } = req.body;
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
        `SELECT p.id, p.name, p.unit_price, p.cost_price, p.is_weighted, p.quantity_alert_threshold, p.requires_prescription, p.tva_applicable,
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
      // Part de la vente réellement couverte par le stock actuel, et part
      // manquante qui deviendra une réservation (reliquat) si le secteur
      // le permet — jamais l'inverse : le stock ne descend jamais sous 0.
      const quantiteDisponible = Math.min(baseQuantity, Math.max(0, product.quantity_in_stock));
      const quantiteManquante = baseQuantity - quantiteDisponible;
      if (rupture) {
        if (req.user.role !== 'manager' || !item.authorizeOutOfStock) {
          throw { status: 400, message: `Stock insuffisant pour ${product.name}.` };
        }
        stockOverrideUtilise = true;
        if (quantiteManquante > 0 && SECTEURS_RELIQUAT.includes(req.user.sector) && !clientId) {
          throw {
            status: 400,
            message: `${product.name} : un client enregistré est requis pour créer une commande en attente (reliquat) sur un article en rupture.`,
          };
        }
      }

      const lineTotal = prixParConditionnement * item.quantity;
      subtotalAmount += lineTotal;
      resolvedItems.push({
        product,
        baseQuantity,
        quantiteDisponible,
        quantiteManquante,
        unitPrice: prixParConditionnement / quantitePerUnite,
        originalUnitPrice: originalUnitPrice !== null ? originalUnitPrice / quantitePerUnite : null,
        packagingLabel,
        packagingQuantity: packagingLabel ? item.quantity : null,
        rupture,
        lineTotal,
      });
    }

    // Pharmacie : si au moins un article vendu nécessite une ordonnance,
    // une ordonnance doit être liée à la commande — sinon on bloque la
    // vente (voir prescriptions.routes.js pour la création de l'ordonnance).
    const ordonnanceRequise = resolvedItems.some((r) => r.product.requires_prescription);
    if (ordonnanceRequise && !prescriptionId) {
      throw { status: 400, message: 'Une ordonnance est requise pour au moins un article de cette vente.' };
    }
    if (prescriptionId) {
      const prescriptionResult = await client.query(
        `SELECT id FROM prescriptions WHERE id = $1 AND merchant_id = $2`,
        [prescriptionId, req.user.merchantId]
      );
      if (prescriptionResult.rows.length === 0) {
        throw { status: 404, message: 'Ordonnance introuvable.' };
      }
      await verifierOrdonnanceRenouvelable(client, req.user.merchantId, prescriptionId, resolvedItems, null);
    }

    // Arrondi en FCFA entiers (pas de centimes) : on arrondit le montant de
    // TVA lui-même, pas un ratio intermédiaire, pour éviter les décimales.
    const regime = lireRegimeTva(tvaRegime);
    const { tvaAmount, tvaApplicable: tvaEffective } = calculerTvaCommande({ resolvedItems, regime });
    const totalAmount = Math.round(subtotalAmount + tvaAmount);
    // Précompte de TVA : le client retient la TVA de la vente et la verse lui-même au Trésor.
    const precompteMontant = precompte === true && regime === 'normal' ? tvaAmount : 0;

    const orderResult = await client.query(
      `INSERT INTO orders (merchant_id, client_id, created_by, status, subtotal_amount, tva_applicable, tva_rate, tva_amount, total_amount, notes, stock_override, client_order_id, warehouse_id, prescription_id, tva_regime, precompte_amount)
       VALUES ($1, $2, $3, 'en_attente', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        req.user.merchantId,
        clientId || null,
        req.user.id,
        subtotalAmount,
        tvaEffective,
        TVA_RATE,
        tvaAmount,
        totalAmount,
        notes || null,
        stockOverrideUtilise,
        clientOrderId || null,
        warehouseId,
        prescriptionId || null,
        regime,
        precompteMontant,
      ]
    );
    const order = orderResult.rows[0];
    const alertesStock = [];
    const reservationsCreees = [];

    for (const resolved of resolvedItems) {
      const orderItemResult = await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, original_unit_price, packaging_label, packaging_quantity, unit_cost)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [order.id, resolved.product.id, resolved.baseQuantity, resolved.unitPrice, resolved.originalUnitPrice, resolved.packagingLabel, resolved.packagingQuantity, Number(resolved.product.cost_price) || 0]
      );
      const orderItemId = orderItemResult.rows[0].id;

      // Réservation (reliquat) : la part non couverte par le stock actuel,
      // uniquement pour les secteurs concernés — le client attend la
      // prochaine livraison fournisseur pour cette quantité-là.
      if (resolved.quantiteManquante > 0 && SECTEURS_RELIQUAT.includes(req.user.sector)) {
        const reservationResult = await client.query(
          `INSERT INTO pending_reservations (merchant_id, warehouse_id, product_id, order_id, order_item_id, client_id, quantity, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [req.user.merchantId, warehouseId, resolved.product.id, order.id, orderItemId, clientId, resolved.quantiteManquante, req.user.id]
        );
        reservationsCreees.push({
          id: reservationResult.rows[0].id,
          productName: resolved.product.name,
          quantity: resolved.quantiteManquante,
        });
      }

      // Le stock ne descend jamais sous zéro, même en vente autorisée en rupture.
      const newQuantity = Math.max(0, resolved.product.quantity_in_stock - resolved.baseQuantity);
      await client.query(
        `INSERT INTO product_stock (merchant_id, product_id, warehouse_id, quantity_in_stock)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id, warehouse_id)
         DO UPDATE SET quantity_in_stock = $4`,
        [req.user.merchantId, resolved.product.id, warehouseId, newQuantity]
      );

      // Pharmacie + FEFO : si des lots existent pour ce produit, consomme
      // en priorité le lot dont la péremption est la plus proche, et
      // bloque la vente si le stock non périmé est insuffisant — un
      // produit périmé ne doit jamais pouvoir être vendu, même en override.
      if (req.user.sector === 'pharmacie') {
        const fefo = await consumeFEFO(client, {
          merchantId: req.user.merchantId,
          productId: resolved.product.id,
          warehouseId,
          quantity: resolved.baseQuantity,
        });
        if (fefo.tracked && !fefo.ok) {
          throw { status: 400, message: `${resolved.product.name} : stock non périmé insuffisant (lots restants périmés ou épuisés).` };
        }
        // Alerte bloquante péremption proche (< 30 jours) : seul le
        // pharmacien responsable (manager ou gérant) peut valider une
        // vente qui puise dans un lot bientôt périmé — un vendeur/caissier
        // doit lui faire valider la vente en personne, pas de mot de passe
        // de déblocage (décision utilisateur).
        if (fefo.tracked && fefo.consommes && !['manager', 'gerant'].includes(req.user.role)) {
          const dansMoins30Jours = fefo.consommes.some((c) => {
            const jours = (new Date(c.expiryDate) - new Date()) / (1000 * 60 * 60 * 24);
            return jours < SEUIL_ALERTE_PEREMPTION_JOURS;
          });
          if (dansMoins30Jours) {
            throw {
              status: 403,
              message: `${resolved.product.name} : ce lot périme dans moins de ${SEUIL_ALERTE_PEREMPTION_JOURS} jours — seul le pharmacien responsable (manager/gérant) peut valider cette vente.`,
            };
          }
        }
      }

      // On ne journalise que ce qui a réellement quitté le rayon — la part
      // réservée (quantiteManquante) n'est pas encore sortie physiquement,
      // elle le sera au moment de la réception fournisseur.
      if (resolved.quantiteDisponible > 0) {
        await client.query(
          `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, warehouse_id)
           VALUES ($1, $2, $3, 'sortie', $4, $5, $6)`,
          [req.user.merchantId, resolved.product.id, req.user.id, resolved.quantiteDisponible, `Commande ${order.id}`, warehouseId]
        );
      }

      // Alerte rupture / seuil bas : seulement au franchissement du seuil
      // (pas à chaque vente si le produit y était déjà, pour éviter de
      // spammer) — sauf la rupture complète (newQuantity === 0), toujours
      // notifiée même si le seuil avait déjà été franchi avant, car plus
      // grave que "juste bas".
      const seuilProduit = resolved.product.quantity_alert_threshold;
      const etaitDejaBas = resolved.product.quantity_in_stock <= seuilProduit;
      const franchitSeuil = !etaitDejaBas && newQuantity <= seuilProduit;
      const entreEnRupture = newQuantity === 0 && resolved.product.quantity_in_stock > 0;
      if (franchitSeuil || entreEnRupture) {
        alertesStock.push({ productId: resolved.product.id, productName: resolved.product.name, newQuantity });
      }

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
      if (resolved.quantiteManquante > 0 && SECTEURS_RELIQUAT.includes(req.user.sector)) {
        await logActivity({
          merchantId: req.user.merchantId,
          userId: req.user.id,
          action: 'order_reservation_created',
          description: `a créé une réservation (reliquat) de ${resolved.quantiteManquante} ${resolved.product.name} sur la commande ${formatOrderNumber(order)}`,
        });
      }
    }

    await client.query('COMMIT');
    const orderComplet = { ...order, order_number: formatOrderNumber(order) };
    // Diffusion en temps réel : la caisse (OrdersPage.jsx côté caissier)
    // n'a pas besoin d'actualiser la page pour voir apparaître cette vente.
    broadcast(req.user.merchantId, 'order:created', orderComplet);

    // Alertes fire-and-forget, envoyées APRÈS le commit : une alerte qui
    // échoue ne doit jamais faire échouer/annuler la vente déjà enregistrée.
    alertesStock.forEach(({ productId, productName, newQuantity }) => {
      creerAlerte({
        merchantId: req.user.merchantId,
        type: newQuantity === 0 ? 'rupture_stock' : 'seuil_stock',
        titre: newQuantity === 0 ? 'Rupture de stock' : "Stock sous le seuil d'alerte",
        message: newQuantity === 0
          ? `${productName} est en rupture de stock.`
          : `${productName} est passé sous le seuil d'alerte (${newQuantity} restant(s)).`,
        referenceId: productId,
      }).catch((err) => console.error('Erreur alerte stock (vente) :', err));
    });

    // Reliquat créé : notifie manager/gérant qu'il faudra penser à cet
    // article à la prochaine commande groupée fournisseur.
    reservationsCreees.forEach(({ id, productName, quantity }) => {
      creerAlerte({
        merchantId: req.user.merchantId,
        type: 'reliquat_cree',
        titre: 'Commande client en attente (reliquat)',
        message: `${quantity} ${productName} en attente de réapprovisionnement pour honorer la commande ${orderComplet.order_number}.`,
        referenceId: id,
        roles: ['manager', 'gerant'],
      }).catch((err) => console.error('Erreur alerte reliquat_cree :', err));
    });

    // Notification au caissier de sa boutique : seulement quand c'est un
    // simple vendeur qui vient de créer la vente (pas le manager/gérant, ni
    // un vendeur_caissier, qui peuvent encaisser eux-mêmes leur propre vente).
    if (req.user.role === 'vendeur') {
      getNomUtilisateur(req.user.id).then((nomVendeur) => {
        creerAlerte({
          merchantId: req.user.merchantId,
          type: 'nouvelle_vente',
          titre: 'Nouvelle vente à encaisser',
          message: `${nomVendeur || 'Un vendeur'} a créé la commande ${orderComplet.order_number} (${formatMontant(totalAmount)} FCFA).`,
          montant: totalAmount,
          referenceId: order.id,
          roles: ['caissier'],
        }).catch((err) => console.error('Erreur alerte nouvelle_vente :', err));
      }).catch((err) => console.error('Erreur getNomUtilisateur (nouvelle_vente) :', err));
    }

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
router.patch('/:id/payment', requireRole('manager', 'caissier', 'gerant', 'vendeur_caissier'), async (req, res) => {
  const {
    paymentMethod, amountReceived, needsDelivery, deliveryFee, deliveryAddress,
    discountType, discountMode, discountValue, advanceAmount, advancePaymentMethod,
    copaymentMethod, insurerId, coveragePercent, patientName, patientPhone,
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
  const estTiersPayant = paymentMethod === 'tiers_payant';

  if (estACredit && req.user.sector === 'pharmacie') {
    return res.status(400).json({ error: "La vente à crédit n'est pas disponible en pharmacie : utilisez le tiers payant." });
  }

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

    // Tiers payant : soit le client est déjà enregistré avec une mutuelle
    // sur sa fiche, soit c'est un client de passage — la caissière choisit
    // alors la mutuelle et le taux directement dans la modale, et une fiche
    // patient est créée (ou retrouvée par téléphone) à la volée.
    let mutuelleClient = null;
    if (estTiersPayant) {
      if (order.client_id) {
        const clientResult = await pool.query(
          `SELECT c.insurer_id, c.insurance_coverage_percent, i.name AS insurer_name
           FROM clients c LEFT JOIN insurers i ON i.id = c.insurer_id
           WHERE c.id = $1 AND c.merchant_id = $2`,
          [order.client_id, req.user.merchantId]
        );
        mutuelleClient = clientResult.rows[0];
        if (!mutuelleClient || !mutuelleClient.insurer_id || !Number(mutuelleClient.insurance_coverage_percent)) {
          return res.status(400).json({ error: "Ce client n'a pas de mutuelle/tiers payant configuré sur sa fiche." });
        }
      } else {
        if (!patientName || typeof patientName !== 'string' || !patientName.trim()) {
          return res.status(400).json({ error: 'Le nom du patient est requis pour un tiers payant sans fiche enregistrée.' });
        }
        if (!insurerId) {
          return res.status(400).json({ error: 'La mutuelle est requise.' });
        }
        const tauxChoisi = Number(coveragePercent);
        if (!Number.isFinite(tauxChoisi) || tauxChoisi <= 0 || tauxChoisi > 100) {
          return res.status(400).json({ error: 'Taux de prise en charge invalide.' });
        }
        const assureurResult = await pool.query(
          `SELECT id, name FROM insurers WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
          [insurerId, req.user.merchantId]
        );
        if (assureurResult.rows.length === 0) {
          return res.status(404).json({ error: 'Mutuelle introuvable.' });
        }
        const assureur = assureurResult.rows[0];

        const telephone = patientPhone ? String(patientPhone).trim() : '';
        let clientIdFinal = null;
        if (telephone) {
          const existant = await pool.query(
            `SELECT id FROM clients WHERE merchant_id = $1 AND phone = $2 LIMIT 1`,
            [req.user.merchantId, telephone]
          );
          if (existant.rows[0]) clientIdFinal = existant.rows[0].id;
        }
        if (clientIdFinal) {
          await pool.query(
            `UPDATE clients SET insurer_id = $1, insurance_coverage_percent = $2 WHERE id = $3 AND merchant_id = $4`,
            [assureur.id, tauxChoisi, clientIdFinal, req.user.merchantId]
          );
        } else {
          const nouveauClient = await pool.query(
            `INSERT INTO clients (merchant_id, full_name, phone, insurer_id, insurance_coverage_percent)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [req.user.merchantId, patientName.trim(), telephone || null, assureur.id, tauxChoisi]
          );
          clientIdFinal = nouveauClient.rows[0].id;
        }

        await pool.query(
          `UPDATE orders SET client_id = $1 WHERE id = $2 AND merchant_id = $3`,
          [clientIdFinal, req.params.id, req.user.merchantId]
        );
        order.client_id = clientIdFinal;
        mutuelleClient = { insurer_id: assureur.id, insurance_coverage_percent: tauxChoisi, insurer_name: assureur.name };
      }
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

    // Répartition automatique tiers payant : l'assureur couvre son %, le
    // client règle immédiatement le reste (comme un paiement normal, mais
    // sur un montant réduit).
    let montantCouvertAssurance = 0;
    let montantResteACharge = 0;
    if (estTiersPayant) {
      montantCouvertAssurance = Math.min(montantDu, Math.round(montantDu * (Number(mutuelleClient.insurance_coverage_percent) / 100)));
      montantResteACharge = montantDu - montantCouvertAssurance;

      if (montantResteACharge > 0) {
        const MOYENS_PAIEMENT_CONCRETS_TP = ['especes', 'wave', 'orange_money', 'cheque', 'virement'];
        if (!MOYENS_PAIEMENT_CONCRETS_TP.includes(copaymentMethod)) {
          return res.status(400).json({ error: 'Le moyen de paiement du reste à charge est requis.' });
        }
        if (typeof amountReceived !== 'number' || amountReceived < montantResteACharge) {
          return res.status(400).json({ error: 'Le montant reçu est inférieur au reste à charge du client.' });
        }
      }
    }

    if (aAvance && advanceAmount > montantDu) {
      return res.status(400).json({ error: "L'avance ne peut pas dépasser le montant total de la facture." });
    }

    if (!estACredit && !estTiersPayant && amountReceived < montantDu) {
      return res.status(400).json({ error: 'Le montant reçu est inférieur au total à payer.' });
    }

    // À crédit ou tiers payant : rien (ou seulement le reste à charge) n'est
    // reçu directement au moyen de paiement générique — le détail réel
    // entre en caisse via credit_payments / insurer_copayments plus bas.
    const montantRecuFinal = estACredit ? 0 : estTiersPayant ? (montantResteACharge > 0 ? amountReceived : 0) : amountReceived;
    const changeGiven = estACredit
      ? 0
      : estTiersPayant
        ? (montantResteACharge > 0 ? Math.round(amountReceived - montantResteACharge) : 0)
        : Math.round(amountReceived - montantDu);
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

    if (estTiersPayant) {
      await pool.query(
        `INSERT INTO insurer_claims (merchant_id, insurer_id, client_id, order_id, amount)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.user.merchantId, mutuelleClient.insurer_id, order.client_id, order.id, montantCouvertAssurance]
      );

      if (montantResteACharge > 0) {
        await pool.query(
          `INSERT INTO insurer_copayments (merchant_id, order_id, user_id, amount, payment_method)
           VALUES ($1, $2, $3, $4, $5)`,
          [req.user.merchantId, order.id, req.user.id, montantResteACharge, copaymentMethod]
        );
      }

      await logActivity({
        merchantId: req.user.merchantId,
        userId: req.user.id,
        action: 'order_tiers_payant_sale',
        description: `a enregistré la commande ${formatOrderNumber(orderMisAJour)} en tiers payant (${mutuelleClient.insurer_name} : ${formatMontant(montantCouvertAssurance)}, client : ${formatMontant(montantResteACharge)})`,
      });
    }

    // Fire-and-forget, après la réponse ci-dessous : une alerte qui échoue
    // ne doit jamais faire échouer l'encaissement déjà enregistré.
    getSeuilVenteElevee(req.user.merchantId).then((seuilVenteElevee) => {
      if (Number(orderMisAJour.total_amount) >= seuilVenteElevee) {
        return creerAlerte({
          merchantId: req.user.merchantId,
          type: 'vente_elevee',
          titre: 'Vente importante encaissée',
          message: `Commande ${formatOrderNumber(orderMisAJour)} encaissée pour ${formatMontant(orderMisAJour.total_amount)} FCFA.`,
          montant: orderMisAJour.total_amount,
          referenceId: orderMisAJour.id,
        });
      }
    }).catch((err) => console.error('Erreur alerte vente_elevee :', err));

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
router.patch('/:id/return-to-seller', requireRole('manager', 'caissier', 'vendeur_caissier'), async (req, res) => {
  const { reason } = req.body;

  try {
    const orderResult = await pool.query(
      `SELECT id, status, warehouse_id, created_by FROM orders WHERE id = $1 AND merchant_id = $2`,
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

    // Notifie précisément le vendeur qui a créé la commande (pas tous les
    // vendeurs) : c'est lui qui doit la corriger ou l'annuler.
    if (order.created_by) {
      getNomUtilisateur(req.user.id).then((nomExpediteur) => {
        return creerAlerte({
          merchantId: req.user.merchantId,
          type: 'commande_renvoyee_vendeur',
          titre: 'Vente renvoyée pour correction',
          message: `${nomExpediteur || 'Un caissier'} vous a renvoyé la commande ${formatOrderNumber(orderMisAJour)}${reason ? ` : ${reason}` : '.'}`,
          referenceId: orderMisAJour.id,
          userIds: [order.created_by],
        });
      }).catch((err) => console.error('Erreur alerte commande_renvoyee_vendeur :', err));
    }

    res.json({ ...orderMisAJour, order_number: formatOrderNumber(orderMisAJour) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du retour de la commande au vendeur.' });
  }
});

// PATCH /orders/:id/status — changements manuels de statut (livraison, annulation)
// Le vendeur a un droit limité : il ne peut qu'annuler une commande qui lui
// a été renvoyée par le caissier (statut 'renvoyee_vendeur'), rien d'autre.
router.patch('/:id/status', requireRole('manager', 'gerant', 'caissier', 'vendeur', 'vendeur_caissier'), async (req, res) => {
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
      // Alerte plus insistante si l'annulation intervient après encaissement
      // (commande déjà 'validee'/'livree' avant ce PATCH) : plus rare et
      // plus sensible qu'une annulation d'une commande encore en attente.
      const apresEncaissement = ['validee', 'livree'].includes(orderExistant.status);
      creerAlerte({
        merchantId: req.user.merchantId,
        type: 'commande_annulee',
        titre: apresEncaissement ? 'Commande annulée après encaissement' : 'Commande annulée',
        message: `La commande ${formatOrderNumber(order)} (${formatMontant(order.total_amount)} FCFA) a été annulée${apresEncaissement ? " alors qu'elle était déjà encaissée" : ''}.`,
        montant: order.total_amount,
        referenceId: order.id,
      }).catch((err) => console.error('Erreur alerte commande_annulee :', err));
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
router.put('/:id', requireRole('manager', 'gerant', 'vendeur', 'vendeur_caissier'), async (req, res) => {
  const { clientId, items, notes, tvaApplicable, prescriptionId, tvaRegime, precompte } = req.body;

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
    // Si certains articles avaient un reliquat (réservation non encore
    // honorée), on ne remet en stock que la part réellement prélevée à
    // l'époque — la part réservée n'a jamais quitté le rayon. On annule ces
    // réservations : elles seront recréées avec les nouveaux articles si le
    // manager reconduit la vente en rupture.
    const reservationsExistantes = await client.query(
      `SELECT order_item_id, quantity, quantity_fulfilled FROM pending_reservations
       WHERE order_id = $1 AND status IN ('en_attente', 'partielle')`,
      [order.id]
    );
    const quantiteReserveeParItem = {};
    for (const r of reservationsExistantes.rows) {
      if (r.order_item_id) {
        quantiteReserveeParItem[r.order_item_id] =
          (quantiteReserveeParItem[r.order_item_id] || 0) + (Number(r.quantity) - Number(r.quantity_fulfilled));
      }
    }
    if (reservationsExistantes.rows.length > 0) {
      await client.query(
        `UPDATE pending_reservations SET status = 'annulee' WHERE order_id = $1 AND status IN ('en_attente', 'partielle')`,
        [order.id]
      );
    }

    const anciensItems = await client.query(
      `SELECT id, product_id, quantity FROM order_items WHERE order_id = $1`,
      [order.id]
    );
    for (const ancien of anciensItems.rows) {
      const quantiteEncoreReservee = quantiteReserveeParItem[ancien.id] || 0;
      const quantiteARemettre = Number(ancien.quantity) - quantiteEncoreReservee;
      if (quantiteARemettre <= 0) continue;
      await client.query(
        `INSERT INTO product_stock (merchant_id, product_id, warehouse_id, quantity_in_stock)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id, warehouse_id)
         DO UPDATE SET quantity_in_stock = product_stock.quantity_in_stock + $4`,
        [req.user.merchantId, ancien.product_id, warehouseId, quantiteARemettre]
      );
      await client.query(
        `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, warehouse_id)
         VALUES ($1, $2, $3, 'entree', $4, $5, $6)`,
        [req.user.merchantId, ancien.product_id, req.user.id, quantiteARemettre, `Correction commande ${formatOrderNumber(order)} (retour caissier)`, warehouseId]
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
        `SELECT p.id, p.name, p.unit_price, p.cost_price, p.is_weighted, p.quantity_alert_threshold, p.requires_prescription, p.tva_applicable,
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
      const quantiteDisponible = Math.min(baseQuantity, Math.max(0, product.quantity_in_stock));
      const quantiteManquante = baseQuantity - quantiteDisponible;
      if (rupture) {
        if (req.user.role !== 'manager' || !item.authorizeOutOfStock) {
          throw { status: 400, message: `Stock insuffisant pour ${product.name}.` };
        }
        stockOverrideUtilise = true;
        if (quantiteManquante > 0 && SECTEURS_RELIQUAT.includes(req.user.sector) && !clientId) {
          throw {
            status: 400,
            message: `${product.name} : un client enregistré est requis pour créer une commande en attente (reliquat) sur un article en rupture.`,
          };
        }
      }

      const lineTotal = prixParConditionnement * item.quantity;
      subtotalAmount += lineTotal;
      resolvedItems.push({
        product,
        baseQuantity,
        quantiteDisponible,
        quantiteManquante,
        unitPrice: prixParConditionnement / quantitePerUnite,
        originalUnitPrice: originalUnitPrice !== null ? originalUnitPrice / quantitePerUnite : null,
        packagingLabel,
        packagingQuantity: packagingLabel ? item.quantity : null,
        rupture,
        lineTotal,
      });
    }

    const ordonnanceRequise = resolvedItems.some((r) => r.product.requires_prescription);
    if (ordonnanceRequise && !prescriptionId) {
      throw { status: 400, message: 'Une ordonnance est requise pour au moins un article de cette vente.' };
    }
    if (prescriptionId) {
      const prescriptionResult = await client.query(
        `SELECT id FROM prescriptions WHERE id = $1 AND merchant_id = $2`,
        [prescriptionId, req.user.merchantId]
      );
      if (prescriptionResult.rows.length === 0) {
        throw { status: 404, message: 'Ordonnance introuvable.' };
      }
      await verifierOrdonnanceRenouvelable(client, req.user.merchantId, prescriptionId, resolvedItems, order.id);
    }

    const regime = lireRegimeTva(tvaRegime, order.tva_regime || 'normal');
    const { tvaAmount, tvaApplicable: tvaEffective } = calculerTvaCommande({ resolvedItems, regime });
    const totalAmount = Math.round(subtotalAmount + tvaAmount);
    const precompteMontant = (precompte === undefined ? Number(order.precompte_amount) > 0 : precompte === true) && regime === 'normal' ? tvaAmount : 0;
    const alertesStock = [];
    const reservationsCreees = [];

    for (const resolved of resolvedItems) {
      const orderItemResult = await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, original_unit_price, packaging_label, packaging_quantity, unit_cost)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [order.id, resolved.product.id, resolved.baseQuantity, resolved.unitPrice, resolved.originalUnitPrice, resolved.packagingLabel, resolved.packagingQuantity, Number(resolved.product.cost_price) || 0]
      );
      const orderItemId = orderItemResult.rows[0].id;

      if (resolved.quantiteManquante > 0 && SECTEURS_RELIQUAT.includes(req.user.sector)) {
        const reservationResult = await client.query(
          `INSERT INTO pending_reservations (merchant_id, warehouse_id, product_id, order_id, order_item_id, client_id, quantity, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [req.user.merchantId, warehouseId, resolved.product.id, order.id, orderItemId, clientId, resolved.quantiteManquante, req.user.id]
        );
        reservationsCreees.push({
          id: reservationResult.rows[0].id,
          productName: resolved.product.name,
          quantity: resolved.quantiteManquante,
        });
      }

      // Le stock ne descend jamais sous zéro, même en vente autorisée en rupture.
      const newQuantity = Math.max(0, resolved.product.quantity_in_stock - resolved.baseQuantity);
      await client.query(
        `INSERT INTO product_stock (merchant_id, product_id, warehouse_id, quantity_in_stock)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id, warehouse_id)
         DO UPDATE SET quantity_in_stock = $4`,
        [req.user.merchantId, resolved.product.id, warehouseId, newQuantity]
      );

      if (req.user.sector === 'pharmacie') {
        const fefo = await consumeFEFO(client, {
          merchantId: req.user.merchantId,
          productId: resolved.product.id,
          warehouseId,
          quantity: resolved.baseQuantity,
        });
        if (fefo.tracked && !fefo.ok) {
          throw { status: 400, message: `${resolved.product.name} : stock non périmé insuffisant (lots restants périmés ou épuisés).` };
        }
        if (fefo.tracked && fefo.consommes && !['manager', 'gerant'].includes(req.user.role)) {
          const dansMoins30Jours = fefo.consommes.some((c) => {
            const jours = (new Date(c.expiryDate) - new Date()) / (1000 * 60 * 60 * 24);
            return jours < SEUIL_ALERTE_PEREMPTION_JOURS;
          });
          if (dansMoins30Jours) {
            throw {
              status: 403,
              message: `${resolved.product.name} : ce lot périme dans moins de ${SEUIL_ALERTE_PEREMPTION_JOURS} jours — seul le pharmacien responsable (manager/gérant) peut valider cette vente.`,
            };
          }
        }
      }

      if (resolved.quantiteDisponible > 0) {
        await client.query(
          `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, warehouse_id)
           VALUES ($1, $2, $3, 'sortie', $4, $5, $6)`,
          [req.user.merchantId, resolved.product.id, req.user.id, resolved.quantiteDisponible, `Commande ${formatOrderNumber(order)} (modifiée)`, warehouseId]
        );
      }

      // Alerte rupture / seuil bas : même logique que la création.
      const seuilProduit = resolved.product.quantity_alert_threshold;
      const etaitDejaBas = resolved.product.quantity_in_stock <= seuilProduit;
      const franchitSeuil = !etaitDejaBas && newQuantity <= seuilProduit;
      const entreEnRupture = newQuantity === 0 && resolved.product.quantity_in_stock > 0;
      if (franchitSeuil || entreEnRupture) {
        alertesStock.push({ productId: resolved.product.id, productName: resolved.product.name, newQuantity });
      }

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
      if (resolved.quantiteManquante > 0 && SECTEURS_RELIQUAT.includes(req.user.sector)) {
        await logActivity({
          merchantId: req.user.merchantId,
          userId: req.user.id,
          action: 'order_reservation_created',
          description: `a créé une réservation (reliquat) de ${resolved.quantiteManquante} ${resolved.product.name} sur la commande ${formatOrderNumber(order)} (modifiée)`,
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
         stock_override = stock_override OR $8,
         prescription_id = COALESCE($9, prescription_id),
         tva_regime = $10,
         precompte_amount = $11
       WHERE id = $7
       RETURNING *`,
      [clientId || null, notes || null, tvaEffective, tvaAmount, subtotalAmount, totalAmount, order.id, stockOverrideUtilise, prescriptionId || null, regime, precompteMontant]
    );
    const orderMisAJour = updateResult.rows[0];

    await client.query('COMMIT');

    alertesStock.forEach(({ productId, productName, newQuantity }) => {
      creerAlerte({
        merchantId: req.user.merchantId,
        type: newQuantity === 0 ? 'rupture_stock' : 'seuil_stock',
        titre: newQuantity === 0 ? 'Rupture de stock' : "Stock sous le seuil d'alerte",
        message: newQuantity === 0
          ? `${productName} est en rupture de stock.`
          : `${productName} est passé sous le seuil d'alerte (${newQuantity} restant(s)).`,
        referenceId: productId,
      }).catch((err) => console.error('Erreur alerte stock (modification commande) :', err));
    });

    reservationsCreees.forEach(({ id, productName, quantity }) => {
      creerAlerte({
        merchantId: req.user.merchantId,
        type: 'reliquat_cree',
        titre: 'Commande client en attente (reliquat)',
        message: `${quantity} ${productName} en attente de réapprovisionnement pour honorer la commande ${formatOrderNumber(orderMisAJour)} (modifiée).`,
        referenceId: id,
        roles: ['manager', 'gerant'],
      }).catch((err) => console.error('Erreur alerte reliquat_cree (modification commande) :', err));
    });

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
            to_jsonb(m) AS merchant_json,
            uv.full_name AS vendeur_name,
            uc.full_name AS caissier_name,
            EXISTS (SELECT 1 FROM product_returns pr WHERE pr.order_id = o.id) AS has_return
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
            oi.packaging_label, oi.packaging_quantity,
            COALESCE(pr.quantite_reliquat, 0) AS quantite_reliquat
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     LEFT JOIN LATERAL (
       SELECT SUM(quantity - quantity_fulfilled) AS quantite_reliquat
       FROM pending_reservations
       WHERE order_item_id = oi.id AND status IN ('en_attente', 'partielle')
     ) pr ON true
     WHERE oi.order_id = $1`,
    [order.id]
  );

  return { ...order, items: itemsResult.rows, order_number: formatOrderNumber(order) };
}

const MOYENS_PAIEMENT_LABEL = {
  especes: 'Espèces', wave: 'Wave', orange_money: 'Orange Money', cheque: 'Chèque', virement: 'Virement', a_credit: 'À crédit', tiers_payant: 'Tiers payant',
};

const LABEL_STATUT_PDF = {
  en_attente: 'En attente', validee: 'À livrer', livree: 'Livrée', renvoyee_vendeur: 'Renvoyée au vendeur', annulee: 'Annulée',
};

// Historique des ventes sur une période, format liste (comme le journal
// d'activité) — une ligne par commande, pagination automatique.
function genererListeVentesPdf(res, orders, from, to, businessName) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nomFichierPdf('Ventes', `${from}-au-${to}`)}"`);

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
// Les polices de la charte sont activées sur ce document jetable pour que la mesure
// corresponde exactement au ticket réellement dessiné.
function mesurerHauteurTicket(order, largeurContenu) {
  const mesure = new PDFDocument({ margin: 0 });
  enregistrerPolices(mesure);

  let hauteur = 232; // emblème + en-tête + bloc totaux fixe + mention « Édité avec Amaterasu » + marge basse
  if (order.tva_applicable) hauteur += 13;
  if (Number(order.change_given) > 0) hauteur += 12;
  if (order.has_return) hauteur += 18;
  if (order.caissier_name) hauteur += 12;

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

// Reçu de caisse étroit (format imprimante thermique 80 mm, marges de 4 mm), pour un
// client de passage. Charte v8 : noir sur blanc uniquement, emblème en version noire,
// séparateurs en pointillés, total en gras. La hauteur de page est mesurée à l'avance en
// fonction du texte réel (avec ses retours à la ligne), PDFKit ne supportant pas les
// pages à hauteur "automatique".
function genererTicketEtroit(res, order) {
  const LARGEUR = FORMATS.ticket.largeur; // 80 mm
  const MARGE = FORMATS.ticket.marge; // 4 mm
  const largeurContenu = LARGEUR - MARGE * 2;
  const NOIR = '#000000';

  const hauteur = mesurerHauteurTicket(order, largeurContenu) + MARGE + 20; // marge de sécurité

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nomFichierPdf('Recu', order.order_number)}"`);

  const doc = new PDFDocument({
    margin: MARGE,
    size: [LARGEUR, hauteur],
    ...metadonneesPdf({ titre: `Reçu de caisse ${order.order_number}`, commercant: order.business_name }),
  });
  attacherFiletSecuritePdf(doc, res, 'ticket de caisse');
  // Le ticket doit impérativement tenir sur une seule page : si un
  // débordement se produit malgré la marge de sécurité ci-dessus, on
  // préfère ignorer l'ajout de page (au pire un léger chevauchement en
  // bas) plutôt que de laisser PDFKit créer des pages Letter parasites.
  doc.addPage = function () { return this; };
  doc.pipe(res);
  enregistrerPolices(doc);

  const pointille = (yy) => traitPointille(doc, MARGE, LARGEUR - MARGE, yy, NOIR);

  let y = MARGE;
  const tailleEmbleme = 24;
  dessinerEmblem(doc, (LARGEUR - tailleEmbleme) / 2, y, tailleEmbleme, 'noir');
  y += tailleEmbleme + 8;

  doc.fillColor(NOIR).font('Titre').fontSize(12)
    .text((order.business_name || 'Commerce').toUpperCase(), MARGE, y, { width: largeurContenu, align: 'center' });
  y += 17;
  doc.fillColor(NOIR).font('Helvetica-Bold').fontSize(7.5)
    .text('REÇU DE CAISSE', MARGE, y, { width: largeurContenu, align: 'center', characterSpacing: 1 });
  y += 14;
  doc.fillColor(NOIR).font('Helvetica').fontSize(8.5)
    .text(`N° ${order.order_number}  ·  ${new Date(order.validated_at || order.created_at).toLocaleString('fr-FR')}`, MARGE, y, { width: largeurContenu, align: 'center' });
  y += 13;
  if (order.caissier_name) {
    doc.fontSize(8).text(`Caissier : ${order.caissier_name}`, MARGE, y, { width: largeurContenu, align: 'center' });
    y += 12;
  }
  y += 4;

  if (order.has_return) {
    doc.fillColor(NOIR).font('Helvetica-Bold').fontSize(9)
      .text('FACTURE RETOURNÉE', MARGE, y, { width: largeurContenu, align: 'center', characterSpacing: 1 });
    y += 16;
  }

  pointille(y);
  y += 10;

  order.items.forEach((item) => {
    doc.fillColor(NOIR).font('Helvetica').fontSize(8.5);
    const hNom = doc.heightOfString(item.product_name, { width: largeurContenu });
    doc.text(item.product_name, MARGE, y, { width: largeurContenu });
    y += hNom + 3;

    if (item.packaging_label) {
      doc.fillColor(NOIR).fontSize(7.5);
      const hLabel = doc.heightOfString(item.packaging_label, { width: largeurContenu });
      doc.text(item.packaging_label, MARGE, y, { width: largeurContenu });
      y += hLabel + 3;
    }

    const quantiteAffichee = item.packaging_label ? item.packaging_quantity : item.quantity;
    doc.fillColor(NOIR).font('Helvetica').fontSize(8)
      .text(`${Math.round(quantiteAffichee)} × ${formatMontant(item.unit_price * (item.packaging_label ? item.quantity / item.packaging_quantity : 1))}`, MARGE, y, { width: largeurContenu - 70 });
    doc.fillColor(NOIR).font('Helvetica-Bold')
      .text(formatMontant(item.line_total), MARGE, y, { width: largeurContenu, align: 'right' });
    y += 14;
  });

  pointille(y);
  y += 10;

  doc.font('Helvetica').fontSize(8.5).fillColor(NOIR);
  doc.text('Sous-total', MARGE, y, { width: largeurContenu - 70 });
  doc.text(`${formatMontant(order.subtotal_amount)} ${order.currency}`, MARGE, y, { width: largeurContenu, align: 'right' });
  y += 13;

  if (order.tva_applicable) {
    doc.text(`TVA (${TVA_RATE} %)`, MARGE, y, { width: largeurContenu - 70 });
    doc.text(`${formatMontant(order.tva_amount)} ${order.currency}`, MARGE, y, { width: largeurContenu, align: 'right' });
    y += 13;
  }

  y += 3;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NOIR);
  doc.text('TOTAL', MARGE, y, { width: largeurContenu - 90 });
  doc.text(`${formatMontant(order.total_amount)} ${order.currency}`, MARGE, y, { width: largeurContenu, align: 'right' });
  y += 20;

  doc.font('Helvetica').fontSize(8).fillColor(NOIR);
  doc.text(MOYENS_PAIEMENT_LABEL[order.payment_method] || order.payment_method || '', MARGE, y, { width: largeurContenu - 90 });
  doc.text(formatMontant(order.amount_received), MARGE, y, { width: largeurContenu, align: 'right' });
  y += 12;
  if (Number(order.change_given) > 0) {
    doc.text('Rendu', MARGE, y, { width: largeurContenu - 90 });
    doc.text(formatMontant(order.change_given), MARGE, y, { width: largeurContenu, align: 'right' });
    y += 12;
  }

  y += 6;
  pointille(y);
  y += 10;

  doc.font('Helvetica').fontSize(8.5).fillColor(NOIR)
    .text('Merci de votre visite', MARGE, y, { width: largeurContenu, align: 'center' });
  y += 16;

  // Mention « Édité avec Amaterasu » avec l'emblème noir à 3 mm.
  doc.font('Helvetica').fontSize(TAILLES.pied);
  const texteMention = MENTION_EDITEUR;
  const largeurMention = doc.widthOfString(texteMention);
  const xDepart = (LARGEUR - (TAILLES.logoPied + 4 + largeurMention)) / 2;
  dessinerEmblem(doc, xDepart, y - 0.5, TAILLES.logoPied, 'noir');
  doc.fillColor(NOIR).text(texteMention, xDepart + TAILLES.logoPied + 4, y, { lineBreak: false });

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
  res.setHeader('Content-Disposition', `inline; filename="${nomFichierPdf('Facture', order.order_number)}"`);

  // Charte v8 : A4 portrait, marges de 20 mm.
  const M = FORMATS.marge;
  const doc = new PDFDocument({
    margin: M,
    size: 'A4',
    ...metadonneesPdf({ titre: `Facture ${order.order_number}`, commercant: order.business_name }),
  });
  attacherFiletSecuritePdf(doc, res, 'facture A4');
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
  const logoCommercant = lireLogoCommercant(order.merchant_json);

  const largeurPage = doc.page.width;
  const droite = largeurPage - M;
  const largeurContenu = droite - M;
  const devise = order.currency;
  const dateEmission = new Date(order.validated_at || order.created_at).toLocaleDateString('fr-FR');

  const libelle = (texte, x, yy, w) => doc.font('Helvetica-Bold').fontSize(TAILLES.libelle).fillColor(COULEURS.muted)
    .text(texte, x, yy, { width: w, characterSpacing: 0.6, lineBreak: false });

  // En-tête : emblème Amaterasu à gauche, titre « Facture » à droite avec filet Soleil.
  // Seules les infos légales passent par l'en-tête : les coordonnées de paiement sont écrites dans le corps.
  const entetePage = () => dessinerEntete(doc, {
    businessName: order.business_name,
    titre: 'Facture',
    sousTitre: `N° ${order.order_number}  ·  ${dateEmission}`,
    merchant: { ninea: merchant.ninea, rccm: merchant.rccm, address: merchant.address },
    marge: M,
  });
  let y = entetePage();

  if (order.has_return) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COULEURS.brique)
      .text('FACTURE RETOURNÉE', M, 108, { width: largeurContenu, align: 'right', characterSpacing: 0.5, lineBreak: false });
  }
  y += 10;

  // Bloc émetteur (gauche) et client (droite), sur deux colonnes.
  const largeurCol = (largeurContenu - 28) / 2;
  const xG = M;
  const xD = M + largeurCol + 28;
  libelle('ÉMETTEUR', xG, y, largeurCol);
  libelle('CLIENT', xD, y, largeurCol);
  let yG = y + 13;
  let yD = y + 13;

  // Logo du commerçant dans le bloc Émetteur, s'il existe.
  if (logoCommercant && dessinerLogoCommercant(doc, logoCommercant, xG, yG, mmEnPt(30), mmEnPt(14))) {
    yG += mmEnPt(14) + 6;
  }
  doc.font('Helvetica-Bold').fontSize(TAILLES.texte + 1).fillColor(COULEURS.encre)
    .text(order.business_name || 'Commerce', xG, yG, { width: largeurCol });
  yG += 16;
  doc.font('Helvetica').fontSize(TAILLES.texte).fillColor(COULEURS.encre);
  [merchant.address, merchant.ninea && `NINEA ${merchant.ninea}`, merchant.rccm && `RCCM ${merchant.rccm}`]
    .filter(Boolean)
    .forEach((ligne) => { doc.text(ligne, xG, yG, { width: largeurCol }); yG += 14; });

  doc.font('Helvetica-Bold').fontSize(TAILLES.texte + 1).fillColor(COULEURS.encre)
    .text(order.client_name, xD, yD, { width: largeurCol });
  yD += 16;
  doc.font('Helvetica').fontSize(TAILLES.texte).fillColor(COULEURS.encre);
  if (order.client_phone) { doc.text(order.client_phone, xD, yD, { width: largeurCol }); yD += 14; }
  if (order.client_address) { doc.text(order.client_address, xD, yD, { width: largeurCol }); yD += doc.heightOfString(order.client_address, { width: largeurCol }) + 3; }
  doc.fontSize(9).fillColor(COULEURS.muted);
  [
    `Vendeur : ${order.vendeur_name || '—'}`,
    `Caissier : ${order.caissier_name || '—'}`,
    `Paiement : ${MOYENS_PAIEMENT_LABEL[order.payment_method] || '—'}`,
    `Livraison : ${order.needs_delivery ? 'à livrer' : 'remise en main propre'}`,
  ].forEach((ligne) => { doc.text(ligne, xD, yD, { width: largeurCol }); yD += 13; });

  y = Math.max(yG, yD) + 18;

  // Encart « Adresse de livraison », juste avant les articles — uniquement si une livraison est prévue.
  if (order.needs_delivery && order.delivery_address) {
    const largeurTexte = largeurContenu - 24;
    doc.font('Helvetica').fontSize(10.5);
    const hauteurTexte = doc.heightOfString(order.delivery_address, { width: largeurTexte });
    const hauteurEncart = 28 + hauteurTexte;
    doc.roundedRect(M, y, largeurContenu, hauteurEncart, 4).fillAndStroke(COULEURS.fondAlterne, COULEURS.bordure);
    libelle('ADRESSE DE LIVRAISON', M + 12, y + 9, largeurContenu - 24);
    doc.font('Helvetica').fontSize(10.5).fillColor(COULEURS.encre)
      .text(order.delivery_address, M + 12, y + 21, { width: largeurTexte });
    y += hauteurEncart + 18;
  }

  // Tableau : en-tête Marine, lignes alternées Brume, montants alignés à droite.
  const COLONNES = [
    { texte: 'Désignation', x: M + 8, largeur: 215 },
    { texte: 'Qté', x: M + 232, largeur: 50, aligner: 'right' },
    { texte: 'Prix unitaire', x: M + 292, largeur: 90, aligner: 'right' },
    { texte: 'Montant', x: M + 392, largeur: largeurContenu - 392 - 8, aligner: 'right' },
  ];
  const limiteBas = () => doc.page.height - 90;
  const nouvellePage = () => { doc.addPage(); y = entetePage() + 8; };

  y += 4;
  y = dessinerEnteteTableau(doc, y, COLONNES, M);
  let contientReliquat = false;

  order.items.forEach((item, index) => {
    const quantiteAffichee = item.packaging_label ? item.packaging_quantity : item.quantity;
    const prixUnitaire = item.line_total / quantiteAffichee;
    const reliquat = Number(item.quantite_reliquat) > 0;
    const hauteurLigne = 24 + (item.packaging_label ? 11 : 0) + (reliquat ? 11 : 0);

    if (y + hauteurLigne > limiteBas()) {
      nouvellePage();
      y = dessinerEnteteTableau(doc, y, COLONNES, M);
    }
    if (index % 2 === 1) doc.rect(M, y - 6, largeurContenu, hauteurLigne).fill(COULEURS.fondAlterne);

    doc.font('Helvetica').fontSize(TAILLES.tableau).fillColor(COULEURS.encre);
    doc.text(item.product_name, COLONNES[0].x, y, { width: COLONNES[0].largeur, lineBreak: false, ellipsis: true });
    doc.text(String(Math.round(quantiteAffichee)), COLONNES[1].x, y, { width: COLONNES[1].largeur, align: 'right', lineBreak: false });
    doc.text(formatMontant(prixUnitaire), COLONNES[2].x, y, { width: COLONNES[2].largeur, align: 'right', lineBreak: false });
    doc.font('Helvetica-Bold').text(formatMontant(item.line_total), COLONNES[3].x, y, { width: COLONNES[3].largeur, align: 'right', lineBreak: false });

    let yLigne = y + 12;
    if (item.packaging_label) {
      doc.font('Helvetica').fontSize(8).fillColor(COULEURS.muted)
        .text(item.packaging_label, COLONNES[0].x, yLigne, { width: COLONNES[0].largeur, lineBreak: false, ellipsis: true });
      yLigne += 11;
    }
    if (reliquat) {
      contientReliquat = true;
      doc.font('Helvetica').fontSize(8).fillColor(COULEURS.brique)
        .text(`En attente de réapprovisionnement : ${item.quantite_reliquat} unité(s)`, COLONNES[0].x, yLigne, { width: COLONNES[0].largeur + 120, lineBreak: false });
    }
    y += hauteurLigne;
  });

  doc.moveTo(M, y - 2).lineTo(droite, y - 2).strokeColor(COULEURS.bordure).lineWidth(0.8).stroke();
  y += 14;

  // Bloc des totaux : il reste groupé sur une même page.
  if (y + 210 > doc.page.height - 70) nouvellePage();

  const xLibelle = droite - 250;
  const ligneTotal = (label, texteValeur, { discret = false, fort = false } = {}) => {
    doc.font(fort ? 'Helvetica-Bold' : 'Helvetica').fontSize(TAILLES.texte).fillColor(discret ? COULEURS.muted : COULEURS.encre)
      .text(label, xLibelle, y, { width: 120, lineBreak: false });
    doc.text(texteValeur, droite - 130, y, { width: 130, align: 'right', lineBreak: false });
    y += 17;
  };
  const montant = (valeur) => `${formatMontant(valeur)} ${devise}`;

  ligneTotal('Sous-total', montant(order.subtotal_amount));
  if (order.tva_applicable) ligneTotal(`TVA (${TVA_RATE} %)`, montant(order.tva_amount));
  if (order.discount_type && Number(order.discount_amount) > 0) {
    const labelReduction = { remise: 'Remise', rabais: 'Rabais', ristourne: 'Ristourne', escompte: 'Escompte' }[order.discount_type] || 'Réduction';
    const detailReduction = order.discount_mode === 'pourcentage' ? ` (${order.discount_value} %)` : '';
    ligneTotal(`${labelReduction}${detailReduction}`, montant(-Math.round(Number(order.discount_amount))), { discret: true });
  }
  if (order.needs_delivery && Number(order.delivery_fee) > 0) {
    ligneTotal('Frais de livraison', montant(order.delivery_fee));
  }
  y += 6;

  // Total à payer : bandeau Marine, montant en Soleil.
  y = dessinerBandeauTotal(doc, { x: droite - 260, y, largeur: 260, label: 'Total à payer', texteMontant: montant(order.total_amount), hauteur: 32 }) + 14;

  if (order.payment_method === 'a_credit' && creditInfo) {
    ligneTotal('Déjà réglé', montant(creditInfo.avance), { discret: true });
    ligneTotal('Reste à payer', montant(creditInfo.reste), { fort: true });
  } else {
    ligneTotal('Montant reçu', montant(order.amount_received), { discret: true });
    if (Number(order.change_given) > 0) ligneTotal('Monnaie rendue', montant(order.change_given), { discret: true });
  }
  y += 14;

  if (contientReliquat) {
    if (y + 50 > doc.page.height - 70) nouvellePage();
    doc.roundedRect(M, y, largeurContenu, 34, 4).fillAndStroke('#FDE9E7', COULEURS.brique);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COULEURS.brique)
      .text('Cette facture comprend un ou plusieurs articles en attente de réapprovisionnement. Vous serez contacté(e) dès réception.', M + 12, y + 11, { width: largeurContenu - 24 });
    y += 34 + 16;
  }

  // Conditions de paiement : seulement si le commerçant a renseigné l'une de ces informations.
  const lignesPaiement = [
    merchant.payment_terms,
    merchant.bank_details && `Coordonnées bancaires : ${merchant.bank_details}`,
    merchant.mobile_money_details && `Mobile Money : ${merchant.mobile_money_details}`,
  ].filter(Boolean);
  if (lignesPaiement.length > 0) {
    doc.font('Helvetica').fontSize(9);
    const hauteurBloc = 18 + lignesPaiement.reduce((somme, ligne) => somme + doc.heightOfString(ligne, { width: largeurContenu }) + 3, 0);
    if (y + hauteurBloc > doc.page.height - 70) nouvellePage();
    libelle('CONDITIONS DE PAIEMENT', M, y, largeurContenu);
    y += 14;
    doc.font('Helvetica').fontSize(9).fillColor(COULEURS.encre);
    lignesPaiement.forEach((ligne) => {
      doc.text(ligne, M, y, { width: largeurContenu });
      y += doc.heightOfString(ligne, { width: largeurContenu }) + 3;
    });
  }

  // Le pied de page « Édité avec Amaterasu · n / total » est ajouté par pdfHelpers à la fin du document.
  doc.font('Helvetica').fillColor(COULEURS.encre);
  doc.end();
}

// Bon de livraison : liste des articles à livrer, adresse, cases de
// signature "Livré par" / "Reçu par" — sans le détail des prix, sauf le
// total (utile pour le livreur/le client sans être une facture). Générique,
// utilisable dans tous les secteurs (pas de logique spécifique à un métier).
function genererBonDeLivraison(res, order, merchant) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nomFichierPdf('Bon-livraison', order.order_number)}"`);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  attacherFiletSecuritePdf(doc, res, 'bon de livraison');
  doc.pipe(res);

  const largeurPage = doc.page.width;
  const xGauche = 50;
  const xDroite = largeurPage - 50;
  const largeurContenu = xDroite - xGauche;

  let y = dessinerEntete(doc, {
    businessName: merchant.business_name,
    titre: 'Bon de livraison',
    sousTitre: order.order_number,
    merchant,
  });

  doc.font('Helvetica').fontSize(10).fillColor(COULEURS.encre);
  doc.text(`Date d'émission : ${new Date(order.validated_at || order.created_at).toLocaleDateString('fr-FR')}`, xGauche, y);
  y += 18;
  doc.font('Helvetica-Bold').fontSize(13).text(order.client_name || 'Client de passage', xGauche, y);
  y += 17;
  doc.font('Helvetica').fontSize(10);
  if (order.client_phone) { doc.text(order.client_phone, xGauche, y); y += 15; }

  // Encart adresse de livraison, bien visible — comme sur la facture A4.
  if (order.delivery_address) {
    y += 6;
    const largeurTexte = largeurContenu - 24;
    doc.font('Helvetica').fontSize(10.5);
    const hauteurTexte = doc.heightOfString(order.delivery_address, { width: largeurTexte });
    const hauteurEncart = 28 + hauteurTexte;
    doc.roundedRect(xGauche, y, largeurContenu, hauteurEncart, 4).fillAndStroke(COULEURS.fondAlterne, COULEURS.bordure);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COULEURS.muted)
      .text('ADRESSE DE LIVRAISON', xGauche + 12, y + 8, { characterSpacing: 0.5 });
    doc.font('Helvetica').fontSize(10.5).fillColor(COULEURS.encre)
      .text(order.delivery_address, xGauche + 12, y + 21, { width: largeurTexte });
    y += hauteurEncart + 20;
  } else {
    y += 14;
  }

  const COLONNES = [
    { texte: 'Article', x: xGauche, largeur: 320 },
    { texte: 'Quantité', x: xGauche + 320, largeur: largeurContenu - 320, aligner: 'right' },
  ];
  y = dessinerEnteteTableau(doc, y, COLONNES);

  order.items.forEach((item, index) => {
    if (y > doc.page.height - 140) {
      doc.addPage();
      y = dessinerEntete(doc, { businessName: merchant.business_name, titre: 'Bon de livraison', sousTitre: order.order_number, merchant });
      y = dessinerEnteteTableau(doc, y, COLONNES);
    }
    if (index % 2 === 1) doc.rect(xGauche, y - 3, largeurContenu, 20).fill(COULEURS.fondAlterne);
    const quantiteAffichee = item.packaging_label ? item.packaging_quantity : item.quantity;
    const libelle = item.packaging_label ? `${item.product_name} (${item.packaging_label})` : item.product_name;
    doc.font('Helvetica').fontSize(10).fillColor(COULEURS.encre);
    doc.text(libelle, xGauche, y, { width: 315 });
    doc.text(String(Math.round(quantiteAffichee)), xGauche + 320, y, { width: largeurContenu - 320, align: 'right' });
    y += 20;
  });

  traitSeparateur(doc, y + 4);
  y += 22;

  const totalArticles = order.items.reduce((s, it) => s + Number(it.quantity), 0);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COULEURS.encre);
  doc.text(`Total : ${Math.round(totalArticles)} article${totalArticles > 1 ? 's' : ''}`, xGauche, y, { width: 320 });
  y += 40;

  // Cases de signature côte à côte, pour acter la remise.
  const largeurCase = (largeurContenu - 30) / 2;
  const hauteurCase = 70;
  [
    { label: 'LIVRÉ PAR', x: xGauche },
    { label: 'REÇU PAR', x: xGauche + largeurCase + 30 },
  ].forEach(({ label, x }) => {
    doc.roundedRect(x, y, largeurCase, hauteurCase, 4).strokeColor(COULEURS.bordure).lineWidth(0.75).stroke();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COULEURS.muted)
      .text(label, x + 10, y + 8, { characterSpacing: 0.5 });
    doc.font('Helvetica').fontSize(8).fillColor(COULEURS.mutedClair)
      .text('Nom, signature et date', x + 10, y + hauteurCase - 18);
  });

  dessinerPiedDePage(doc, merchant);
  doc.font('Helvetica').fillColor(COULEURS.encre);
  doc.end();
}

// GET /orders/:id/receipt-pdf?format=a4|ticket — reçu de caisse. Sans
// paramètre "format" : ticket étroit pour un client de passage, facture A4
// pour un client enregistré. Avec format=a4 ou format=ticket, le choix est
// forcé (ex : ticket de caisse pour un client enregistré).
router.get('/:id/receipt-pdf', async (req, res) => {
  try {
    const order = await getOrderReceiptDetail(req.user.merchantId, req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });

    const format = String(req.query.format || '').toLowerCase();
    const utiliserA4 = format === 'a4' ? true : format === 'ticket' ? false : Boolean(order.client_id);

    if (utiliserA4) {
      if (!order.client_name) order.client_name = 'Client de passage';
      let creditInfo = null;
      if (order.client_id && order.payment_method === 'a_credit') {
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


// GET /orders/:id/delivery-note-pdf — bon de livraison (générique, tous secteurs).
router.get('/:id/delivery-note-pdf', async (req, res) => {
  try {
    const order = await getOrderReceiptDetail(req.user.merchantId, req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    if (!order.client_name) order.client_name = 'Client de passage';

    const merchantResult = await pool.query(
      'SELECT business_name, ninea, rccm, address, bank_details, mobile_money_details, payment_terms FROM merchants WHERE id = $1',
      [req.user.merchantId]
    );
    const merchant = merchantResult.rows[0] || {};

    genererBonDeLivraison(res, order, merchant);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la génération du bon de livraison.' });
  }
});

module.exports = router;
