const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { COULEURS, formatMontant, dessinerEntete } = require('../utils/pdfHelpers');

const router = express.Router();
router.use(authenticate);

// Manager et gérant voient l'activité de toute l'équipe ; les autres rôles
// (vendeur, caissier) ne voient que leurs propres actions.
function estLimiteAuxSiennes(role) {
  return !['manager', 'gerant'].includes(role);
}

async function recupererActivite(req, dateDebut, dateFin) {
  const limiteUtilisateur = estLimiteAuxSiennes(req.user.role);
  const limiteBoutique = req.user.role === 'gerant';

  const params = [req.user.merchantId, dateDebut, dateFin];
  let paramIndex = 3;
  if (limiteUtilisateur) {
    params.push(req.user.id);
    paramIndex = params.length;
  } else if (limiteBoutique) {
    params.push(req.user.warehouseId);
    paramIndex = params.length;
  }

  const filtreUtilisateur = (colonne) => (limiteUtilisateur ? `AND ${colonne} = $${paramIndex}` : '');
  const filtreBoutique = (colonne) => (limiteBoutique ? `AND ${colonne} = $${paramIndex}` : '');

  const ordersResult = await pool.query(
    `SELECT o.id, 'vente' AS type, o.total_amount AS montant, o.created_at,
            u.full_name AS user_name, c.full_name AS client_name
     FROM orders o
     LEFT JOIN users u ON u.id = o.created_by
     LEFT JOIN clients c ON c.id = o.client_id
     WHERE o.merchant_id = $1 AND o.created_at >= $2 AND o.created_at < $3
     ${filtreUtilisateur('o.created_by')}${filtreBoutique('o.warehouse_id')}
     ORDER BY o.created_at DESC LIMIT 300`,
    params
  );

  const encaissementsResult = await pool.query(
    `SELECT o.id, 'encaissement' AS type, o.total_amount AS montant, o.payment_method, o.validated_at AS created_at,
            u.full_name AS user_name, c.full_name AS client_name
     FROM orders o
     LEFT JOIN users u ON u.id = o.validated_by
     LEFT JOIN clients c ON c.id = o.client_id
     WHERE o.merchant_id = $1 AND o.validated_at >= $2 AND o.validated_at < $3
     ${filtreUtilisateur('o.validated_by')}${filtreBoutique('o.warehouse_id')}
     ORDER BY o.validated_at DESC LIMIT 300`,
    params
  );

  const livraisonsResult = await pool.query(
    `SELECT o.id, 'livraison' AS type, o.total_amount AS montant, o.delivered_at AS created_at,
            u.full_name AS user_name, c.full_name AS client_name
     FROM orders o
     LEFT JOIN users u ON u.id = o.delivered_by
     LEFT JOIN clients c ON c.id = o.client_id
     WHERE o.merchant_id = $1 AND o.delivered_at >= $2 AND o.delivered_at < $3
     ${filtreUtilisateur('o.delivered_by')}${filtreBoutique('o.warehouse_id')}
     ORDER BY o.delivered_at DESC LIMIT 300`,
    params
  );

  const stockResult = await pool.query(
    `SELECT sm.id, 'stock' AS type, sm.movement_type, sm.quantity, sm.created_at,
            u.full_name AS user_name, p.name AS product_name, s.name AS supplier_name
     FROM stock_movements sm
     LEFT JOIN users u ON u.id = sm.user_id
     LEFT JOIN products p ON p.id = sm.product_id
     LEFT JOIN suppliers s ON s.id = sm.supplier_id
     WHERE sm.merchant_id = $1 AND sm.created_at >= $2 AND sm.created_at < $3
     ${filtreUtilisateur('sm.user_id')}${filtreBoutique('sm.warehouse_id')}
     ORDER BY sm.created_at DESC LIMIT 300`,
    params
  );

  const journalResult = await pool.query(
    `SELECT al.id, 'journal' AS type, al.description, al.created_at, u.full_name AS user_name
     FROM activity_log al
     LEFT JOIN users u ON u.id = al.user_id
     WHERE al.merchant_id = $1 AND al.created_at >= $2 AND al.created_at < $3
     ${filtreUtilisateur('al.user_id')}
     ORDER BY al.created_at DESC LIMIT 300`,
    params
  );

  return [
    ...ordersResult.rows,
    ...encaissementsResult.rows,
    ...livraisonsResult.rows,
    ...stockResult.rows,
    ...journalResult.rows,
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// GET /activity/revenue — chiffre d'affaires total et par mois (manager
// uniquement — le gérant n'y a pas accès). Basé sur les commandes
// encaissées (validated_at renseigné), pas sur les commandes simplement
// créées : une vente annulée ou pas encore payée ne compte pas dans le
// chiffre d'affaires.
router.get('/revenue', requireRole('manager'), async (req, res) => {
  try {
    const totalResult = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) AS total
       FROM orders
       WHERE merchant_id = $1 AND validated_at IS NOT NULL`,
      [req.user.merchantId]
    );

    const parMoisResult = await pool.query(
      `SELECT to_char(date_trunc('month', validated_at), 'YYYY-MM') AS month,
              COALESCE(SUM(total_amount), 0) AS total
       FROM orders
       WHERE merchant_id = $1 AND validated_at IS NOT NULL
       GROUP BY 1
       ORDER BY 1 DESC`,
      [req.user.merchantId]
    );

    res.json({
      total: Number(totalResult.rows[0].total),
      byMonth: parMoisResult.rows.map((r) => ({ month: r.month, total: Number(r.total) })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors du calcul du chiffre d'affaires." });
  }
});

// GET /activity/revenue-by-warehouse — ventes encaissées groupées par
// boutique. Contrairement à /revenue (chiffre d'affaires global, manager
// uniquement), cette route est ouverte au gérant, mais SEULEMENT pour sa
// propre boutique (req.user.warehouseId) — jamais les autres. Le manager,
// lui, voit toutes les boutiques du commerçant.
router.get('/revenue-by-warehouse', requireRole('manager', 'gerant'), async (req, res) => {
  try {
    const limiteBoutique = req.user.role !== 'manager';
    if (limiteBoutique && !req.user.warehouseId) {
      return res.status(403).json({ error: "Vous n'êtes assigné à aucune boutique." });
    }

    const params = limiteBoutique ? [req.user.merchantId, req.user.warehouseId] : [req.user.merchantId];
    const result = await pool.query(
      `SELECT w.id AS warehouse_id, w.name AS warehouse_name,
              COALESCE(SUM(o.total_amount), 0) AS total
       FROM warehouses w
       LEFT JOIN orders o
         ON o.warehouse_id = w.id AND o.validated_at IS NOT NULL
       WHERE w.merchant_id = $1${limiteBoutique ? ' AND w.id = $2' : ''}
       GROUP BY w.id, w.name
       ORDER BY w.name`,
      params
    );

    res.json(result.rows.map((r) => ({
      warehouseId: r.warehouse_id,
      warehouseName: r.warehouse_name,
      total: Number(r.total),
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du calcul des ventes par boutique.' });
  }
});

// GET /activity/today — utilisé par le tableau de bord (Pilotage)
router.get('/today', async (req, res) => {
  try {
    const debut = new Date();
    debut.setHours(0, 0, 0, 0);
    const fin = new Date(debut);
    fin.setDate(fin.getDate() + 1);

    const activite = await recupererActivite(req, debut.toISOString(), fin.toISOString());
    res.json(activite.slice(0, 30));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la récupération de l'activité." });
  }
});

// GET /activity/range?from=2026-01-01&to=2026-01-15
router.get('/range', async (req, res) => {
  const { from, to } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: 'Les dates "from" et "to" sont requises (AAAA-MM-JJ).' });
  }

  try {
    const debut = new Date(`${from}T00:00:00`);
    const fin = new Date(`${to}T00:00:00`);
    fin.setDate(fin.getDate() + 1);

    if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime())) {
      return res.status(400).json({ error: 'Format de date invalide.' });
    }

    const activite = await recupererActivite(req, debut.toISOString(), fin.toISOString());
    res.json(activite);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la récupération de l'activité." });
  }
});

const LABEL_MOUVEMENT = { entree: 'ajouté', sortie: 'sorti', ajustement: 'ajusté' };
const LABEL_PAIEMENT = { especes: 'Espèces', wave: 'Wave', orange_money: 'Orange Money', cheque: 'Chèque', virement: 'Virement' };

function texteActivite(a) {
  if (a.type === 'vente') return `a créé une vente de ${formatMontant(a.montant)} FCFA`;
  if (a.type === 'encaissement') {
    const moyen = LABEL_PAIEMENT[a.payment_method] || a.payment_method || 'moyen non précisé';
    return `a encaissé ${formatMontant(a.montant)} FCFA (${moyen})`;
  }
  if (a.type === 'livraison') return `a livré la commande${a.client_name ? ` de ${a.client_name}` : ''}`;
  if (a.type === 'journal') return a.description;
  const verbe = LABEL_MOUVEMENT[a.movement_type] || a.movement_type;
  return `a ${verbe} ${a.quantity} × ${a.product_name}${a.supplier_name ? ` (fournisseur : ${a.supplier_name})` : ''}`;
}

// GET /activity/pdf?from=&to=
router.get('/pdf', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'Les dates "from" et "to" sont requises.' });
  }

  try {
    const merchantResult = await pool.query(`SELECT business_name FROM merchants WHERE id = $1`, [req.user.merchantId]);
    const businessName = merchantResult.rows[0]?.business_name || 'Commerce';

    const debut = new Date(`${from}T00:00:00`);
    const fin = new Date(`${to}T00:00:00`);
    fin.setDate(fin.getDate() + 1);

    const activite = await recupererActivite(req, debut.toISOString(), fin.toISOString());

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="journal-activite-${from}-${to}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    let y = dessinerEntete(doc, {
      businessName,
      titre: "Journal d'activité",
      sousTitre: `Du ${new Date(from).toLocaleDateString('fr-FR')} au ${new Date(to).toLocaleDateString('fr-FR')} · ${activite.length} événement(s)`,
    });
    y += 10;

    activite.forEach((a, index) => {
      if (y > 760) {
        doc.addPage();
        y = 50;
      }
      if (index % 2 === 1) {
        doc.rect(50, y, doc.page.width - 100, 22).fill(COULEURS.fondAlterne);
      }
      const date = new Date(a.created_at);
      doc.fillColor(COULEURS.muted).fontSize(8).font('Helvetica')
        .text(date.toLocaleDateString('fr-FR'), 56, y + 6, { width: 60 })
        .text(date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), 56, y + 6 + 9, { width: 60 });
      doc.fillColor(COULEURS.encre).fontSize(9);
      doc.font('Helvetica-Bold').text(a.user_name || 'Inconnu', 130, y + 6, { continued: true, width: 400 });
      doc.font('Helvetica').text(` ${texteActivite(a)}`, { width: 400 });
      y += 22;
    });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
  }
});

module.exports = router;
