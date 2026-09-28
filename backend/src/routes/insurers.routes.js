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

// Même pattern que dans prescriptions_routes.js / orders_routes.js : le
// manager (qui voit toutes les boutiques) doit préciser laquelle reçoit le
// règlement ; le gérant est déjà rattaché à une seule boutique.
async function resolveWarehouseId(req, providedId) {
  if (req.user.role === 'manager') {
    if (!providedId) throw { status: 400, message: 'La boutique est requise.' };
    const result = await pool.query(
      `SELECT id FROM warehouses WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
      [providedId, req.user.merchantId]
    );
    if (result.rows.length === 0) throw { status: 404, message: 'Boutique introuvable.' };
    return providedId;
  }
  if (!req.user.warehouseId) throw { status: 403, message: "Vous n'êtes assigné à aucune boutique." };
  return req.user.warehouseId;
}

// GET /insurers — liste avec la créance (ce que l'assureur nous doit pour
// les ventes en tiers payant) calculée à la volée, jamais stockée.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         i.id, i.name, i.phone, i.email, i.address, i.created_at,
         COALESCE(prises_en_charge.total, 0) - COALESCE(paiements.total, 0) AS debt
       FROM insurers i
       LEFT JOIN (
         SELECT insurer_id, SUM(amount) AS total
         FROM insurer_claims
         WHERE merchant_id = $1
         GROUP BY insurer_id
       ) prises_en_charge ON prises_en_charge.insurer_id = i.id
       LEFT JOIN (
         SELECT insurer_id, SUM(amount) AS total
         FROM insurer_payments
         WHERE merchant_id = $1
         GROUP BY insurer_id
       ) paiements ON paiements.insurer_id = i.id
       WHERE i.merchant_id = $1 AND i.is_active = TRUE
       ORDER BY i.name`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des mutuelles.' });
  }
});

// GET /insurers/:id — détail d'une mutuelle : créance + historique des
// prises en charge et des règlements reçus (pour la modale de règlement).
router.get('/:id', async (req, res) => {
  try {
    const insurerResult = await pool.query(
      `SELECT id, name, phone, email, address, created_at
       FROM insurers WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
      [req.params.id, req.user.merchantId]
    );
    const insurer = insurerResult.rows[0];
    if (!insurer) return res.status(404).json({ error: 'Mutuelle introuvable.' });

    const prisesEnChargeResult = await pool.query(
      `SELECT ic.id, ic.amount, ic.created_at, o.order_seq, c.full_name AS client_name
       FROM insurer_claims ic
       JOIN orders o ON o.id = ic.order_id
       JOIN clients c ON c.id = ic.client_id
       WHERE ic.insurer_id = $1 AND ic.merchant_id = $2
       ORDER BY ic.created_at DESC`,
      [req.params.id, req.user.merchantId]
    );
    const paiementsResult = await pool.query(
      `SELECT ip.id, ip.amount, ip.payment_method, ip.paid_at, ip.notes, u.full_name AS user_name
       FROM insurer_payments ip
       JOIN users u ON u.id = ip.user_id
       WHERE ip.insurer_id = $1 AND ip.merchant_id = $2
       ORDER BY ip.paid_at DESC`,
      [req.params.id, req.user.merchantId]
    );

    const totalPrisesEnCharge = prisesEnChargeResult.rows.reduce((s, e) => s + Number(e.amount || 0), 0);
    const totalPaiements = paiementsResult.rows.reduce((s, p) => s + Number(p.amount), 0);

    res.json({
      ...insurer,
      debt: totalPrisesEnCharge - totalPaiements,
      claims: prisesEnChargeResult.rows,
      payments: paiementsResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération de la mutuelle.' });
  }
});

// GET /insurers/:id/statement-pdf?month=YYYY-MM — état mensuel pour un
// assureur donné, à lui transmettre pour obtenir le remboursement : détail
// de chaque prise en charge du mois + total dû.
router.get('/:id/statement-pdf', async (req, res) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Le mois est requis, au format AAAA-MM.' });
  }

  try {
    const insurerResult = await pool.query(
      `SELECT id, name FROM insurers WHERE id = $1 AND merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const insurer = insurerResult.rows[0];
    if (!insurer) return res.status(404).json({ error: 'Mutuelle introuvable.' });

    const merchantResult = await pool.query(`SELECT business_name FROM merchants WHERE id = $1`, [req.user.merchantId]);
    const businessName = merchantResult.rows[0]?.business_name || 'Commerce';

    const result = await pool.query(
      `SELECT ic.amount, ic.created_at, o.order_seq, o.total_amount AS order_total, c.full_name AS client_name
       FROM insurer_claims ic
       JOIN orders o ON o.id = ic.order_id
       JOIN clients c ON c.id = ic.client_id
       WHERE ic.insurer_id = $1 AND ic.merchant_id = $2
         AND to_char(ic.created_at, 'YYYY-MM') = $3
       ORDER BY ic.created_at`,
      [req.params.id, req.user.merchantId, month]
    );

    const prisesEnCharge = result.rows;
    const totalDu = prisesEnCharge.reduce((somme, p) => somme + Number(p.amount || 0), 0);
    const [annee, moisNum] = month.split('-');
    const nomMois = new Date(`${annee}-${moisNum}-01`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const numeroFacture = `MUT-${annee}${moisNum}-${String(insurer.id).slice(0, 4).toUpperCase()}`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="etat-${insurer.name.replace(/[^a-zA-Z0-9]+/g, '-')}-${month}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    let y = dessinerEntete(doc, {
      businessName,
      titre: `Facture mensuelle — ${insurer.name}`,
      sousTitre: `N° ${numeroFacture} · ${nomMois} · ${prisesEnCharge.length} prise(s) en charge · émise le ${new Date().toLocaleDateString('fr-FR')}`,
    });
    y += 10;

    doc.fontSize(11).font('Helvetica-Bold').fillColor(COULEURS.encre).text('Montant à verser pour le mois', 50, y);
    doc.text(`${formatMontant(totalDu)} FCFA`, 400, y, { width: 145, align: 'right' });
    y += 28;

    function entete() {
      y = dessinerEnteteTableau(doc, y, [
        { texte: 'Date', x: 56, largeur: 80 },
        { texte: 'Commande', x: 140, largeur: 90 },
        { texte: 'Client', x: 235, largeur: 170 },
        { texte: 'Total vente', x: 410, largeur: 70, aligner: 'right' },
        { texte: 'Pris en charge', x: 485, largeur: 65, aligner: 'right' },
      ]);
    }
    entete();

    prisesEnCharge.forEach((p, index) => {
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
      doc.fillColor(COULEURS.encre).text(new Date(p.created_at).toLocaleDateString('fr-FR'), 56, y + 5, { width: 80 });
      doc.text(`#${p.order_seq}`, 140, y + 5, { width: 90 });
      doc.fillColor(COULEURS.muted).text(p.client_name, 235, y + 5, { width: 170 });
      doc.fillColor(COULEURS.encre).text(`${formatMontant(p.order_total)} FCFA`, 410, y + 5, { width: 70, align: 'right' });
      doc.text(`${formatMontant(p.amount)} FCFA`, 485, y + 5, { width: 65, align: 'right' });
      y += 20;
    });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la génération de l'état mensuel." });
  }
});

