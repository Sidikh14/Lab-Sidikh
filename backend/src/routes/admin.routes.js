const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');
const { addLot } = require('../utils/lots');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Champs additionnels par secteur pour le modèle d'import Excel — à garder
// synchronisé manuellement avec `champsProduitSup` dans sectorConfig.js
// (frontend, en ES modules, non importable tel quel depuis ce backend
// CommonJS).
const CHAMPS_SUP_PAR_SECTEUR = {
  grossiste: [],
  pharmacie: [],
  electromenager: [
    { key: 'garantieMois', label: 'Garantie (mois)', type: 'number' },
    { key: 'numeroSerie', label: 'Numéro de série', type: 'text' },
  ],
  textile: [
    { key: 'couleur', label: 'Couleur', type: 'text' },
    { key: 'metrage', label: 'Métrage (m)', type: 'number' },
  ],
};

// Colonnes du modèle Excel pour un secteur donné — sert à la fois à générer
// le modèle et à parser le fichier importé (mêmes libellés des deux côtés).
function buildColumnsForSector(sector) {
  const champsSup = CHAMPS_SUP_PAR_SECTEUR[sector] || [];
  const colonnes = [
    { key: 'name', label: 'Nom' },
    { key: 'sku', label: 'SKU / Référence' },
    { key: 'category', label: 'Catégorie' },
    { key: 'costPrice', label: "Prix d'achat (FCFA)" },
    { key: 'unitPrice', label: 'Prix de vente (FCFA)' },
    { key: 'quantityInStock', label: 'Quantité initiale' },
    { key: 'quantityAlertThreshold', label: "Seuil d'alerte" },
    { key: 'tvaApplicable', label: 'TVA applicable (Oui/Non)' },
  ];
  if (sector !== 'pharmacie' && sector !== 'electromenager') {
    colonnes.push({ key: 'isWeighted', label: 'Vendu au poids (Oui/Non)' });
  }
  if (sector === 'pharmacie') {
    colonnes.push({ key: 'lotNumber', label: 'N° de lot (si quantité initiale > 0)' });
    colonnes.push({ key: 'expiryDate', label: 'Date de péremption JJ/MM/AAAA (si quantité initiale > 0)' });
  }
  for (const champ of champsSup) {
    colonnes.push({ key: `attr:${champ.key}`, label: champ.label });
  }
  return colonnes;
}

const router = express.Router();
router.use(authenticate);
router.use(requireRole('owner'));

