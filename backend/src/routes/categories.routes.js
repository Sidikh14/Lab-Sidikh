const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const router = express.Router();
router.use(authenticate);

// GET /categories — liste des catégories du commerçant, triées par nom.
// Ouvert à tous les rôles authentifiés (comme GET /products) : une
// catégorie n'est pas une donnée sensible, juste un filtre/classement.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name FROM categories WHERE merchant_id = $1 ORDER BY name`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des catégories.' });
  }
});

// POST /categories
router.post('/', requireRole('manager', 'gerant'), async (req, res) => {
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Le nom de la catégorie est requis.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO categories (merchant_id, name) VALUES ($1, $2) RETURNING id, name`,
      [req.user.merchantId, name.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Cette catégorie existe déjà.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création de la catégorie.' });
  }
});

// PATCH /categories/:id
router.patch('/:id', requireRole('manager', 'gerant'), async (req, res) => {
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Le nom de la catégorie est requis.' });
  }

  try {
    const result = await pool.query(
      `UPDATE categories SET name = $1 WHERE id = $2 AND merchant_id = $3 RETURNING id, name`,
      [name.trim(), req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Catégorie introuvable.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Cette catégorie existe déjà.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la modification de la catégorie.' });
  }
});

// DELETE /categories/:id
// Les produits déjà rattachés à cette catégorie ne sont pas supprimés :
// category_id repasse simplement à NULL pour eux (ON DELETE SET NULL, voir
// migration), ils restent visibles dans le stock, juste sans catégorie.
router.delete('/:id', requireRole('manager', 'gerant'), async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM categories WHERE id = $1 AND merchant_id = $2 RETURNING id`,
      [req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Catégorie introuvable.' });
    }
    res.json({ message: 'Catégorie supprimée.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la suppression de la catégorie.' });
  }
});

module.exports = router;