// POST /insurers/:id/payments — enregistrer un règlement reçu de l'assureur
router.post('/:id/payments', async (req, res) => {
  const { amount, notes, paymentMethod, warehouseId: warehouseIdInput } = req.body;
  if (!Number(amount) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Montant de règlement invalide.' });
  }
  if (!MOYENS_PAIEMENT.includes(paymentMethod)) {
    return res.status(400).json({ error: 'Moyen de paiement invalide.' });
  }
  try {
    const warehouseId = await resolveWarehouseId(req, warehouseIdInput);

    const insurer = await pool.query(
      `SELECT id, name FROM insurers WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
      [req.params.id, req.user.merchantId]
    );
    if (insurer.rows.length === 0) return res.status(404).json({ error: 'Mutuelle introuvable.' });

    // Ce règlement entre directement dans la caisse de cette boutique — au
    // même titre qu'un règlement de crédit ou un reste à charge tiers
    // payant — voir GET /cash/summary et /cash/movements.
    const result = await pool.query(
      `INSERT INTO insurer_payments (merchant_id, insurer_id, user_id, amount, payment_method, notes, warehouse_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.merchantId, req.params.id, req.user.id, Number(amount), paymentMethod, notes || null, warehouseId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement du règlement." });
  }
});

// POST /insurers
router.post('/', async (req, res) => {
  const { name, phone, email, address } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Le nom de la mutuelle est requis.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO insurers (merchant_id, name, phone, email, address)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.merchantId, name, phone || null, email || null, address || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création de la mutuelle.' });
  }
});

// DELETE /insurers/:id — désactivation (pas de suppression physique)
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE insurers SET is_active = FALSE WHERE id = $1 AND merchant_id = $2 RETURNING id`,
      [req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Mutuelle introuvable.' });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la suppression de la mutuelle.' });
  }
});

module.exports = router;