// GET /admin/merchants — liste de tous les commerçants de la plateforme,
// avec le nombre de comptes actuels vs le plafond autorisé.
router.get('/merchants', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.id, m.business_name, m.sector, m.email, m.is_active,
              m.max_team_members, m.max_warehouses, m.created_at,
              (SELECT COUNT(*)::int FROM users u WHERE u.merchant_id = m.id) AS member_count,
              (SELECT COUNT(*)::int FROM warehouses w WHERE w.merchant_id = m.id) AS warehouse_count
       FROM merchants m
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

// PATCH /admin/merchants/:id/warehouse-limit — ajuster le nombre de
// boutiques que ce commerçant est autorisé à créer (vérifié côté
// /warehouses lors de la création d'une boutique par le manager).
router.patch('/merchants/:id/warehouse-limit', async (req, res) => {
  const { maxWarehouses } = req.body;
  if (!Number.isInteger(maxWarehouses) || maxWarehouses < 1) {
    return res.status(400).json({ error: 'maxWarehouses doit être un entier positif.' });
  }
  try {
    const result = await pool.query(
      `UPDATE merchants SET max_warehouses = $1 WHERE id = $2 RETURNING id, business_name, max_warehouses`,
      [maxWarehouses, req.params.id]
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

// GET /admin/merchants/:id/warehouses — boutiques de ce commerçant, pour
// choisir où loger le stock initial des produits importés.
router.get('/merchants/:id/warehouses', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, is_active FROM warehouses WHERE merchant_id = $1 ORDER BY name`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des boutiques.' });
  }
});

// GET /admin/merchants/:id/products-template — modèle Excel adapté au
// secteur de ce commerçant, avec un onglet listant ses catégories
// existantes (pour recopier le nom exact et éviter les doublons).
router.get('/merchants/:id/products-template', async (req, res) => {
  try {
    const merchantResult = await pool.query(
      `SELECT id, business_name, sector FROM merchants WHERE id = $1`,
      [req.params.id]
    );
    const merchant = merchantResult.rows[0];
    if (!merchant) return res.status(404).json({ error: 'Commerçant introuvable.' });

    const colonnes = buildColumnsForSector(merchant.sector);
    const categoriesResult = await pool.query(
      `SELECT name FROM categories WHERE merchant_id = $1 ORDER BY name`,
      [merchant.id]
    );

    const wb = XLSX.utils.book_new();
    const wsProduits = XLSX.utils.aoa_to_sheet([colonnes.map((c) => c.label)]);
    XLSX.utils.book_append_sheet(wb, wsProduits, 'Produits');

    if (categoriesResult.rows.length > 0) {
      const wsCategories = XLSX.utils.aoa_to_sheet([
        ['Catégories existantes (recopier le nom exact ci-dessus pour éviter les doublons)'],
        ...categoriesResult.rows.map((c) => [c.name]),
      ]);
      XLSX.utils.book_append_sheet(wb, wsCategories, 'Catégories');
    }

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const nomFichier = `modele-produits-${merchant.business_name.replace(/[^a-zA-Z0-9]+/g, '-')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nomFichier}"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la génération du modèle.' });
  }
});

// POST /admin/merchants/:id/products-import — import en masse depuis le
// fichier Excel généré ci-dessus. Traite chaque ligne dans sa propre petite
// transaction : une ligne en erreur n'annule pas les autres. SKU déjà
// existant chez ce commerçant => mise à jour des infos/prix (pas du stock/
// des lots, pour ne jamais toucher au stock réel en place) ; sinon création
// avec stock initial dans la boutique choisie.
router.post('/merchants/:id/products-import', upload.single('file'), async (req, res) => {
  const merchantId = req.params.id;
  const { warehouseId } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier reçu.' });
  }
  if (!warehouseId) {
    return res.status(400).json({ error: 'La boutique de destination est requise.' });
  }

  try {
    const merchantResult = await pool.query(`SELECT id, sector FROM merchants WHERE id = $1`, [merchantId]);
    const merchant = merchantResult.rows[0];
    if (!merchant) return res.status(404).json({ error: 'Commerçant introuvable.' });

    const warehouseResult = await pool.query(
      `SELECT id FROM warehouses WHERE id = $1 AND merchant_id = $2`,
      [warehouseId, merchantId]
    );
    if (warehouseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Boutique introuvable pour ce commerçant.' });
    }

    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    } catch {
      return res.status(400).json({ error: "Fichier illisible — vérifiez que c'est bien un fichier Excel (.xlsx)." });
    }
    const feuille = workbook.Sheets[workbook.SheetNames[0]];
    const lignesBrutes = XLSX.utils.sheet_to_json(feuille, { defval: '' });
    if (lignesBrutes.length === 0) {
      return res.status(400).json({ error: 'Le fichier ne contient aucune ligne de produit.' });
    }

    const colonnes = buildColumnsForSector(merchant.sector);
    const labelToKey = new Map(colonnes.map((c) => [c.label, c.key]));

    const categoriesResult = await pool.query(`SELECT id, name FROM categories WHERE merchant_id = $1`, [merchantId]);
    const categoriesParNom = new Map(categoriesResult.rows.map((c) => [c.name.trim().toLowerCase(), c.id]));

    let created = 0;
    let updated = 0;
    const erreurs = [];

    for (let i = 0; i < lignesBrutes.length; i++) {
      const numeroLigne = i + 2; // ligne 1 = en-têtes
      const ligneBrute = lignesBrutes[i];
      const ligne = {};
      for (const [label, valeur] of Object.entries(ligneBrute)) {
        const key = labelToKey.get(label);
        if (key) ligne[key] = valeur;
      }

      const client = await pool.connect();
      try {
        const name = String(ligne.name || '').trim();
        if (!name) throw new Error('Le nom du produit est requis.');

        const unitPrice = Number(ligne.unitPrice) || 0;
        if (unitPrice <= 0) throw new Error('Le prix de vente est requis et doit être positif.');

        const costPrice = Number(ligne.costPrice) || 0;
        const sku = String(ligne.sku || '').trim() || null;
        const quantityInStock = Math.max(0, Number(ligne.quantityInStock) || 0);
        const quantityAlertThreshold = Number(ligne.quantityAlertThreshold) || 5;
        const tvaApplicable = String(ligne.tvaApplicable || '').trim().toLowerCase() !== 'non';
        const isWeighted = String(ligne.isWeighted || '').trim().toLowerCase() === 'oui';

        let categoryId = null;
        const categoryName = String(ligne.category || '').trim();
        if (categoryName) {
          const cle = categoryName.toLowerCase();
          if (categoriesParNom.has(cle)) {
            categoryId = categoriesParNom.get(cle);
          } else {
            const nouvelleCategorie = await client.query(
              `INSERT INTO categories (merchant_id, name) VALUES ($1, $2) RETURNING id`,
              [merchantId, categoryName]
            );
            categoryId = nouvelleCategorie.rows[0].id;
            categoriesParNom.set(cle, categoryId);
          }
        }

        const attributes = {};
        for (const champ of colonnes) {
          if (champ.key.startsWith('attr:') && ligne[champ.key] !== undefined && ligne[champ.key] !== '') {
            attributes[champ.key.slice(5)] = ligne[champ.key];
          }
        }

        await client.query('BEGIN');

        if (sku) {
          const existant = await client.query(
            `SELECT id FROM products WHERE merchant_id = $1 AND sku = $2`,
            [merchantId, sku]
          );
          if (existant.rows.length > 0) {
            await client.query(
              `UPDATE products SET
                 name = $1,
                 category_id = COALESCE($2, category_id),
                 unit_price = $3,
                 cost_price = $4,
                 quantity_alert_threshold = $5,
                 tva_applicable = $6,
                 attributes = attributes || $7::jsonb
               WHERE id = $8`,
              [name, categoryId, unitPrice, costPrice, quantityAlertThreshold, tvaApplicable, JSON.stringify(attributes), existant.rows[0].id]
            );
            await client.query('COMMIT');
            updated++;
            continue;
          }
        }

        const isActivated = merchant.sector === 'pharmacie' ? quantityInStock > 0 : true;

        const produitResult = await client.query(
          `INSERT INTO products (merchant_id, category_id, name, sku, unit_price, cost_price, quantity_alert_threshold, is_weighted, tva_applicable, attributes, is_activated)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id`,
          [merchantId, categoryId, name, sku, unitPrice, costPrice, quantityAlertThreshold, isWeighted, tvaApplicable, JSON.stringify(attributes), isActivated]
        );
        const productId = produitResult.rows[0].id;

        await client.query(
          `INSERT INTO product_stock (merchant_id, product_id, warehouse_id, quantity_in_stock) VALUES ($1, $2, $3, $4)`,
          [merchantId, productId, warehouseId, quantityInStock]
        );

        if (merchant.sector === 'pharmacie' && quantityInStock > 0) {
          let expiryDate = null;
          if (ligne.expiryDate) {
            if (ligne.expiryDate instanceof Date) {
              expiryDate = ligne.expiryDate.toISOString().slice(0, 10);
            } else {
              const parties = String(ligne.expiryDate).trim().split(/[\/\-]/);
              if (parties.length === 3) {
                const [jour, mois, anneeBrute] = parties;
                const annee = anneeBrute.length === 2 ? `20${anneeBrute}` : anneeBrute;
                expiryDate = `${annee}-${mois.padStart(2, '0')}-${jour.padStart(2, '0')}`;
              }
            }
          }
          await addLot(client, {
            merchantId,
            productId,
            warehouseId,
            lotNumber: String(ligne.lotNumber || '').trim() || null,
            expiryDate,
            quantity: quantityInStock,
          });
        }

        await client.query('COMMIT');
        created++;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        erreurs.push({ ligne: numeroLigne, message: err.message });
      } finally {
        client.release();
      }
    }

    await logActivity({
      merchantId,
      userId: req.user.id,
      action: 'products_bulk_import',
      description: `le propriétaire de la plateforme a importé des produits depuis Excel (${created} créé(s), ${updated} mis à jour, ${erreurs.length} erreur(s))`,
    });

    res.json({ created, updated, errors: erreurs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'import du fichier." });
  }
});

module.exports = router;
