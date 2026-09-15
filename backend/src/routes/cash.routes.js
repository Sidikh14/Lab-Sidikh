const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');
const { COULEURS, formatMontant, dessinerEntete, dessinerEnteteTableau } = require('../utils/pdfHelpers');

const router = express.Router();
router.use(authenticate);

const MOYENS_PAIEMENT = ['especes', 'wave', 'orange_money', 'cheque', 'virement'];
const LABEL_METHODE = { especes: 'Espèces', wave: 'Wave', orange_money: 'Orange Money', cheque: 'Chèque', virement: 'Virement' };

function bornesJour(dateStr) {
  const debut = new Date(`${dateStr}T00:00:00`);
  const fin = new Date(debut);
  fin.setDate(fin.getDate() + 1);
  return [debut.toISOString(), fin.toISOString()];
}

// Calcule, pour chaque moyen de paiement, les entrées et sorties d'argent
// survenues entre deux bornes (timestamps ISO). Utilisé pour la clôture du
// jour comme pour un relevé sur une période plus large.
async function calculerMouvements(req, debutISO, finISO) {
  const debutDate = debutISO.slice(0, 10);
  const finDate = finISO.slice(0, 10);
  const paramsTs = [req.user.merchantId, debutISO, finISO];
  const paramsDate = [req.user.merchantId, debutDate, finDate];

  const encaissementsResult = await pool.query(
    `SELECT payment_method, COALESCE(SUM(total_amount), 0) AS total
     FROM orders
     WHERE merchant_id = $1 AND validated_at >= $2 AND validated_at < $3 AND payment_method != 'a_credit'
     GROUP BY payment_method`,
    paramsTs
  );

  const reglementsCreditResult = await pool.query(
    `SELECT payment_method, COALESCE(SUM(amount), 0) AS total
     FROM credit_payments
     WHERE merchant_id = $1 AND created_at >= $2 AND created_at < $3
     GROUP BY payment_method`,
    paramsTs
  );

  const achatsStockResult = await pool.query(
    `SELECT cash_method AS payment_method, COALESCE(SUM(total_cost), 0) AS total
     FROM stock_movements
     WHERE merchant_id = $1 AND created_at >= $2 AND created_at < $3
       AND movement_type = 'entree' AND payment_method = 'comptant'
     GROUP BY cash_method`,
    paramsTs
  );

  const reglementsFournisseurResult = await pool.query(
    `SELECT payment_method, COALESCE(SUM(amount), 0) AS total
     FROM supplier_payments
     WHERE merchant_id = $1 AND paid_at >= $2 AND paid_at < $3
     GROUP BY payment_method`,
    paramsTs
  );

  const sortiesResult = await pool.query(
    `SELECT payment_method, COALESCE(SUM(amount), 0) AS total
     FROM cash_expenses
     WHERE merchant_id = $1 AND expense_date >= $2 AND expense_date < $3
     GROUP BY payment_method`,
    paramsDate
  );

  const parMethode = {};
  MOYENS_PAIEMENT.forEach((m) => {
    parMethode[m] = { encaissements: 0, reglementsCredit: 0, achatsStock: 0, reglementsFournisseur: 0, sorties: 0 };
  });

  encaissementsResult.rows.forEach((r) => { if (parMethode[r.payment_method]) parMethode[r.payment_method].encaissements = Number(r.total); });
  reglementsCreditResult.rows.forEach((r) => { if (parMethode[r.payment_method]) parMethode[r.payment_method].reglementsCredit = Number(r.total); });
  achatsStockResult.rows.forEach((r) => { if (r.payment_method && parMethode[r.payment_method]) parMethode[r.payment_method].achatsStock = Number(r.total); });
  reglementsFournisseurResult.rows.forEach((r) => { if (parMethode[r.payment_method]) parMethode[r.payment_method].reglementsFournisseur = Number(r.total); });
  sortiesResult.rows.forEach((r) => { if (parMethode[r.payment_method]) parMethode[r.payment_method].sorties = Number(r.total); });

  MOYENS_PAIEMENT.forEach((m) => {
    const d = parMethode[m];
    d.entrees = d.encaissements + d.reglementsCredit;
    d.sortiesTotal = d.achatsStock + d.reglementsFournisseur + d.sorties;
    d.theoretical = d.entrees - d.sortiesTotal;
  });

  return parMethode;
}

