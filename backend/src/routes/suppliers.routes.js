const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { COULEURS, formatMontant, dessinerEntete, dessinerEnteteTableau } = require('../utils/pdfHelpers');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('manager', 'gerant'));

const MOYENS_PAIEMENT = ['especes', 'wave', 'orange_money', 'cheque', 'virement'];

// GET /suppliers — liste avec la dette (créance du fournisseur envers nous,
// pour les achats à crédit) calculée à la volée : jamais stockée, pour
// éviter toute désynchronisation.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         s.id, s.name, s.phone, s.email, s.address, s.created_at,
         COALESCE(entrees.total, 0) - COALESCE(paiements.total, 0) AS debt
       FROM suppliers s
       LEFT JOIN (
         SELECT supplier_id, SUM(total_cost) AS total
         FROM stock_movements
         WHERE merchant_id = $1 AND movement_type = 'entree' AND payment_method = 'a_credit'
         GROUP BY supplier_id
       ) entrees ON entrees.supplier_id = s.id
       LEFT JOIN (
         SELECT supplier_id, SUM(amount) AS total
         FROM supplier_payments
         WHERE merchant_id = $1
         GROUP BY supplier_id
       ) paiements ON paiements.supplier_id = s.id
       WHERE s.merchant_id = $1 AND s.is_active = TRUE
       ORDER BY s.name`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des fournisseurs.' });
  }
});

// GET /suppliers/:id — détail d'un fournisseur : dette + historique des
// entrées à crédit et des règlements (pour la modale de règlement).
router.get('/:id', async (req, res) => {
  try {
    const supplierResult = await pool.query(
      `SELECT id, name, phone, email, address, created_at
       FROM suppliers WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
      [req.params.id, req.user.merchantId]
    );
    const supplier = supplierResult.rows[0];
    if (!supplier) return res.status(404).json({ error: 'Fournisseur introuvable.' });

    const entreesResult = await pool.query(
      `SELECT sm.id, sm.quantity, sm.total_cost, sm.movement_date, sm.created_at, p.name AS product_name
       FROM stock_movements sm
       JOIN products p ON p.id = sm.product_id
       WHERE sm.supplier_id = $1 AND sm.merchant_id = $2 AND sm.movement_type = 'entree' AND sm.payment_method = 'a_credit'
       ORDER BY sm.created_at DESC`,
      [req.params.id, req.user.merchantId]
    );
    const paiementsResult = await pool.query(
      `SELECT sp.id, sp.amount, sp.payment_method, sp.paid_at, sp.notes, u.full_name AS user_name
       FROM supplier_payments sp
       JOIN users u ON u.id = sp.user_id
       WHERE sp.supplier_id = $1 AND sp.merchant_id = $2
       ORDER BY sp.paid_at DESC`,
      [req.params.id, req.user.merchantId]
    );

    const totalAchatsCredit = entreesResult.rows.reduce((s, e) => s + Number(e.total_cost || 0), 0);
    const totalPaiements = paiementsResult.rows.reduce((s, p) => s + Number(p.amount), 0);

    res.json({
      ...supplier,
      debt: totalAchatsCredit - totalPaiements,
      creditEntries: entreesResult.rows,
      payments: paiementsResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du fournisseur.' });
  }
});

