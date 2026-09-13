const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');
const { envoyerEmail } = require('../utils/mailer');
const { formatMontant } = require('../utils/pdfHelpers');

const router = express.Router();
router.use(authenticate);

// Calcule la créance d'un ou plusieurs clients : somme des ventes à crédit
// (payment_method = 'a_credit') moins les règlements déjà enregistrés.
// On ne stocke jamais ce montant en colonne pour éviter toute
// désynchronisation — il est toujours recalculé à la demande.
const SOUS_REQUETE_CREANCE = `
  COALESCE((
    SELECT SUM(o.total_amount) FROM orders o
    WHERE o.client_id = clients.id AND o.payment_method = 'a_credit' AND o.status != 'annulee'
  ), 0) - COALESCE((
    SELECT SUM(cp.amount) FROM credit_payments cp WHERE cp.client_id = clients.id
  ), 0)
`;

// GET /clients
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, phone, email, address, created_at, (${SOUS_REQUETE_CREANCE}) AS balance_due
       FROM clients WHERE merchant_id = $1 ORDER BY full_name`,
      [req.user.merchantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des clients.' });
  }
});

// GET /clients/:id  — fiche client avec son historique d'achats et sa créance
router.get('/:id', async (req, res) => {
  try {
    const clientResult = await pool.query(
      `SELECT id, full_name, phone, email, address, created_at, (${SOUS_REQUETE_CREANCE}) AS balance_due
       FROM clients WHERE id = $1 AND merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const client = clientResult.rows[0];
    if (!client) {
      return res.status(404).json({ error: 'Client introuvable.' });
    }

    const ordersResult = await pool.query(
      `SELECT id, status, total_amount, payment_method, created_at
       FROM orders WHERE client_id = $1 AND merchant_id = $2
       ORDER BY created_at DESC`,
      [req.params.id, req.user.merchantId]
    );

    const reglementsResult = await pool.query(
      `SELECT cp.id, cp.amount, cp.note, cp.created_at, u.full_name AS recorded_by_name
       FROM credit_payments cp LEFT JOIN users u ON u.id = cp.recorded_by
       WHERE cp.client_id = $1 AND cp.merchant_id = $2
       ORDER BY cp.created_at DESC`,
      [req.params.id, req.user.merchantId]
    );

    res.json({ ...client, orderHistory: ordersResult.rows, creditPayments: reglementsResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du client.' });
  }
});

// POST /clients/:id/credit-payments — enregistrer un règlement de créance
// (partiel ou total). Accessible au caissier, au manager et au gérant.
router.post('/:id/credit-payments', requireRole('manager', 'gerant', 'caissier'), async (req, res) => {
  const { amount, note } = req.body;

  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Le montant du règlement doit être un nombre positif.' });
  }

  try {
    const clientResult = await pool.query(
      `SELECT id, full_name, (${SOUS_REQUETE_CREANCE}) AS balance_due FROM clients WHERE id = $1 AND merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const client = clientResult.rows[0];
    if (!client) return res.status(404).json({ error: 'Client introuvable.' });

    if (amount > Number(client.balance_due)) {
      return res.status(400).json({ error: 'Le montant du règlement dépasse la créance restante.' });
    }

    const result = await pool.query(
      `INSERT INTO credit_payments (merchant_id, client_id, amount, recorded_by, note)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.merchantId, req.params.id, amount, req.user.id, note || null]
    );

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'credit_payment',
      description: `a enregistré un règlement de ${amount.toLocaleString('fr-FR')} pour ${client.full_name}`,
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement du règlement." });
  }
});