// Détail ligne par ligne des mouvements d'UN SEUL moyen de paiement, sur une
// période — utilisé pour le relevé à l'écran et son export PDF.
async function recupererMouvementsDetailles(req, method, from, to) {
  const debut = `${from}T00:00:00`;
  const finExclusive = new Date(`${to}T00:00:00`);
  finExclusive.setDate(finExclusive.getDate() + 1);
  const fin = finExclusive.toISOString();
  const paramsTs = [req.user.merchantId, debut, fin, method];

  const encaissements = await pool.query(
    `SELECT o.id, 'encaissement' AS type, o.validated_at AS date, o.total_amount AS amount,
            o.order_seq, o.created_at AS order_created_at, c.full_name AS client_name
     FROM orders o
     LEFT JOIN clients c ON c.id = o.client_id
     WHERE o.merchant_id = $1 AND o.validated_at >= $2 AND o.validated_at < $3 AND o.payment_method = $4
     ORDER BY o.validated_at`,
    paramsTs
  );

  const reglementsCredit = await pool.query(
    `SELECT cp.id, 'reglement_credit' AS type, cp.created_at AS date, cp.amount, c.full_name AS client_name
     FROM credit_payments cp
     LEFT JOIN clients c ON c.id = cp.client_id
     WHERE cp.merchant_id = $1 AND cp.created_at >= $2 AND cp.created_at < $3 AND cp.payment_method = $4
     ORDER BY cp.created_at`,
    paramsTs
  );

  const achatsStock = await pool.query(
    `SELECT sm.id, 'achat_stock' AS type, sm.created_at AS date, sm.total_cost AS amount,
            p.name AS product_name, s.name AS supplier_name
     FROM stock_movements sm
     LEFT JOIN products p ON p.id = sm.product_id
     LEFT JOIN suppliers s ON s.id = sm.supplier_id
     WHERE sm.merchant_id = $1 AND sm.created_at >= $2 AND sm.created_at < $3
       AND sm.movement_type = 'entree' AND sm.payment_method = 'comptant' AND sm.cash_method = $4
     ORDER BY sm.created_at`,
    paramsTs
  );

  const reglementsFournisseur = await pool.query(
    `SELECT sp.id, 'reglement_fournisseur' AS type, sp.paid_at AS date, sp.amount, s.name AS supplier_name
     FROM supplier_payments sp
     LEFT JOIN suppliers s ON s.id = sp.supplier_id
     WHERE sp.merchant_id = $1 AND sp.paid_at >= $2 AND sp.paid_at < $3 AND sp.payment_method = $4
     ORDER BY sp.paid_at`,
    paramsTs
  );

  const sorties = await pool.query(
    `SELECT ce.id, 'sortie' AS type, ce.expense_date AS date, ce.amount, ce.reason
     FROM cash_expenses ce
     WHERE ce.merchant_id = $1 AND ce.expense_date >= $2 AND ce.expense_date <= $3 AND ce.payment_method = $4
     ORDER BY ce.expense_date`,
    [req.user.merchantId, from, to, method]
  );

  const entrees = [...encaissements.rows, ...reglementsCredit.rows].map((r) => ({ ...r, sens: 'entree' }));
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
  return '';
}

