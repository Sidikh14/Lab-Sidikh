const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');
const { COULEURS, formatMontant, dessinerEntete, dessinerEnteteTableau } = require('../utils/pdfHelpers');
const { MOYENS_PAIEMENT, LABEL_METHODE, calculerMouvements } = require('../utils/cashBalance');

const router = express.Router();
router.use(authenticate);

// Même logique que products/orders : manager choisit toujours explicitement
// la boutique, les autres rôles utilisent la leur (assignée via
// req.user.warehouseId), sans jamais faire confiance à un warehouseId
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



function bornesJour(dateStr) {
  const debut = new Date(`${dateStr}T00:00:00`);
  const fin = new Date(debut);
  fin.setDate(fin.getDate() + 1);
  return [debut.toISOString(), fin.toISOString()];
}

// Détail ligne par ligne des mouvements — soit d'UN SEUL moyen de paiement,
// soit de TOUS confondus (method === 'tous'), sur une période, et
// éventuellement filtrés sur UN SEUL auteur (cashier = id utilisateur) ou
// tous confondus (cashier absent ou 'tous') — utilisé pour le relevé à
// l'écran et son export PDF. Chaque mouvement embarque toujours l'auteur
// (user_id/user_name), quelle que soit la colonne réelle en base : elle
// diffère d'une table à l'autre (orders.validated_by,
// credit_payments.recorded_by, stock_movements.user_id,
// supplier_payments.user_id, cash_expenses.user_id — aucun nom commun).
async function recupererMouvementsDetailles(req, method, from, to, cashier, warehouseId) {
  const debut = `${from}T00:00:00`;
  const finExclusive = new Date(`${to}T00:00:00`);
  finExclusive.setDate(finExclusive.getDate() + 1);
  const fin = finExclusive.toISOString();
  const tous = method === 'tous';
  const tousCaissiers = !cashier || cashier === 'tous';

  // Construit les paramètres + l'index des filtres optionnels une seule
  // fois, dans le même ordre pour toutes les requêtes ci-dessous : la
  // boutique en 4e position (toujours filtrée), le moyen de paiement en 5e
  // position si demandé, le caissier juste après.
  function construireParams(bornesDate) {
    const params = bornesDate ? [req.user.merchantId, from, to, warehouseId] : [req.user.merchantId, debut, fin, warehouseId];
    let idxMethode = null;
    let idxCaissier = null;
    if (!tous) { params.push(method); idxMethode = params.length; }
    if (!tousCaissiers) { params.push(cashier); idxCaissier = params.length; }
    return { params, idxMethode, idxCaissier };
  }

  const ts = construireParams(false);
  const dates = construireParams(true);

  const encaissements = await pool.query(
    `SELECT o.id, 'encaissement' AS type, o.validated_at AS date, o.total_amount AS amount, o.payment_method,
            o.order_seq, o.created_at AS order_created_at, c.full_name AS client_name,
            o.validated_by AS user_id, u.full_name AS user_name
     FROM orders o
     LEFT JOIN clients c ON c.id = o.client_id
     LEFT JOIN users u ON u.id = o.validated_by
     WHERE o.merchant_id = $1 AND o.validated_at >= $2 AND o.validated_at < $3 AND o.warehouse_id = $4
       ${ts.idxMethode ? `AND o.payment_method = $${ts.idxMethode}` : ''}
       ${ts.idxCaissier ? `AND o.validated_by = $${ts.idxCaissier}` : ''}
       ${tous ? "AND o.payment_method != 'a_credit'" : ''}
     ORDER BY o.validated_at`,
    ts.params
  );

  const reglementsCredit = await pool.query(
    `SELECT cp.id, 'reglement_credit' AS type, cp.created_at AS date, cp.amount, cp.payment_method, c.full_name AS client_name,
            cp.recorded_by AS user_id, u.full_name AS user_name
     FROM credit_payments cp
     LEFT JOIN clients c ON c.id = cp.client_id
     LEFT JOIN users u ON u.id = cp.recorded_by
     WHERE cp.merchant_id = $1 AND cp.created_at >= $2 AND cp.created_at < $3 AND cp.warehouse_id = $4
       ${ts.idxMethode ? `AND cp.payment_method = $${ts.idxMethode}` : ''}
       ${ts.idxCaissier ? `AND cp.recorded_by = $${ts.idxCaissier}` : ''}
     ORDER BY cp.created_at`,
    ts.params
  );

  const achatsStock = await pool.query(
    `SELECT sm.id, 'achat_stock' AS type, sm.created_at AS date, sm.total_cost AS amount, sm.cash_method AS payment_method,
            p.name AS product_name, s.name AS supplier_name,
            sm.user_id AS user_id, u.full_name AS user_name
     FROM stock_movements sm
     LEFT JOIN products p ON p.id = sm.product_id
     LEFT JOIN suppliers s ON s.id = sm.supplier_id
     LEFT JOIN users u ON u.id = sm.user_id
     WHERE sm.merchant_id = $1 AND sm.created_at >= $2 AND sm.created_at < $3
       AND sm.movement_type = 'entree' AND sm.payment_method = 'comptant' AND sm.warehouse_id = $4
       ${ts.idxMethode ? `AND sm.cash_method = $${ts.idxMethode}` : ''}
       ${ts.idxCaissier ? `AND sm.user_id = $${ts.idxCaissier}` : ''}
     ORDER BY sm.created_at`,
    ts.params
  );

  const reglementsFournisseur = await pool.query(
    `SELECT sp.id, 'reglement_fournisseur' AS type, sp.paid_at AS date, sp.amount, sp.payment_method, s.name AS supplier_name,
            sp.user_id AS user_id, u.full_name AS user_name
     FROM supplier_payments sp
     LEFT JOIN suppliers s ON s.id = sp.supplier_id
     LEFT JOIN users u ON u.id = sp.user_id
     WHERE sp.merchant_id = $1 AND sp.paid_at >= $2 AND sp.paid_at < $3 AND sp.warehouse_id = $4
       ${ts.idxMethode ? `AND sp.payment_method = $${ts.idxMethode}` : ''}
       ${ts.idxCaissier ? `AND sp.user_id = $${ts.idxCaissier}` : ''}
     ORDER BY sp.paid_at`,
    ts.params
  );

  const sorties = await pool.query(
    `SELECT ce.id, 'sortie' AS type, ce.expense_date AS date, ce.amount, ce.payment_method, ce.reason,
            ce.user_id AS user_id, u.full_name AS user_name
     FROM cash_expenses ce
     LEFT JOIN users u ON u.id = ce.user_id
     WHERE ce.merchant_id = $1 AND ce.expense_date >= $2 AND ce.expense_date <= $3 AND ce.movement_type = 'sortie' AND ce.warehouse_id = $4
       ${dates.idxMethode ? `AND ce.payment_method = $${dates.idxMethode}` : ''}
       ${dates.idxCaissier ? `AND ce.user_id = $${dates.idxCaissier}` : ''}
     ORDER BY ce.expense_date`,
    dates.params
  );

  const entreesManuelles = await pool.query(
    `SELECT ce.id, 'entree_manuelle' AS type, ce.expense_date AS date, ce.amount, ce.payment_method, ce.reason,
            ce.user_id AS user_id, u.full_name AS user_name
     FROM cash_expenses ce
     LEFT JOIN users u ON u.id = ce.user_id
     WHERE ce.merchant_id = $1 AND ce.expense_date >= $2 AND ce.expense_date <= $3 AND ce.movement_type = 'entree' AND ce.warehouse_id = $4
       ${dates.idxMethode ? `AND ce.payment_method = $${dates.idxMethode}` : ''}
       ${dates.idxCaissier ? `AND ce.user_id = $${dates.idxCaissier}` : ''}
     ORDER BY ce.expense_date`,
    dates.params
  );

  const entrees = [...encaissements.rows, ...reglementsCredit.rows, ...entreesManuelles.rows].map((r) => ({ ...r, sens: 'entree' }));
  const dehors = [...achatsStock.rows, ...reglementsFournisseur.rows, ...sorties.rows].map((r) => ({ ...r, sens: 'sortie' }));

  return [...entrees, ...dehors].sort((a, b) => new Date(a.date) - new Date(b.date));
}

