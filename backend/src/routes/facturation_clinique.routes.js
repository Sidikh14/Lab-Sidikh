const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireClinique } = require('../middleware/clinique');

const router = express.Router();
router.use(authenticate);

const MODES_HONORAIRES = ['pourcentage', 'montant_par_acte', 'salaire'];
const CATEGORIES_ACTES = ['consultation', 'laboratoire', 'imagerie', 'soins', 'maternite', 'vaccination', 'hospitalisation', 'urgences', 'autre'];

// ---------------------------------------------------------------------
// ACTES ET TARIFS
// Un acte est un produit sans stock (track_stock = FALSE, décision H7) : il passe par la même vente que tout le reste.
// ---------------------------------------------------------------------

// GET /clinique/actes?categorie=
router.get('/actes', requireClinique('tarifs', 'lire'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, unit_price, categorie_clinique, tva_applicable, is_active
       FROM products
       WHERE merchant_id = $1 AND track_stock = FALSE AND categorie_clinique IS NOT NULL
         AND ($2::text IS NULL OR categorie_clinique = $2)
       ORDER BY categorie_clinique, name`,
      [req.user.merchantId, req.query.categorie || null]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture des actes.' });
  }
});

// POST /clinique/actes — création d'un acte au tarif (gérant, manager)
router.post('/actes', requireClinique('tarifs', 'ecrire'), async (req, res) => {
  const { name, unitPrice, categorie, tvaApplicable } = req.body;
  const prix = Number(unitPrice);
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Le libellé de l'acte est requis." });
  if (!Number.isFinite(prix) || prix < 0) return res.status(400).json({ error: 'Tarif invalide.' });
  if (!CATEGORIES_ACTES.includes(categorie)) return res.status(400).json({ error: 'Catégorie invalide.' });
  try {
    const result = await pool.query(
      `INSERT INTO products (merchant_id, name, unit_price, quantity_in_stock, track_stock, is_activated, is_active, categorie_clinique, tva_applicable)
       VALUES ($1, $2, $3, 0, FALSE, TRUE, TRUE, $4, $5)
       RETURNING id, name, unit_price, categorie_clinique, tva_applicable`,
      [req.user.merchantId, String(name).trim().slice(0, 200), prix, categorie, Boolean(tvaApplicable)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la création de l'acte." });
  }
});

// PATCH /clinique/actes/:id — changement de tarif ou de libellé (gérant, manager)
router.patch('/actes/:id', requireClinique('tarifs', 'ecrire'), async (req, res) => {
  const { name, unitPrice, isActive } = req.body;
  if (unitPrice !== undefined && (!Number.isFinite(Number(unitPrice)) || Number(unitPrice) < 0)) {
    return res.status(400).json({ error: 'Tarif invalide.' });
  }
  try {
    const result = await pool.query(
      `UPDATE products SET
         name = COALESCE($1, name),
         unit_price = COALESCE($2, unit_price),
         is_active = COALESCE($3, is_active),
         updated_at = now()
       WHERE id = $4 AND merchant_id = $5 AND track_stock = FALSE
       RETURNING id, name, unit_price, is_active`,
      [name || null, unitPrice !== undefined ? Number(unitPrice) : null, typeof isActive === 'boolean' ? isActive : null, req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Acte introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la mise à jour de l'acte." });
  }
});

// ---------------------------------------------------------------------
// HONORAIRES PAR PRATICIEN (H6)
// ---------------------------------------------------------------------

// GET /clinique/praticiens — médecins du commerce avec leur réglage d'honoraires
router.get('/praticiens', requireClinique('honoraires', 'lire'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, s.mode, s.valeur
       FROM users u
       LEFT JOIN practitioner_fee_settings s ON s.practitioner_id = u.id AND s.merchant_id = u.merchant_id
       WHERE u.merchant_id = $1 AND u.is_active = TRUE AND u.roles @> ARRAY['medecin']::text[]
       ORDER BY u.full_name`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture des praticiens.' });
  }
});

