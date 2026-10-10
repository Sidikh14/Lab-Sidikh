const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole, normaliserRoles, rolePrincipal, ROLES_ATTRIBUABLES } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();
router.use(authenticate);

// Qui peut créer qui : seul le manager ajoute des membres à l'équipe. Une personne peut cumuler
// plusieurs rôles (gérant, vendeur, caissier, comptable) : on les coche tous, il n'y a plus de rôle
// « vendeur/caissier » à part (l'ancienne valeur est encore acceptée et devient vendeur + caissier).
// Personne ne crée de second manager depuis cette route.
const ROLES_ACCEPTES = [...ROLES_ATTRIBUABLES, 'vendeur_caissier'];

// Rôles qui vendent / encaissent : ils ne peuvent être affectés qu'à une boutique, jamais à un
// dépôt (un dépôt sert uniquement au stockage). Seul un gérant peut être affecté à un dépôt.
const ROLES_VENTE = ['vendeur', 'caissier'];
// Rôles qui travaillent dans un lieu : une boutique est obligatoire. Le comptable, lui, n'en a pas besoin.
const ROLES_AVEC_LIEU = ['gerant', 'vendeur', 'caissier'];
const MSG_DEPOT_RESERVE = "Un dépôt sert uniquement au stockage : seul un gérant peut y être affecté. Choisissez une boutique pour ce rôle.";

// Lit les rôles demandés (liste `roles`, ou ancien champ `role`) et les valide.
function lireRoles(corps) {
  const demandes = Array.isArray(corps?.roles) ? corps.roles : corps?.role ? [corps.role] : [];
  if (demandes.length === 0) return { erreur: 'Choisissez au moins un rôle.', code: 400 };
  if (demandes.includes('manager') || demandes.includes('owner')) {
    return { erreur: 'Vous ne pouvez pas attribuer ce rôle.', code: 403 };
  }
  if (!demandes.every((r) => ROLES_ACCEPTES.includes(r))) return { erreur: 'Rôle invalide.', code: 400 };
  return { roles: normaliserRoles(demandes) };
}
const aRoleDeVente = (roles) => roles.some((r) => ROLES_VENTE.includes(r));
const aBesoinDUnLieu = (roles) => roles.some((r) => ROLES_AVEC_LIEU.includes(r));

// GET /users — liste de l'équipe du commerce (manager et gérant uniquement)
router.get('/', requireRole('manager', 'gerant'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.role, COALESCE(u.roles, ARRAY[u.role::text]) AS roles, u.is_active, u.last_login_at, u.created_at,
              u.visible_modules, u.warehouse_id, w.name AS warehouse_name, w.type AS warehouse_type
       FROM users u
       LEFT JOIN warehouses w ON w.id = u.warehouse_id
       WHERE u.merchant_id = $1
       ORDER BY
         CASE u.role WHEN 'manager' THEN 0 WHEN 'gerant' THEN 1 ELSE 2 END,
         u.full_name`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la récupération de l'équipe." });
  }
});

// POST /users — créer un membre de l'équipe (manager uniquement)
router.post('/', requireRole('manager'), async (req, res) => {
  const { fullName, email, password, warehouseId } = req.body;

  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'Champs requis manquants.' });
  }
  const lecture = lireRoles(req.body);
  if (lecture.erreur) return res.status(lecture.code).json({ error: lecture.erreur });
  const { roles } = lecture;
  const role = rolePrincipal(roles);

  // Les rôles qui travaillent dans un lieu exigent une boutique ; un comptable seul peut s'en passer.
  if (aBesoinDUnLieu(roles) && !warehouseId) {
    return res.status(400).json({ error: 'La boutique est requise pour ce rôle.' });
  }

  try {
    if (warehouseId) {
      const boutique = await pool.query(
        `SELECT id, type FROM warehouses WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
        [warehouseId, req.user.merchantId]
      );
      if (boutique.rows.length === 0) {
        return res.status(404).json({ error: 'Boutique introuvable.' });
      }
      if (boutique.rows[0].type === 'depot' && aRoleDeVente(roles)) {
        return res.status(400).json({ error: MSG_DEPOT_RESERVE });
      }
    }

    // Plafond de comptes fixé par le propriétaire de la plateforme
    // (merchants.max_team_members) : impossible à dépasser depuis cette
    // route, seule la page d'administration du propriétaire peut l'augmenter.
    const { rows: merchantRows } = await pool.query(
      'SELECT max_team_members FROM merchants WHERE id = $1',
      [req.user.merchantId]
    );
    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*)::int AS total FROM users WHERE merchant_id = $1',
      [req.user.merchantId]
    );
    const plafond = merchantRows[0]?.max_team_members ?? 3;
    if (countRows[0].total >= plafond) {
      return res.status(403).json({
        error: `Limite de ${plafond} comptes atteinte pour votre commerce. Contactez le propriétaire de la plateforme pour l'augmenter.`,
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (merchant_id, full_name, email, password_hash, role, roles, warehouse_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, full_name, email, role, roles, is_active, created_at, warehouse_id`,
      [req.user.merchantId, fullName, email, passwordHash, role, roles, warehouseId || null]
    );

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'team_member_created',
      description: `a ajouté ${fullName} à l'équipe (${roles.join(', ')})`,
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la création du membre de l'équipe." });
  }
});

// PATCH /users/:id/status — activer/désactiver un membre (manager uniquement)
router.patch('/:id/status', requireRole('manager'), async (req, res) => {
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'isActive doit être un booléen.' });
  }
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre compte ici.' });
  }

  try {
    const result = await pool.query(
      `UPDATE users SET is_active = $1
       WHERE id = $2 AND merchant_id = $3 AND role != 'manager'
       RETURNING id, full_name, role, is_active`,
      [isActive, req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Membre introuvable.' });
    }

    // Paie : la fiche employé liée suit le compte (archivée à la désactivation, réactivée ensuite).
    // L'historique de paie n'est jamais touché.
    await pool.query(
      `UPDATE employees
       SET status = $1::text,
           archived_at = CASE WHEN $2::boolean THEN NULL ELSE COALESCE(archived_at, now()) END,
           updated_at = now()
       WHERE user_id = $3 AND merchant_id = $4`,
      [isActive ? 'actif' : 'archive', isActive, req.params.id, req.user.merchantId]
    );

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'team_member_status_changed',
      description: `a ${isActive ? 'réactivé' : 'désactivé'} ${result.rows[0].full_name}`,
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du membre.' });
  }
});