function formatOrderNumber(m) {
  if (!m.order_seq) return '';
  const annee = new Date(m.order_created_at).getFullYear();
  return `CMD-${annee}-${String(m.order_seq).padStart(4, '0')}`;
}

function texteMouvement(m) {
  if (m.type === 'encaissement') return `Encaissement ${formatOrderNumber(m)}${m.client_name ? ` — ${m.client_name}` : ''}`;
  if (m.type === 'reglement_credit') return `Règlement créance${m.client_name ? ` — ${m.client_name}` : ''}`;
  if (m.type === 'achat_stock') return `Achat stock — ${m.product_name}${m.supplier_name ? ` (${m.supplier_name})` : ''}`;
  if (m.type === 'reglement_fournisseur') return `Règlement fournisseur — ${m.supplier_name}`;
  if (m.type === 'sortie') return `Sortie de caisse — ${m.reason}`;
  if (m.type === 'entree_manuelle') return `Entrée de caisse — ${m.reason}`;
  return '';
}

// GET /cash/balances — solde théorique actuel en caisse pour chaque moyen
// de paiement (cumul de tous les mouvements depuis le début de l'activité).
// Affiché en haut de la page Caisse, comme les stats du tableau de bord —
// c'est un solde calculé (comme la valeur du stock), pas le dernier solde
// compté physiquement à une clôture.
router.get('/balances', requireRole('manager', 'gerant'), async (req, res) => {
  try {
    const warehouseId = await resolveWarehouseId(req, null, req.query.warehouseId);
    const debut = new Date(0).toISOString();
    // Borne de fin = demain minuit (comme bornesJour), pour que la
    // comparaison stricte "<" sur expense_date (colonne DATE, sans heure)
    // inclue bien les mouvements d'aujourd'hui — sinon ils n'apparaissaient
    // dans le solde qu'à partir du lendemain.
    const finDate = new Date();
    finDate.setDate(finDate.getDate() + 1);
    const fin = finDate.toISOString();
    const mouvements = await calculerMouvements(req, debut, fin, warehouseId);
    const soldes = MOYENS_PAIEMENT.map((m) => ({
      method: m,
      label: LABEL_METHODE[m],
      balance: mouvements[m].theoretical,
    }));
    res.json(soldes);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du calcul des soldes de caisse.' });
  }
});

