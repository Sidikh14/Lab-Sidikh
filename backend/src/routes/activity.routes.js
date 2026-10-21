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

  // journalResult n'a pas de filtre boutique (voir remarque plus haut) : on
  // ne lui passe donc jamais le paramètre warehouseId, sinon Postgres
  // refuse un paramètre non référencé dans la requête (cas du gérant, qui
  // n'a que ce paramètre en 4e position, sans filtre utilisateur associé).
  const paramsJournal = limiteBoutique ? params.slice(0, 3) : params;
  const journalResult = await pool.query(
    `SELECT al.id, 'journal' AS type, al.description, al.created_at, u.full_name AS user_name
     FROM activity_log al
     LEFT JOIN users u ON u.id = al.user_id
     WHERE al.merchant_id = $1 AND al.created_at >= $2 AND al.created_at < $3
     ${filtreUtilisateur('al.user_id')}
     ORDER BY al.created_at DESC LIMIT 300`,
    paramsJournal
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

// GET /activity/profit — bénéfice brut total et par mois (manager uniquement,
// comme le chiffre d'affaires). Même base que /revenue (commandes encaissées).
// Bénéfice d'une commande = somme des lignes (prix de vente - coût d'achat
// figé au moment de la vente) - la réduction commerciale éventuelle. Pour les
// anciennes lignes sans coût figé (unit_cost null), on retombe sur le prix
// d'achat actuel du produit. Les frais de livraison et la TVA ne comptent pas.
router.get('/profit', requireRole('manager'), async (req, res) => {
  try {
    const parMoisResult = await pool.query(
      `WITH marge_commande AS (
         SELECT o.id, o.validated_at, COALESCE(o.discount_amount, 0) AS remise,
                COALESCE(SUM(oi.line_total - oi.quantity * COALESCE(oi.unit_cost, p.cost_price, 0)), 0) AS marge_brute
         FROM orders o
         LEFT JOIN order_items oi ON oi.order_id = o.id
         LEFT JOIN products p ON p.id = oi.product_id
         WHERE o.merchant_id = $1 AND o.validated_at IS NOT NULL
         GROUP BY o.id
       )
       SELECT to_char(date_trunc('month', validated_at), 'YYYY-MM') AS month,
              COALESCE(SUM(marge_brute - remise), 0) AS total
       FROM marge_commande
       GROUP BY 1
       ORDER BY 1 DESC`,
      [req.user.merchantId]
    );

    // Lignes vendues sans prix d'achat renseigné : leur marge est surestimée
    // (coût compté à 0), on le signale au tableau de bord.
    const sansCoutResult = await pool.query(
      `SELECT COUNT(*) AS n
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE o.merchant_id = $1 AND o.validated_at IS NOT NULL
         AND COALESCE(oi.unit_cost, p.cost_price, 0) = 0`,
      [req.user.merchantId]
    );

    const byMonth = parMoisResult.rows.map((r) => ({ month: r.month, total: Number(r.total) }));
    res.json({
      total: byMonth.reduce((somme, m) => somme + m.total, 0),
      byMonth,
      itemsSansCout: Number(sansCoutResult.rows[0].n),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du calcul du bénéfice.' });
  }
});

// GET /activity/result?from=AAAA-MM-JJ&to=AAAA-MM-JJ[&warehouseId=] — onglet
// « Résultat » du tableau de bord (manager uniquement). Même base que /revenue
// et /profit (commandes encaissées, validated_at renseigné), mais sur une période
// choisie et, si warehouseId est fourni, pour une seule boutique.
// L'« annulé » = commandes au statut annulee, classées selon leur date de création.
router.get('/result', requireRole('manager'), async (req, res) => {
  const { from, to, warehouseId } = req.query;
  const formatDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!formatDate.test(from || '') || !formatDate.test(to || '')) {
    return res.status(400).json({ error: 'Les dates "from" et "to" sont requises (AAAA-MM-JJ).' });
  }
  if (from > to) {
    return res.status(400).json({ error: 'La date de début doit précéder la date de fin.' });
  }
  const formatUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (warehouseId && !formatUuid.test(warehouseId)) {
    return res.status(400).json({ error: 'Boutique invalide.' });
  }

  try {
    const params = [req.user.merchantId, from, to];
    let filtreBoutique = '';
    if (warehouseId) {
      params.push(warehouseId);
      filtreBoutique = ' AND o.warehouse_id = $4';
    }

    const ventesResult = await pool.query(
      `SELECT to_char(date_trunc('month', o.validated_at), 'YYYY-MM') AS month,
              COALESCE(SUM(o.total_amount), 0) AS total, COUNT(*) AS n
       FROM orders o
       WHERE o.merchant_id = $1 AND o.validated_at IS NOT NULL
         AND o.validated_at >= $2::date AND o.validated_at < ($3::date + 1)${filtreBoutique}
       GROUP BY 1`,
      params
    );

    const beneficeResult = await pool.query(
      `WITH marge_commande AS (
         SELECT o.id, o.validated_at, COALESCE(o.discount_amount, 0) AS remise,
                COALESCE(SUM(oi.line_total - oi.quantity * COALESCE(oi.unit_cost, p.cost_price, 0)), 0) AS marge_brute
         FROM orders o
         LEFT JOIN order_items oi ON oi.order_id = o.id
         LEFT JOIN products p ON p.id = oi.product_id
         WHERE o.merchant_id = $1 AND o.validated_at IS NOT NULL
           AND o.validated_at >= $2::date AND o.validated_at < ($3::date + 1)${filtreBoutique}
         GROUP BY o.id
       )
       SELECT to_char(date_trunc('month', validated_at), 'YYYY-MM') AS month,
              COALESCE(SUM(marge_brute - remise), 0) AS total
       FROM marge_commande
       GROUP BY 1`,
      params
    );

    const annuleResult = await pool.query(
      `SELECT to_char(date_trunc('month', o.created_at), 'YYYY-MM') AS month,
              COALESCE(SUM(o.total_amount), 0) AS total, COUNT(*) AS n
       FROM orders o
       WHERE o.merchant_id = $1 AND o.status = 'annulee'
         AND o.created_at >= $2::date AND o.created_at < ($3::date + 1)${filtreBoutique}
       GROUP BY 1`,
      params
    );

    const sansCoutResult = await pool.query(
      `SELECT COUNT(*) AS n
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE o.merchant_id = $1 AND o.validated_at IS NOT NULL
         AND o.validated_at >= $2::date AND o.validated_at < ($3::date + 1)${filtreBoutique}
         AND COALESCE(oi.unit_cost, p.cost_price, 0) = 0`,
      params
    );

    const parMois = {};
    const ligne = (mois) => {
      if (!parMois[mois]) parMois[mois] = { month: mois, revenue: 0, ordersCount: 0, profit: 0, cancelled: 0, cancelledCount: 0 };
      return parMois[mois];
    };
    ventesResult.rows.forEach((r) => { const l = ligne(r.month); l.revenue = Number(r.total); l.ordersCount = Number(r.n); });
    beneficeResult.rows.forEach((r) => { ligne(r.month).profit = Number(r.total); });
    annuleResult.rows.forEach((r) => { const l = ligne(r.month); l.cancelled = Number(r.total); l.cancelledCount = Number(r.n); });

    const byMonth = Object.values(parMois).sort((a, b) => a.month.localeCompare(b.month));
    const somme = (cle) => byMonth.reduce((t, m) => t + m[cle], 0);

    res.json({
      from,
      to,
      revenue: somme('revenue'),
      ordersCount: somme('ordersCount'),
      profit: somme('profit'),
      cancelled: somme('cancelled'),
      cancelledCount: somme('cancelledCount'),
      itemsSansCout: Number(sansCoutResult.rows[0].n),
      byMonth,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du calcul du résultat.' });
  }
});

// GET /activity/charges?from=AAAA-MM-JJ&to=AAAA-MM-JJ[&warehouseId=] — sous-onglet
// « Charges » de l'onglet Résultat (manager uniquement). Comptées :
//  - les sorties de caisse (avec une nature de charge, ou sans) ;
//  - les salaires payés (salary_payments, net versé) — leurs sorties de caisse
//    « Salaire… » sont ignorées pour ne pas les compter deux fois.
// Ignorées (ce ne sont pas des charges) : avances sur salaire, remboursements de
// retours, transferts entre boutiques, paiements à l'État, règlements de factures,
// acquisitions, cessions et financements.
// Montant d'une charge = montant sorti + retenue BRS − TVA déductible (hors taxe).
const NATURES_CHARGES_RESULTAT = {
  '622': 'Loyer', '605': 'Électricité / Eau', '628': 'Téléphone et Internet', '625': 'Assurance',
  '632': 'Honoraires / Comptabilité', '624': 'Entretien et réparations', '612': 'Livraison',
  '618': 'Transport', '631': 'Frais bancaires', '627': 'Publicité', '641': 'Impôts et taxes', '658': 'Autre charge',
};
const REGLES_NATURE_RESULTAT = [
  [/loyer/, '622'],
  [/electricite|courant|senelec|seneau|sen eau|\beau\b/, '605'],
  [/wifi|internet|telephone|forfait|sonatel/, '628'],
  [/assurance/, '625'],
  [/comptab|cabinet|honorair|avocat|conseil|notaire/, '632'],
  [/menuisi|reparation|entretien|maintenance|plomb|electricien|peinture|nettoyage/, '624'],
  [/livraison/, '612'],
  [/transport|taxi|carburant|essence|gasoil/, '618'],
  [/banque|bancaire|agios/, '631'],
  [/publicite|affiche|flyer|promotion/, '627'],
  [/impot|taxe|patente|dgid/, '641'],
];
const MOTIFS_NON_CHARGES = ['Paiement État — ', 'Règlement facture — ', 'Acquisition — ', 'Cession — ', 'Financement — '];

router.get('/charges', requireRole('manager'), async (req, res) => {
  const { from, to, warehouseId } = req.query;
  const formatDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!formatDate.test(from || '') || !formatDate.test(to || '')) {
    return res.status(400).json({ error: 'Les dates "from" et "to" sont requises (AAAA-MM-JJ).' });
  }
  if (from > to) {
    return res.status(400).json({ error: 'La date de début doit précéder la date de fin.' });
  }
  const formatUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (warehouseId && !formatUuid.test(warehouseId)) {
    return res.status(400).json({ error: 'Boutique invalide.' });
  }

  try {
    const params = [req.user.merchantId, from, to];
    let filtreCaisse = '';
    let filtreSalaire = '';
    if (warehouseId) {
      params.push(warehouseId);
      filtreCaisse = ' AND ce.warehouse_id = $4';
      filtreSalaire = ' AND u.warehouse_id = $4';
    }

    const caisseResult = await pool.query(
      `SELECT to_char(ce.expense_date, 'YYYY-MM') AS month, ce.amount, COALESCE(ce.reason, '') AS reason,
              ce.charge_account, COALESCE(ce.tva_amount, 0) AS tva, COALESCE(ce.brs_retenue, 0) AS retenue
       FROM cash_expenses ce
       WHERE ce.merchant_id = $1 AND ce.movement_type = 'sortie' AND COALESCE(ce.amount, 0) > 0
         AND ce.expense_date >= $2::date AND ce.expense_date <= $3::date${filtreCaisse}`,
      params
    );

    const salairesResult = await pool.query(
      `SELECT to_char(sp.paid_at, 'YYYY-MM') AS month, COALESCE(SUM(sp.amount), 0) AS total, COUNT(*) AS n
       FROM salary_payments sp
       JOIN users u ON u.id = sp.user_id
       WHERE u.merchant_id = $1 AND sp.paid_at >= $2::date AND sp.paid_at < ($3::date + 1)${filtreSalaire}
       GROUP BY 1`,
      params
    );

    const parMois = {};
    const parNature = {};
    const ajouter = (mois, cle, label, montant, nombre) => {
      if (!parMois[mois]) parMois[mois] = { month: mois, total: 0 };
      parMois[mois].total += montant;
      if (!parNature[cle]) parNature[cle] = { code: cle, label, total: 0, count: 0 };
      parNature[cle].total += montant;
      parNature[cle].count += nombre;
    };

    for (const row of caisseResult.rows) {
      const motif = (row.reason || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (/^(salaire|avance sur salaire|remboursement retour|transfert vers)/.test(motif)) continue;
      if (MOTIFS_NON_CHARGES.some((m) => row.reason.startsWith(m))) continue;

      const montant = Number(row.amount);
      const brut = montant + Number(row.retenue);
      const charge = brut - Math.min(Number(row.tva), brut);

      let code = /^6\d{1,5}$/.test(row.charge_account || '') ? row.charge_account : null;
      if (!code) {
        const regle = REGLES_NATURE_RESULTAT.find(([re]) => re.test(motif));
        code = regle ? regle[1] : '658';
      }
      const label = NATURES_CHARGES_RESULTAT[code] || 'Autre charge';
      ajouter(row.month, label, label, charge, 1);
    }

    for (const row of salairesResult.rows) {
      ajouter(row.month, 'Salaires', 'Salaires', Number(row.total), Number(row.n));
    }

    const arrondi = (n) => Math.round(n);
    const byMonth = Object.values(parMois)
      .map((m) => ({ month: m.month, total: arrondi(m.total) }))
      .sort((a, b) => a.month.localeCompare(b.month));
    const byNature = Object.values(parNature)
      .map((n) => ({ label: n.label, total: arrondi(n.total), count: n.count }))
      .sort((a, b) => b.total - a.total);

    res.json({
      from,
      to,
      total: byMonth.reduce((t, m) => t + m.total, 0),
      count: byNature.reduce((t, n) => t + n.count, 0),
      byNature,
      byMonth,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du calcul des charges.' });
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

    const xDescription = 130;
    const largeurDescription = doc.page.width - 50 - xDescription; // jusqu'à la marge droite, plus de 400pt fixes

    activite.forEach((a, index) => {
      // Hauteur de ligne calculée sur le texte réel (nom + description) au lieu d'une
      // hauteur fixe de 22 : sinon les descriptions longues passaient sur 2-3 lignes
      // et débordaient sur la ligne suivante (texte illisible, entassé).
      const texteComplet = `${a.user_name || 'Inconnu'} ${texteActivite(a)}`;
      doc.fontSize(9).font('Helvetica');
      const hauteurTexte = doc.heightOfString(texteComplet, { width: largeurDescription });
      const hauteurLigne = Math.max(22, hauteurTexte + 12);

      if (y + hauteurLigne > 770) {
        doc.addPage();
        y = 50;
      }
      if (index % 2 === 1) {
        doc.rect(50, y, doc.page.width - 100, hauteurLigne).fill(COULEURS.fondAlterne);
      }
      const date = new Date(a.created_at);
      doc.fillColor(COULEURS.muted).fontSize(8).font('Helvetica')
        .text(date.toLocaleDateString('fr-FR'), 56, y + 6, { width: 60 })
        .text(date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), 56, y + 6 + 9, { width: 60 });
      doc.fillColor(COULEURS.encre).fontSize(9);
      doc.font('Helvetica-Bold').text(a.user_name || 'Inconnu', xDescription, y + 6, { continued: true, width: largeurDescription });
      doc.font('Helvetica').text(` ${texteActivite(a)}`, { width: largeurDescription });
      y += hauteurLigne;
    });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
  }
});

module.exports = router;