// PATCH /users/:id/permissions — manager choisit les modules visibles pour un
// gérant ou un vendeur. modules: null = accès complet par défaut du rôle.
const MODULES_VALIDES = ['stock', 'ventes', 'clients', 'fournisseurs', 'achats', 'caisse'];

router.patch('/:id/permissions', requireRole('manager'), async (req, res) => {
  const { modules } = req.body;

  if (modules !== null && (!Array.isArray(modules) || !modules.every((m) => MODULES_VALIDES.includes(m)))) {
    return res.status(400).json({ error: 'Liste de modules invalide.' });
  }

  try {
    const result = await pool.query(
      `UPDATE users SET visible_modules = $1
       WHERE id = $2 AND merchant_id = $3 AND role != 'manager'
       RETURNING id, full_name, role, visible_modules`,
      [modules, req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Membre introuvable.' });
    }

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'team_member_permissions_changed',
      description: `a modifié les permissions de ${result.rows[0].full_name}`,
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour des permissions.' });
  }
});

// PATCH /users/:id/warehouse — manager réassigne un membre à une autre
// boutique. Un gérant/caissier/vendeur doit toujours être assigné à une
// boutique active (jamais NULL).
router.patch('/:id/warehouse', requireRole('manager'), async (req, res) => {
  const { warehouseId } = req.body;
  if (!warehouseId) {
    return res.status(400).json({ error: 'La boutique est requise.' });
  }

  try {
    const boutique = await pool.query(
      `SELECT id, name, type FROM warehouses WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
      [warehouseId, req.user.merchantId]
    );
    if (boutique.rows.length === 0) {
      return res.status(404).json({ error: 'Boutique introuvable.' });
    }
    if (boutique.rows[0].type === 'depot') {
      const membre = await pool.query(
        `SELECT role, roles FROM users WHERE id = $1 AND merchant_id = $2 AND role != 'manager'`,
        [req.params.id, req.user.merchantId]
      );
      if (membre.rows[0] && aRoleDeVente(normaliserRoles(membre.rows[0].roles, membre.rows[0].role))) {
        return res.status(400).json({ error: MSG_DEPOT_RESERVE });
      }
    }

    const result = await pool.query(
      `UPDATE users SET warehouse_id = $1
       WHERE id = $2 AND merchant_id = $3 AND role != 'manager'
       RETURNING id, full_name, role, warehouse_id`,
      [warehouseId, req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Membre introuvable.' });
    }

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'team_member_warehouse_changed',
      description: `a assigné ${result.rows[0].full_name} ${boutique.rows[0].type === 'depot' ? 'au dépôt' : 'à la boutique'} ${boutique.rows[0].name}`,
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors du changement de boutique." });
  }
});

// PATCH /users/:id/password — le manager réinitialise le mot de passe d'un
// membre de l'équipe (cas d'un employé qui a oublié le sien). Le manager ne
// peut pas réinitialiser son propre mot de passe ici, ni celui d'un autre
// manager.
router.patch('/:id/password', requireRole('manager'), async (req, res) => {
  const { newPassword } = req.body;

  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
  }
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Vous ne pouvez pas réinitialiser votre propre mot de passe ici.' });
  }

  try {
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const result = await pool.query(
      `UPDATE users SET password_hash = $1
       WHERE id = $2 AND merchant_id = $3 AND role != 'manager'
       RETURNING id, full_name, role`,
      [passwordHash, req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Membre introuvable.' });
    }

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'team_member_password_reset',
      description: `a réinitialisé le mot de passe de ${result.rows[0].full_name}`,
    });

    res.json({ ...result.rows[0], message: 'Mot de passe réinitialisé avec succès.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la réinitialisation du mot de passe.' });
  }
});

// PATCH /users/:id/role — manager change les rôles d'un membre : { roles: ['vendeur', 'caissier'] }
// (l'ancien format { role } reste accepté). Réinitialise les permissions personnalisées
// (visible_modules) car les modules par défaut des nouveaux rôles ne correspondent plus forcément
// à l'ancienne sélection.
router.patch('/:id/role', requireRole('manager'), async (req, res) => {
  const lecture = lireRoles(req.body);
  if (lecture.erreur) return res.status(lecture.code).json({ error: lecture.erreur });
  const { roles } = lecture;

  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre rôle ici.' });
  }

  try {
    const membre = await pool.query(
      `SELECT u.warehouse_id, w.type AS lieu_type
       FROM users u LEFT JOIN warehouses w ON w.id = u.warehouse_id
       WHERE u.id = $1 AND u.merchant_id = $2 AND u.role != 'manager'`,
      [req.params.id, req.user.merchantId]
    );
    if (membre.rows.length === 0) {
      return res.status(404).json({ error: 'Membre introuvable.' });
    }
    // Un membre affecté à un dépôt ne peut pas avoir de rôle de vente.
    if (aRoleDeVente(roles) && membre.rows[0].lieu_type === 'depot') {
      return res.status(400).json({ error: "Ce membre est affecté à un dépôt (stockage uniquement) : affectez-le d'abord à une boutique pour lui donner un rôle de vente." });
    }
    if (aBesoinDUnLieu(roles) && !membre.rows[0].warehouse_id) {
      return res.status(400).json({ error: "Ce membre n'est affecté à aucune boutique : affectez-le d'abord à une boutique pour lui donner ce rôle." });
    }

    const result = await pool.query(
      `UPDATE users SET role = $1, roles = $2, visible_modules = NULL
       WHERE id = $3 AND merchant_id = $4 AND role != 'manager'
       RETURNING id, full_name, role, roles, visible_modules`,
      [rolePrincipal(roles), roles, req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Membre introuvable.' });
    }

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'team_member_role_changed',
      description: `a changé les rôles de ${result.rows[0].full_name} : ${roles.join(', ')}`,
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du changement de rôle.' });
  }
});

// DELETE /users/:id — manager supprime définitivement un membre de l'équipe.
// Si ce membre a un historique lié (ventes, mouvements de stock, clôtures de
// caisse…), la contrainte de clé étrangère bloque la suppression : on
// renvoie alors un message invitant à désactiver le compte à la place,
// plutôt que de casser l'historique.
router.delete('/:id', requireRole('manager'), async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
  }

  try {
    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 AND merchant_id = $2 AND role != 'manager' RETURNING id, full_name`,
      [req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Membre introuvable.' });
    }

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'team_member_deleted',
      description: `a supprimé ${result.rows[0].full_name} de l'équipe`,
    });

    res.json({ message: 'Membre supprimé avec succès.' });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({
        error: "Ce membre a un historique lié (ventes, mouvements de stock, clôtures de caisse…) et ne peut pas être supprimé. Désactivez-le plutôt.",
      });
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la suppression du membre.' });
  }
});

module.exports = router;