// GET /cash/balances — solde théorique actuel en caisse pour chaque moyen
// de paiement (cumul de tous les mouvements depuis le début de l'activité).
// Affiché en haut de la page Caisse, comme les stats du tableau de bord —
// c'est un solde calculé (comme la valeur du stock), pas le dernier solde
// compté physiquement à une clôture.
router.get('/balances', requireRole('manager', 'gerant', 'caissier'), async (req, res) => {
  try {
    const debut = new Date(0).toISOString();
    const fin = new Date().toISOString();
    const mouvements = await calculerMouvements(req, debut, fin);
    const soldes = MOYENS_PAIEMENT.map((m) => ({
      method: m,
      label: LABEL_METHODE[m],
      balance: mouvements[m].theoretical,
    }));
    res.json(soldes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du calcul des soldes de caisse.' });
  }
});

// GET /cash/summary?date=AAAA-MM-JJ — mouvements du jour + clôture existante,
// pour chaque moyen de paiement.
router.get('/summary', requireRole('manager', 'gerant', 'caissier'), async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const [debut, fin] = bornesJour(date);
    const mouvements = await calculerMouvements(req, debut, fin);

    const closingsResult = await pool.query(
      `SELECT payment_method, theoretical_balance, actual_balance, difference, notes, created_at
       FROM cash_closings WHERE merchant_id = $1 AND closing_date = $2`,
      [req.user.merchantId, date]
    );
    const closingsParMethode = {};
    closingsResult.rows.forEach((c) => { closingsParMethode[c.payment_method] = c; });

    res.json({
      date,
      methods: MOYENS_PAIEMENT.map((m) => ({
        method: m,
        label: LABEL_METHODE[m],
        ...mouvements[m],
        closing: closingsParMethode[m] || null,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du calcul du résumé de caisse.' });
  }
});

// POST /cash/closings — clôture d'un ou plusieurs moyens de paiement pour un jour donné
router.post('/closings', requireRole('manager', 'gerant', 'caissier'), async (req, res) => {
  const { date, entries, notes } = req.body;
  if (!date || !Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'Une date et au moins un moyen de paiement sont requis.' });
  }

  try {
    const [debut, fin] = bornesJour(date);
    const mouvements = await calculerMouvements(req, debut, fin);
    const resultats = [];

    for (const entree of entries) {
      if (!MOYENS_PAIEMENT.includes(entree.paymentMethod) || typeof entree.actualBalance !== 'number') {
        return res.status(400).json({ error: 'Entrée de clôture invalide.' });
      }
      const theorique = mouvements[entree.paymentMethod].theoretical;
      const ecart = entree.actualBalance - theorique;

      const result = await pool.query(
        `INSERT INTO cash_closings (merchant_id, closing_date, payment_method, theoretical_balance, actual_balance, difference, notes, closed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (merchant_id, closing_date, payment_method)
         DO UPDATE SET theoretical_balance = EXCLUDED.theoretical_balance, actual_balance = EXCLUDED.actual_balance,
                       difference = EXCLUDED.difference, notes = EXCLUDED.notes, closed_by = EXCLUDED.closed_by, created_at = now()
         RETURNING *`,
        [req.user.merchantId, date, entree.paymentMethod, theorique, entree.actualBalance, ecart, notes || null, req.user.id]
      );
      resultats.push(result.rows[0]);

      await logActivity({
        merchantId: req.user.merchantId,
        userId: req.user.id,
        action: 'cash_closing',
        description: Math.abs(ecart) > 0
          ? `a clôturé la caisse ${LABEL_METHODE[entree.paymentMethod]} du ${new Date(date).toLocaleDateString('fr-FR')} — écart de ${Math.round(ecart).toLocaleString('fr-FR')} FCFA`
          : `a clôturé la caisse ${LABEL_METHODE[entree.paymentMethod]} du ${new Date(date).toLocaleDateString('fr-FR')} — aucun écart`,
      });
    }

    res.status(201).json(resultats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la clôture de caisse.' });
  }
});

// GET /cash/closings?from=&to= — historique des clôtures (manager/gérant)
router.get('/closings', requireRole('manager', 'gerant'), async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Les dates "from" et "to" sont requises.' });
  try {
    const result = await pool.query(
      `SELECT cc.*, u.full_name AS closed_by_name
       FROM cash_closings cc LEFT JOIN users u ON u.id = cc.closed_by
       WHERE cc.merchant_id = $1 AND cc.closing_date >= $2 AND cc.closing_date <= $3
       ORDER BY cc.closing_date DESC, cc.payment_method`,
      [req.user.merchantId, from, to]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des clôtures.' });
  }
});

// POST /cash/expenses — enregistrer une sortie de caisse manuelle
router.post('/expenses', requireRole('manager', 'gerant', 'caissier'), async (req, res) => {
  const { paymentMethod, amount, reason, expenseDate } = req.body;
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
    const result = await pool.query(
      `INSERT INTO cash_expenses (merchant_id, user_id, payment_method, amount, reason, expense_date)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.merchantId, req.user.id, paymentMethod, Number(amount), reason, expenseDate || new Date().toISOString().slice(0, 10)]
    );

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'cash_expense',
      description: `a enregistré une sortie de caisse de ${Math.round(Number(amount)).toLocaleString('fr-FR')} FCFA (${LABEL_METHODE[paymentMethod]}) : ${reason}`,
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement de la sortie de caisse." });
  }
});

// GET /cash/expenses?from=&to=&method= — liste des sorties de caisse
router.get('/expenses', requireRole('manager', 'gerant', 'caissier'), async (req, res) => {
  const { from, to, method } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Les dates "from" et "to" sont requises.' });
  try {
    const params = [req.user.merchantId, from, to];
    let filtre = '';
    if (method) {
      params.push(method);
      filtre = `AND payment_method = $${params.length}`;
    }
    const result = await pool.query(
      `SELECT ce.*, u.full_name AS user_name
       FROM cash_expenses ce LEFT JOIN users u ON u.id = ce.user_id
       WHERE ce.merchant_id = $1 AND ce.expense_date >= $2 AND ce.expense_date <= $3 ${filtre}
       ORDER BY ce.expense_date DESC, ce.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des sorties de caisse.' });
  }
});

// GET /cash/movements?method=&from=&to= — relevé détaillé d'un moyen de paiement
router.get('/movements', requireRole('manager', 'gerant'), async (req, res) => {
  const { method, from, to } = req.query;
  if (!MOYENS_PAIEMENT.includes(method) || !from || !to) {
    return res.status(400).json({ error: 'Moyen de paiement et dates "from"/"to" requis.' });
  }
  try {
    const mouvements = await recupererMouvementsDetailles(req, method, from, to);
    res.json(mouvements);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du relevé.' });
  }
});

// GET /cash/movements/pdf?method=&from=&to= — export PDF du relevé, avec solde cumulé
router.get('/movements/pdf', requireRole('manager', 'gerant'), async (req, res) => {
  const { method, from, to } = req.query;
  if (!MOYENS_PAIEMENT.includes(method) || !from || !to) {
    return res.status(400).json({ error: 'Moyen de paiement et dates "from"/"to" requis.' });
  }
  try {
    const merchantResult = await pool.query(`SELECT business_name FROM merchants WHERE id = $1`, [req.user.merchantId]);
    const businessName = merchantResult.rows[0]?.business_name || 'Commerce';

    const mouvements = await recupererMouvementsDetailles(req, method, from, to);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="releve-${method}-${from}-${to}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    let y = dessinerEntete(doc, {
      businessName,
      titre: `Relevé de caisse — ${LABEL_METHODE[method]}`,
      sousTitre: `Du ${new Date(from).toLocaleDateString('fr-FR')} au ${new Date(to).toLocaleDateString('fr-FR')} · ${mouvements.length} mouvement(s)`,
    });
    y += 10;

    function entete() {
      y = dessinerEnteteTableau(doc, y, [
        { texte: 'Date', x: 56, largeur: 65 },
        { texte: 'Mouvement', x: 125, largeur: 260 },
        { texte: 'Montant', x: 390, largeur: 75, aligner: 'right' },
        { texte: 'Solde cumulé', x: 470, largeur: 80, aligner: 'right' },
      ]);
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
      doc.fontSize(8.5).fillColor(COULEURS.muted).text(date.toLocaleDateString('fr-FR'), 56, y + 5, { width: 65 });
      doc.fillColor(COULEURS.encre).text(texteMouvement(m), 125, y + 5, { width: 260 });
      doc.text(`${montantSigne >= 0 ? '+' : ''}${formatMontant(montantSigne)}`, 390, y + 5, { width: 75, align: 'right' });
      doc.text(formatMontant(solde), 470, y + 5, { width: 80, align: 'right' });
      y += 20;
    });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
  }
});

module.exports = router;