// PUT /clinique/praticiens/:id/honoraires — réglage d'honoraires (gérant, manager)
router.put('/praticiens/:id/honoraires', requireClinique('honoraires', 'ecrire'), async (req, res) => {
  const { mode, valeur } = req.body;
  if (!MODES_HONORAIRES.includes(mode)) return res.status(400).json({ error: "Mode d'honoraires invalide." });
  const montant = mode === 'salaire' ? 0 : Number(valeur);
  if (mode !== 'salaire' && (!Number.isFinite(montant) || montant <= 0)) {
    return res.status(400).json({ error: 'Valeur des honoraires invalide.' });
  }
  if (mode === 'pourcentage' && montant > 100) return res.status(400).json({ error: 'Le pourcentage ne peut dépasser 100.' });
  try {
    const praticien = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND merchant_id = $2 AND roles @> ARRAY['medecin']::text[]`,
      [req.params.id, req.user.merchantId]
    );
    if (praticien.rows.length === 0) return res.status(404).json({ error: 'Praticien introuvable.' });

    const result = await pool.query(
      `INSERT INTO practitioner_fee_settings (merchant_id, practitioner_id, mode, valeur, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (merchant_id, practitioner_id) DO UPDATE SET
         mode = EXCLUDED.mode, valeur = EXCLUDED.valeur, updated_at = now(), updated_by = EXCLUDED.updated_by
       RETURNING *`,
      [req.user.merchantId, req.params.id, mode, montant, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde des honoraires.' });
  }
});

// GET /clinique/honoraires?statut=du|verse&praticienId=
router.get('/honoraires', requireClinique('honoraires', 'lire'), async (req, res) => {
  const statut = req.query.statut === 'verse' ? 'verse' : 'du';
  try {
    const result = await pool.query(
      `SELECT e.id, e.montant, e.base_montant, e.mode, e.statut, e.created_at, e.verse_at,
              u.full_name AS praticien, e.order_id
       FROM practitioner_fee_entries e
       JOIN users u ON u.id = e.practitioner_id
       WHERE e.merchant_id = $1 AND e.statut = $2
         AND ($3::uuid IS NULL OR e.practitioner_id = $3::uuid)
       ORDER BY u.full_name, e.created_at`,
      [req.user.merchantId, statut, req.query.praticienId || null]
    );
    const total = result.rows.reduce((s, e) => s + Number(e.montant), 0);
    res.json({ lignes: result.rows, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture des honoraires.' });
  }
});

// POST /clinique/honoraires/versements — marque des écritures comme versées au praticien
router.post('/honoraires/versements', requireClinique('honoraires', 'ecrire'), async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (ids.length === 0) return res.status(400).json({ error: 'Aucune écriture sélectionnée.' });
  try {
    const result = await pool.query(
      `UPDATE practitioner_fee_entries SET statut = 'verse', verse_at = now(), verse_par = $1
       WHERE id = ANY($2::uuid[]) AND merchant_id = $3 AND statut = 'du'
       RETURNING id`,
      [req.user.id, ids, req.user.merchantId]
    );
    res.json({ versees: result.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du versement.' });
  }
});

// ---------------------------------------------------------------------
// RAPPORT DE RECETTES (comptabilité, K18/K19)
// ---------------------------------------------------------------------

// GET /clinique/rapports/recettes?from=AAAA-MM-JJ&to=AAAA-MM-JJ
router.get('/rapports/recettes', requireClinique('comptabilite', 'lire'), async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Les dates from et to sont requises.' });
  try {
    const parPraticien = await pool.query(
      `SELECT COALESCE(u.full_name, 'Non rattaché') AS praticien, COUNT(*) AS actes, SUM(oi.line_total) AS total
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN users u ON u.id = oi.praticien_id
       WHERE o.merchant_id = $1 AND p.track_stock = FALSE AND p.categorie_clinique IS NOT NULL
         AND o.status <> 'annulee' AND o.created_at::date BETWEEN $2::date AND $3::date
       GROUP BY praticien ORDER BY total DESC`,
      [req.user.merchantId, from, to]
    );
    const parCategorie = await pool.query(
      `SELECT p.categorie_clinique AS categorie, COUNT(*) AS actes, SUM(oi.line_total) AS total
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       WHERE o.merchant_id = $1 AND p.track_stock = FALSE AND p.categorie_clinique IS NOT NULL
         AND o.status <> 'annulee' AND o.created_at::date BETWEEN $2::date AND $3::date
       GROUP BY p.categorie_clinique ORDER BY total DESC`,
      [req.user.merchantId, from, to]
    );
    const honoraires = await pool.query(
      `SELECT COALESCE(SUM(montant), 0) AS a_reverser
       FROM practitioner_fee_entries
       WHERE merchant_id = $1 AND statut = 'du'`,
      [req.user.merchantId]
    );
    res.json({
      periode: { from, to },
      parPraticien: parPraticien.rows,
      parCategorie: parCategorie.rows,
      honorairesARevorser: Number(honoraires.rows[0].a_reverser),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la génération du rapport.' });
  }
});

module.exports = router;