// GET /cash/summary?date=AAAA-MM-JJ — mouvements du jour + clôture existante,
// pour chaque moyen de paiement.
router.get('/summary', requireRole('manager', 'gerant', 'caissier'), async (req, res) => {
  try {
    const warehouseId = await resolveWarehouseId(req, null, req.query.warehouseId);
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const [debut, fin] = bornesJour(date);
    const mouvements = await calculerMouvements(req, debut, fin, warehouseId);

    const closingsResult = await pool.query(
      `SELECT payment_method, theoretical_balance, actual_balance, difference, notes, created_at
       FROM cash_closings WHERE merchant_id = $1 AND closing_date = $2 AND warehouse_id = $3`,
      [req.user.merchantId, date, warehouseId]
    );
    const closingsParMethode = {};
    closingsResult.rows.forEach((c) => { closingsParMethode[c.payment_method] = c; });

    // Le caissier ne doit jamais voir le théorique, les entrées/sorties ou
    // l'écart — seulement le solde réel qu'il a compté et déjà validé (pour
    // qu'il ne puisse ni consulter ni falsifier le résultat de sa clôture).
    // Ces informations complètes restent réservées à manager/gérant.
    const estCaissier = req.user.role === 'caissier';

    res.json({
      date,
      methods: MOYENS_PAIEMENT.map((m) => {
        const closing = closingsParMethode[m] || null;
        if (estCaissier) {
          return {
            method: m,
            label: LABEL_METHODE[m],
            closing: closing ? { actual_balance: closing.actual_balance, created_at: closing.created_at } : null,
          };
        }
        return {
          method: m,
          label: LABEL_METHODE[m],
          ...mouvements[m],
          closing,
        };
      }),
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du calcul du résumé de caisse.' });
  }
});

// POST /cash/closings — clôture d'un ou plusieurs moyens de paiement pour un jour donné
router.post('/closings', requireRole('manager', 'gerant', 'caissier'), async (req, res) => {
  const { date, entries, notes, warehouseId: warehouseIdInput } = req.body;
  if (!date || !Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'Une date et au moins un moyen de paiement sont requis.' });
  }

  try {
    const warehouseId = await resolveWarehouseId(req, null, warehouseIdInput);
    const [debut, fin] = bornesJour(date);
    const mouvements = await calculerMouvements(req, debut, fin, warehouseId);
    const resultats = [];

    for (const entree of entries) {
      if (!MOYENS_PAIEMENT.includes(entree.paymentMethod) || typeof entree.actualBalance !== 'number') {
        return res.status(400).json({ error: 'Entrée de clôture invalide.' });
      }
      const theorique = mouvements[entree.paymentMethod].theoretical;
      const ecart = entree.actualBalance - theorique;

      const result = await pool.query(
        `INSERT INTO cash_closings (merchant_id, closing_date, payment_method, theoretical_balance, actual_balance, difference, notes, closed_by, warehouse_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (merchant_id, closing_date, payment_method, warehouse_id)
         DO UPDATE SET theoretical_balance = EXCLUDED.theoretical_balance, actual_balance = EXCLUDED.actual_balance,
                       difference = EXCLUDED.difference, notes = EXCLUDED.notes, closed_by = EXCLUDED.closed_by, created_at = now()
         RETURNING *`,
        [req.user.merchantId, date, entree.paymentMethod, theorique, entree.actualBalance, ecart, notes || null, req.user.id, warehouseId]
      );
      resultats.push(result.rows[0]);

      await logActivity({
        merchantId: req.user.merchantId,
        userId: req.user.id,
        action: 'cash_closing',
        description: `a clôturé la caisse ${LABEL_METHODE[entree.paymentMethod]} du ${new Date(date).toLocaleDateString('fr-FR')}`,
      });
    }

    // Le caissier ne doit pas recevoir le théorique ni l'écart dans la
    // réponse (même logique que /cash/summary) : seul manager/gérant les voit.
    const estCaissier = req.user.role === 'caissier';
    res.status(201).json(
      estCaissier
        ? resultats.map((r) => ({ id: r.id, payment_method: r.payment_method, actual_balance: r.actual_balance, created_at: r.created_at }))
        : resultats
    );
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la clôture de caisse.' });
  }
});