// Construit le détail facture par facture : pour chaque vente à crédit,
// combien a déjà été imputé dessus (les règlements sont enregistrés au
// niveau du client, pas facture par facture, donc on les impute à la plus
// ancienne facture d'abord — FIFO) et combien il en reste à payer.
async function calculerDetailCreances(merchantId, clientId) {
  const ventesResult = await pool.query(
    `SELECT id, total_amount, created_at, credit_due_date
     FROM orders
     WHERE client_id = $1 AND merchant_id = $2 AND payment_method = 'a_credit' AND status != 'annulee'
     ORDER BY created_at, id`,
    [clientId, merchantId]
  );
  const paiementsResult = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total_paye FROM credit_payments WHERE client_id = $1 AND merchant_id = $2`,
    [clientId, merchantId]
  );
  let totalPaye = Number(paiementsResult.rows[0].total_paye);

  return ventesResult.rows.map((vente) => {
    const montant = Number(vente.total_amount);
    const avanceImputee = Math.min(Math.max(totalPaye, 0), montant);
    totalPaye -= avanceImputee;
    return {
      id: vente.id,
      created_at: vente.created_at,
      credit_due_date: vente.credit_due_date,
      montant,
      avance: avanceImputee,
      reste: montant - avanceImputee,
    };
  });
}

function gabaritReleveCompte({ clientName, businessName, factures, totalRestant }) {
  const lignes = factures
    .map((f) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${new Date(f.created_at).toLocaleDateString('fr-FR')}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${formatMontant(f.montant)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${f.avance > 0 ? formatMontant(f.avance) : '—'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:${f.reste > 0 ? 'bold' : 'normal'};">${formatMontant(f.reste)}</td>
      </tr>
    `)
    .join('');

  return `
    <div style="font-family: Arial, sans-serif; color: #222; max-width: 520px;">
      <p>Bonjour ${clientName},</p>
      <p>Voici le relevé de votre compte auprès de ${businessName} :</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="padding:6px 10px;text-align:left;">Date</th>
            <th style="padding:6px 10px;text-align:right;">Montant</th>
            <th style="padding:6px 10px;text-align:right;">Déjà réglé</th>
            <th style="padding:6px 10px;text-align:right;">Reste à payer</th>
          </tr>
        </thead>
        <tbody>${lignes}</tbody>
      </table>
      <p style="font-size:18px;font-weight:bold;">Total restant dû : ${formatMontant(totalRestant)} FCFA</p>
      <p>Merci de bien vouloir régulariser ce solde auprès de ${businessName}.</p>
      <p style="color: #888; font-size: 13px;">Ce message vous a été envoyé par ${businessName} via Amaterasu.</p>
    </div>
  `;
}

// POST /clients/:id/send-statement — envoie manuellement au client, par
// email, le détail de ses factures à crédit (montant, avance déjà réglée,
// reste à payer). Déclenché par un bouton, jamais automatique.
router.post('/:id/send-statement', requireRole('manager', 'gerant', 'caissier'), async (req, res) => {
  try {
    const clientResult = await pool.query(
      `SELECT c.*, m.business_name, m.email AS merchant_email
       FROM clients c JOIN merchants m ON m.id = c.merchant_id
       WHERE c.id = $1 AND c.merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const client = clientResult.rows[0];
    if (!client) return res.status(404).json({ error: 'Client introuvable.' });
    if (!client.email) {
      return res.status(400).json({ error: "Ce client n'a pas d'adresse email enregistrée." });
    }

    const factures = await calculerDetailCreances(req.user.merchantId, client.id);
    const totalRestant = factures.reduce((somme, f) => somme + f.reste, 0);

    if (factures.length === 0) {
      return res.status(400).json({ error: "Ce client n'a aucune facture à crédit à afficher." });
    }

    await envoyerEmail({
      to: client.email,
      replyTo: client.merchant_email,
      subject: `Relevé de compte — ${client.business_name}`,
      html: gabaritReleveCompte({
        clientName: client.full_name,
        businessName: client.business_name,
        factures,
        totalRestant,
      }),
    });

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'client_statement_sent',
      description: `a envoyé un relevé de compte par email à ${client.full_name}`,
    });

    res.json({ sent: true, totalRestant });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'envoi du relevé de compte." });
  }
});

// POST /clients — tous les rôles peuvent créer une fiche client (utile au comptoir)
router.post('/', async (req, res) => {
  const { fullName, phone, email, address } = req.body;

  if (!fullName) {
    return res.status(400).json({ error: 'Le nom du client est requis.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO clients (merchant_id, full_name, phone, email, address)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.merchantId, fullName, phone || null, email || null, address || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du client.' });
  }
});

module.exports = router;
