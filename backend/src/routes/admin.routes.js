const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('owner'));

// GET /admin/merchants — liste de tous les commerçants de la plateforme,
// avec le nombre de comptes actuels vs le plafond autorisé.
router.get('/merchants', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.id, m.business_name, m.sector, m.email, m.is_active, m.max_team_members, m.created_at,
              COUNT(u.id)::int AS member_count
       FROM merchants m
       LEFT JOIN users u ON u.merchant_id = m.id
       GROUP BY m.id
       ORDER BY m.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des commerçants.' });
  }
});

// PATCH /admin/merchants/:id/status — bloquer/débloquer un commerçant
// entier : empêche tous ses utilisateurs de se connecter, sans supprimer
// aucune donnée. Réversible à tout moment.
router.patch('/merchants/:id/status', async (req, res) => {
  const { isActive } = req.body;
  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'isActive doit être un booléen.' });
  }
  try {
    const result = await pool.query(
      `UPDATE merchants SET is_active = $1 WHERE id = $2 RETURNING id, business_name, is_active`,
      [isActive, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Commerçant introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du commerçant.' });
  }
});

// PATCH /admin/merchants/:id/limit — ajuster le nombre de comptes que ce
// commerçant est autorisé à créer (vérifié côté /users lors de la création
// d'un membre par le manager).
router.patch('/merchants/:id/limit', async (req, res) => {
  const { maxTeamMembers } = req.body;
  if (!Number.isInteger(maxTeamMembers) || maxTeamMembers < 1) {
    return res.status(400).json({ error: 'maxTeamMembers doit être un entier positif.' });
  }
  try {
    const result = await pool.query(
      `UPDATE merchants SET max_team_members = $1 WHERE id = $2 RETURNING id, business_name, max_team_members`,
      [maxTeamMembers, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Commerçant introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du plafond.' });
  }
});

// DELETE /admin/merchants/:id — supprime définitivement un commerçant.
// Bloqué (comme pour les membres d'équipe côté manager) si des données
// liées existent (ventes, clients, stock…) — préférer bloquer plutôt que
// supprimer un commerce qui a de l'historique.
router.delete('/merchants/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM merchants WHERE id = $1 RETURNING id, business_name`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Commerçant introuvable.' });
    res.json({ message: 'Commerçant supprimé avec succès.' });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({
        error: 'Ce commerçant a des données liées (ventes, clients, stock…) et ne peut pas être supprimé. Bloquez-le plutôt.',
      });
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la suppression du commerçant.' });
  }
});

// GET /admin/merchants/:id/users — équipe complète d'un commerçant donné.
router.get('/merchants/:id/users', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, email, role, is_active, last_login_at, created_at
       FROM users WHERE merchant_id = $1
       ORDER BY CASE role WHEN 'manager' THEN 0 WHEN 'gerant' THEN 1 ELSE 2 END, full_name`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la récupération de l'équipe." });
  }
});

// PATCH /admin/users/:id/status — bloquer/débloquer n'importe quel
// utilisateur, y compris un manager, tous commerçants confondus.
router.patch('/users/:id/status', async (req, res) => {
  const { isActive } = req.body;
  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'isActive doit être un booléen.' });
  }
  try {
    const result = await pool.query(
      `UPDATE users SET is_active = $1 WHERE id = $2 AND role != 'owner' RETURNING id, full_name, role, is_active`,
      [isActive, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la mise à jour de l'utilisateur." });
  }
});

// PATCH /admin/users/:id/password — l'owner réinitialise le mot de passe de
// n'importe quel utilisateur, y compris un manager (cas où le manager a
// oublié le sien et n'a personne au-dessus de lui côté commerçant pour le
// réinitialiser). Contrairement à PATCH /users/:id/password côté manager,
// ici 'manager' n'est pas exclu — seul un autre owner l'est.
router.patch('/users/:id/password', async (req, res) => {
  const { newPassword } = req.body;

  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
  }

  try {
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const result = await pool.query(
      `UPDATE users SET password_hash = $1
       WHERE id = $2 AND role != 'owner'
       RETURNING id, full_name, role, merchant_id`,
      [passwordHash, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    const target = result.rows[0];
    if (target.merchant_id) {
      await logActivity({
        merchantId: target.merchant_id,
        userId: req.user.id,
        action: 'team_member_password_reset',
        description: `le propriétaire de la plateforme a réinitialisé le mot de passe de ${target.full_name}`,
      });
    }

    res.json({ id: target.id, full_name: target.full_name, role: target.role, message: 'Mot de passe réinitialisé avec succès.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la réinitialisation du mot de passe.' });
  }
});

// DELETE /admin/users/:id — supprime n'importe quel utilisateur, y compris
// un manager. Bloqué si historique lié, comme pour /users côté manager.
router.delete('/users/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 AND role != 'owner' RETURNING id, full_name`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    res.json({ message: 'Utilisateur supprimé avec succès.' });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({
        error: "Cet utilisateur a un historique lié et ne peut pas être supprimé. Bloquez-le plutôt.",
      });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la suppression de l'utilisateur." });
  }
});

module.exports = router;