// GET /cash/closings?from=&to= — historique des clôtures (manager/gérant)
router.get('/closings', requireRole('manager', 'gerant'), async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Les dates "from" et "to" sont requises.' });
  try {
    const warehouseId = await resolveWarehouseId(req, null, req.query.warehouseId);
    const result = await pool.query(
      `SELECT cc.*, u.full_name AS closed_by_name
       FROM cash_closings cc LEFT JOIN users u ON u.id = cc.closed_by
       WHERE cc.merchant_id = $1 AND cc.closing_date >= $2 AND cc.closing_date <= $3 AND cc.warehouse_id = $4
       ORDER BY cc.closing_date DESC, cc.payment_method`,
      [req.user.merchantId, from, to, warehouseId]
    );
    res.json(result.rows);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des clôtures.' });
  }
});

// POST /cash/expenses — enregistrer une sortie de caisse manuelle
router.post('/expenses', requireRole('manager', 'gerant', 'caissier'), async (req, res) => {
  const { paymentMethod, amount, reason, expenseDate, warehouseId: warehouseIdInput } = req.body;
  if (!MOYENS_PAIEMENT.includes(paymentMethod)) {
    return res.status(400).json({ error: 'Moyen de paiement invalide.' });
  }
  if (!Number(amount) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Montant invalide.' });
  }
  if (!reason) {
    return res.status(400).json({ error: 'Le motif de la sortie de caisse est requis.' });
  }

  try {
    const warehouseId = await resolveWarehouseId(req, null, warehouseIdInput);
    const result = await pool.query(
      `INSERT INTO cash_expenses (merchant_id, user_id, payment_method, amount, reason, expense_date, movement_type, warehouse_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'sortie', $7) RETURNING *`,
      [req.user.merchantId, req.user.id, paymentMethod, Number(amount), reason, expenseDate || new Date().toISOString().slice(0, 10), warehouseId]
    );

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'cash_expense',
      description: `a enregistré une sortie de caisse de ${Math.round(Number(amount)).toLocaleString('fr-FR')} FCFA (${LABEL_METHODE[paymentMethod]}) : ${reason}`,
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement de la sortie de caisse." });
  }
});