// GET /suppliers/purchases/pdf?from=&to= — export PDF de tous les
// achats (entrées de stock avec fournisseur) sur une période donnée, tous
// fournisseurs confondus. Pas besoin de requireRole ici : déjà appliqué à
// tout le router via router.use(requireRole('manager', 'gerant')) plus haut.
router.get('/purchases/pdf', async (req, res) => {
  const { from, to } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: 'Les dates de début et de fin sont requises.' });
  }

  try {
    const merchantResult = await pool.query(`SELECT business_name FROM merchants WHERE id = $1`, [req.user.merchantId]);
    const businessName = merchantResult.rows[0]?.business_name || 'Commerce';

    const result = await pool.query(
      `SELECT
         sm.id, sm.quantity, sm.total_cost, sm.payment_method, sm.cash_method,
         COALESCE(sm.movement_date, sm.created_at::date) AS date_achat,
         p.name AS product_name,
         s.name AS supplier_name
       FROM stock_movements sm
       JOIN products p ON p.id = sm.product_id
       JOIN suppliers s ON s.id = sm.supplier_id
       WHERE sm.merchant_id = $1
         AND sm.movement_type = 'entree'
         AND sm.supplier_id IS NOT NULL
         AND COALESCE(sm.movement_date, sm.created_at::date) BETWEEN $2 AND $3
       ORDER BY date_achat, s.name, p.name`,
      [req.user.merchantId, from, to]
    );

    const achats = result.rows;
    const totalGeneral = achats.reduce((somme, a) => somme + Number(a.total_cost || 0), 0);

    const totauxParFournisseur = new Map();
    achats.forEach((a) => {
      const nom = a.supplier_name || 'Fournisseur inconnu';
      totauxParFournisseur.set(nom, (totauxParFournisseur.get(nom) || 0) + Number(a.total_cost || 0));
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="achats-fournisseurs-${from}-au-${to}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    let y = dessinerEntete(doc, {
      businessName,
      titre: 'Achats fournisseurs',
      sousTitre: `Du ${new Date(from).toLocaleDateString('fr-FR')} au ${new Date(to).toLocaleDateString('fr-FR')} · ${achats.length} achat(s)`,
    });
    y += 10;

    doc.fontSize(11).font('Helvetica-Bold').fillColor(COULEURS.encre).text('Récapitulatif par fournisseur', 50, y);
    y += 18;
    doc.fontSize(9.5).font('Helvetica');
    totauxParFournisseur.forEach((total, nom) => {
      doc.fillColor(COULEURS.encre).text(nom, 56, y, { width: 300 });
      doc.text(`${formatMontant(total)} FCFA`, 400, y, { width: 145, align: 'right' });
      y += 16;
    });
    y += 6;
    doc.font('Helvetica-Bold');
    doc.text('Total général', 56, y, { width: 300 });
    doc.text(`${formatMontant(totalGeneral)} FCFA`, 400, y, { width: 145, align: 'right' });
    doc.font('Helvetica');
    y += 28;

    function entete() {
      y = dessinerEnteteTableau(doc, y, [
        { texte: 'Date', x: 56, largeur: 70 },
        { texte: 'Fournisseur', x: 130, largeur: 140 },
        { texte: 'Produit', x: 275, largeur: 130 },
        { texte: 'Qté', x: 410, largeur: 40, aligner: 'right' },
        { texte: 'Montant', x: 455, largeur: 95, aligner: 'right' },
      ]);
    }
    entete();

    achats.forEach((a, index) => {
      if (y > 760) {
        doc.addPage();
        y = 50;
        entete();
      }
      if (index % 2 === 1) {
        doc.rect(50, y, doc.page.width - 100, 20).fill(COULEURS.fondAlterne);
        doc.fillColor(COULEURS.encre);
      }
      doc.fontSize(9);
      doc.fillColor(COULEURS.encre).text(new Date(a.date_achat).toLocaleDateString('fr-FR'), 56, y + 5, { width: 70 });
      doc.text(a.supplier_name || '—', 130, y + 5, { width: 140 });
      doc.fillColor(COULEURS.muted).text(a.product_name, 275, y + 5, { width: 130 });
      doc.fillColor(COULEURS.encre).text(String(a.quantity), 410, y + 5, { width: 40, align: 'right' });
      doc.text(a.total_cost != null ? `${formatMontant(a.total_cost)} FCFA` : '—', 455, y + 5, { width: 95, align: 'right' });
      y += 20;
    });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la génération du PDF des achats." });
  }
});

// POST /suppliers/:id/payments — enregistrer un règlement de dette
router.post('/:id/payments', async (req, res) => {
  const { amount, notes, paymentMethod } = req.body;
  if (!Number(amount) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Montant de règlement invalide.' });
  }
  if (!MOYENS_PAIEMENT.includes(paymentMethod)) {
    return res.status(400).json({ error: 'Moyen de paiement invalide.' });
  }
  try {
    const supplier = await pool.query(
      `SELECT id, name FROM suppliers WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
      [req.params.id, req.user.merchantId]
    );
    if (supplier.rows.length === 0) return res.status(404).json({ error: 'Fournisseur introuvable.' });

    const result = await pool.query(
      `INSERT INTO supplier_payments (merchant_id, supplier_id, user_id, amount, payment_method, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.merchantId, req.params.id, req.user.id, Number(amount), paymentMethod, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement du règlement." });
  }
});

// POST /suppliers
router.post('/', async (req, res) => {
  const { name, phone, email, address } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Le nom du fournisseur est requis.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO suppliers (merchant_id, name, phone, email, address)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.merchantId, name, phone || null, email || null, address || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du fournisseur.' });
  }
});

// DELETE /suppliers/:id — désactivation (pas de suppression physique)
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE suppliers SET is_active = FALSE WHERE id = $1 AND merchant_id = $2 RETURNING id`,
      [req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fournisseur introuvable.' });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la suppression du fournisseur.' });
  }
});

module.exports = router;