// GET /cash/expenses?from=&to=&method= — liste des sorties de caisse
router.get('/expenses', requireRole('manager', 'gerant', 'caissier'), async (req, res) => {
  const { from, to, method } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Les dates "from" et "to" sont requises.' });
  try {
    const warehouseId = await resolveWarehouseId(req, null, req.query.warehouseId);
    const params = [req.user.merchantId, from, to, warehouseId];
    let filtre = '';
    if (method) {
      params.push(method);
      filtre = `AND payment_method = $${params.length}`;
    }
    const result = await pool.query(
      `SELECT ce.*, u.full_name AS user_name
       FROM cash_expenses ce LEFT JOIN users u ON u.id = ce.user_id
       WHERE ce.merchant_id = $1 AND ce.expense_date >= $2 AND ce.expense_date <= $3 AND ce.movement_type = 'sortie' AND ce.warehouse_id = $4 ${filtre}
       ORDER BY ce.expense_date DESC, ce.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des sorties de caisse.' });
  }
});

// POST /cash/deposits — enregistrer une entrée de caisse manuelle (ex : de
// l'argent liquide remis en caisse après l'encaissement d'un chèque à la
// banque). Symétrique de /cash/expenses, même table (cash_expenses),
// distinguée par movement_type = 'entree'.
router.post('/deposits', requireRole('manager', 'gerant', 'caissier'), async (req, res) => {
  const { paymentMethod, amount, reason, expenseDate, warehouseId: warehouseIdInput } = req.body;
  if (!MOYENS_PAIEMENT.includes(paymentMethod)) {
    return res.status(400).json({ error: 'Moyen de paiement invalide.' });
  }
  if (!Number(amount) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Montant invalide.' });
  }
  if (!reason) {
    return res.status(400).json({ error: "Le motif de l'entrée de caisse est requis." });
  }

  try {
    const warehouseId = await resolveWarehouseId(req, null, warehouseIdInput);
    const result = await pool.query(
      `INSERT INTO cash_expenses (merchant_id, user_id, payment_method, amount, reason, expense_date, movement_type, warehouse_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'entree', $7) RETURNING *`,
      [req.user.merchantId, req.user.id, paymentMethod, Number(amount), reason, expenseDate || new Date().toISOString().slice(0, 10), warehouseId]
    );

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'cash_deposit',
      description: `a enregistré une entrée de caisse de ${Math.round(Number(amount)).toLocaleString('fr-FR')} FCFA (${LABEL_METHODE[paymentMethod]}) : ${reason}`,
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement de l'entrée de caisse." });
  }
});

// GET /cash/deposits?from=&to=&method= — liste des entrées de caisse manuelles
router.get('/deposits', requireRole('manager', 'gerant', 'caissier'), async (req, res) => {
  const { from, to, method } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Les dates "from" et "to" sont requises.' });
  try {
    const warehouseId = await resolveWarehouseId(req, null, req.query.warehouseId);
    const params = [req.user.merchantId, from, to, warehouseId];
    let filtre = '';
    if (method) {
      params.push(method);
      filtre = `AND payment_method = $${params.length}`;
    }
    const result = await pool.query(
      `SELECT ce.*, u.full_name AS user_name
       FROM cash_expenses ce LEFT JOIN users u ON u.id = ce.user_id
       WHERE ce.merchant_id = $1 AND ce.expense_date >= $2 AND ce.expense_date <= $3 AND ce.movement_type = 'entree' AND ce.warehouse_id = $4 ${filtre}
       ORDER BY ce.expense_date DESC, ce.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des entrées de caisse.' });
  }
});

// GET /cash/cashiers — liste des membres actifs du commerçant, pour peupler
// le filtre "par caissier" du relevé (manager/gérant uniquement).
router.get('/cashiers', requireRole('manager', 'gerant'), async (req, res) => {
  try {
    const warehouseId = await resolveWarehouseId(req, null, req.query.warehouseId);
    const result = await pool.query(
      `SELECT id, full_name, role FROM users
       WHERE merchant_id = $1 AND is_active = true AND warehouse_id = $2 AND role = 'caissier'
       ORDER BY full_name`,
      [req.user.merchantId, warehouseId]
    );
    res.json(result.rows);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des membres.' });
  }
});

// GET /cash/movements?method=&from=&to=&cashier= — relevé détaillé d'un
// moyen de paiement (ou tous confondus si method=tous), éventuellement
// filtré sur un seul auteur (cashier=id utilisateur, ou 'tous'/absent pour
// tout le monde confondu).
router.get('/movements', requireRole('manager', 'gerant'), async (req, res) => {
  const { method, from, to, cashier } = req.query;
  if ((!MOYENS_PAIEMENT.includes(method) && method !== 'tous') || !from || !to) {
    return res.status(400).json({ error: 'Moyen de paiement et dates "from"/"to" requis.' });
  }
  try {
    const warehouseId = await resolveWarehouseId(req, null, req.query.warehouseId);
    const mouvements = await recupererMouvementsDetailles(req, method, from, to, cashier, warehouseId);
    res.json(mouvements);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du relevé.' });
  }
});

// GET /cash/movements/pdf?method=&from=&to=&cashier= — export PDF du relevé,
// avec solde cumulé et l'auteur de chaque mouvement.
router.get('/movements/pdf', requireRole('manager', 'gerant'), async (req, res) => {
  const { method, from, to, cashier } = req.query;
  if ((!MOYENS_PAIEMENT.includes(method) && method !== 'tous') || !from || !to) {
    return res.status(400).json({ error: 'Moyen de paiement et dates "from"/"to" requis.' });
  }
  const tous = method === 'tous';
  const tousCaissiers = !cashier || cashier === 'tous';
  try {
    const warehouseId = await resolveWarehouseId(req, null, req.query.warehouseId);
    const merchantResult = await pool.query(`SELECT business_name FROM merchants WHERE id = $1`, [req.user.merchantId]);
    const businessName = merchantResult.rows[0]?.business_name || 'Commerce';
    const warehouseResult = await pool.query(`SELECT name FROM warehouses WHERE id = $1`, [warehouseId]);
    const warehouseName = warehouseResult.rows[0]?.name || '';

    const mouvements = await recupererMouvementsDetailles(req, method, from, to, cashier, warehouseId);
    const nomCaissier = tousCaissiers ? null : (mouvements.find((m) => m.user_id === cashier)?.user_name || null);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="releve-${method}-${from}-${to}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    const titre = tous ? 'Relevé de caisse — Tous les moyens' : `Relevé de caisse — ${LABEL_METHODE[method]}`;
    let y = dessinerEntete(doc, {
      businessName,
      titre,
      sousTitre: `${warehouseName} · Du ${new Date(from).toLocaleDateString('fr-FR')} au ${new Date(to).toLocaleDateString('fr-FR')}${nomCaissier ? ` · ${nomCaissier}` : ''} · ${mouvements.length} mouvement(s)`,
    });
    y += 10;

    // Colonne "Par" ajoutée systématiquement (c'est tout l'intérêt de ce
    // relevé) ; la largeur de "Mouvement" est réduite pour lui faire de la
    // place, et la colonne "Moyen" ne s'affiche qu'en vue "tous".
    const colonnes = tous
      ? [
          { texte: 'Date', x: 54, largeur: 48 },
          { texte: 'Mouvement', x: 104, largeur: 140 },
          { texte: 'Moyen', x: 246, largeur: 60 },
          { texte: 'Par', x: 308, largeur: 90 },
          { texte: 'Montant', x: 400, largeur: 68, aligner: 'right' },
          { texte: 'Solde cumulé', x: 470, largeur: 75, aligner: 'right' },
        ]
      : [
          { texte: 'Date', x: 54, largeur: 55 },
          { texte: 'Mouvement', x: 111, largeur: 180 },
          { texte: 'Par', x: 293, largeur: 100 },
          { texte: 'Montant', x: 395, largeur: 70, aligner: 'right' },
          { texte: 'Solde cumulé', x: 467, largeur: 78, aligner: 'right' },
        ];

    function entete() {
      y = dessinerEnteteTableau(doc, y, colonnes);
    }
    entete();

    let solde = 0;
    mouvements.forEach((m, index) => {
      if (y > 750) {
        doc.addPage();
        y = 50;
        entete();
      }
      const montantSigne = m.sens === 'entree' ? Number(m.amount) : -Number(m.amount);
      solde += montantSigne;

      if (index % 2 === 1) {
        doc.rect(50, y, doc.page.width - 100, 20).fill(COULEURS.fondAlterne);
        doc.fillColor(COULEURS.encre);
      }
      const date = new Date(m.date);
      const auteur = m.user_name || '—';
      doc.fontSize(8.5).fillColor(COULEURS.muted).text(date.toLocaleDateString('fr-FR'), tous ? 54 : 54, y + 5, { width: tous ? 48 : 55 });
      doc.fillColor(COULEURS.encre).text(texteMouvement(m), tous ? 104 : 111, y + 5, { width: tous ? 140 : 180 });
      if (tous) {
        doc.fillColor(COULEURS.muted).text(LABEL_METHODE[m.payment_method] || '—', 246, y + 5, { width: 60 });
      }
      doc.fillColor(COULEURS.muted).text(auteur, tous ? 308 : 293, y + 5, { width: tous ? 90 : 100 });
      doc.fillColor(COULEURS.encre).text(`${montantSigne >= 0 ? '+' : ''}${formatMontant(montantSigne)}`, tous ? 400 : 395, y + 5, { width: tous ? 68 : 70, align: 'right' });
      doc.text(formatMontant(solde), tous ? 470 : 467, y + 5, { width: tous ? 75 : 78, align: 'right' });
      y += 20;
    });

    doc.end();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
  }
});

module.exports = router;
