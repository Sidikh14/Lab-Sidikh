const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');
const { creerAlerte, getNomUtilisateur } = require('../services/alerts.service');
const { COULEURS, formatMontant, dessinerEntete, dessinerEnteteTableau, dessinerPiedDePage, traitSeparateur } = require('../utils/pdfHelpers');
const { calculerDetailCreances } = require('../utils/creditInvoices');

const router = express.Router();
router.use(authenticate);

// Doit rester synchronisée avec MOYENS_PAIEMENT dans cash.routes.js
const MOYENS_PAIEMENT = ['especes', 'wave', 'orange_money', 'cheque', 'virement'];

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
      `SELECT c.id, c.full_name, c.phone, c.email, c.address, c.created_at,
              c.insurer_id, c.insurance_coverage_percent, i.name AS insurer_name,
              (${SOUS_REQUETE_CREANCE.replace(/clients\.id/g, 'c.id')}) AS balance_due
       FROM clients c
       LEFT JOIN insurers i ON i.id = c.insurer_id
       WHERE c.merchant_id = $1 ORDER BY c.full_name`,
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
      `SELECT clients.id, clients.full_name, clients.phone, clients.email, clients.address, clients.created_at,
              clients.insurer_id, clients.insurance_coverage_percent, i.name AS insurer_name,
              (${SOUS_REQUETE_CREANCE}) AS balance_due
       FROM clients LEFT JOIN insurers i ON i.id = clients.insurer_id
       WHERE clients.id = $1 AND clients.merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const client = clientResult.rows[0];
    if (!client) {
      return res.status(404).json({ error: 'Client introuvable.' });
    }

    const ordersResult = await pool.query(
      `SELECT id, order_seq, status, total_amount, payment_method, created_at, validated_at
       FROM orders WHERE client_id = $1 AND merchant_id = $2
       ORDER BY created_at DESC`,
      [req.params.id, req.user.merchantId]
    );

    const reglementsResult = await pool.query(
      `SELECT cp.id, cp.amount, cp.note, cp.created_at, cp.order_id, u.full_name AS recorded_by_name,
              o.order_seq AS order_seq, o.created_at AS order_created_at
       FROM credit_payments cp
       LEFT JOIN users u ON u.id = cp.recorded_by
       LEFT JOIN orders o ON o.id = cp.order_id
       WHERE cp.client_id = $1 AND cp.merchant_id = $2
       ORDER BY cp.created_at DESC`,
      [req.params.id, req.user.merchantId]
    );

    // Factures à crédit : montant, déjà réglé, reste et statut (payée / partielle / impayée).
    const creditInvoices = await calculerDetailCreances(req.user.merchantId, req.params.id);
    const factureParId = new Map(creditInvoices.map((f) => [f.id, f]));
    const historiqueCommandes = ordersResult.rows.map((o) => {
      const annee = new Date(o.created_at).getFullYear();
      const order_number = `CMD-${annee}-${String(o.order_seq).padStart(4, '0')}`;
      let payment_status = null;
      let reste = null;
      if (o.status !== 'annulee') {
        if (o.payment_method === 'a_credit') {
          const f = factureParId.get(o.id);
          if (f) { payment_status = f.statut; reste = f.reste; }
        } else if (o.payment_method !== 'tiers_payant' && o.validated_at) {
          payment_status = 'payee';
        }
      }
      return { ...o, order_number, payment_status, reste };
    });
    const reglements = reglementsResult.rows.map((r) => ({
      ...r,
      order_number: r.order_id && r.order_seq != null
        ? `CMD-${new Date(r.order_created_at).getFullYear()}-${String(r.order_seq).padStart(4, '0')}`
        : null,
    }));

    // Dossier patient (pharmacie) : ordonnances rattachées à cette fiche, avec
    // pour les renouvelables la quantité prescrite / délivrée par produit.
    // Isolé dans son propre try/catch : une base pas encore migrée ne doit
    // jamais empêcher d'ouvrir la fiche.
    let prescriptions = [];
    if (req.user.sector === 'pharmacie') {
      try {
        const prescriptionsResult = await pool.query(
          `SELECT p.id, p.doctor_name, p.prescription_date, p.is_renewable, p.valid_until,
                  (p.valid_until IS NOT NULL AND p.valid_until < CURRENT_DATE) AS expired,
                  CASE WHEN p.is_renewable THEN COALESCE((
                    SELECT json_agg(json_build_object(
                             'productId', pi.product_id,
                             'productName', pr.name,
                             'prescribed', pi.quantity_prescribed,
                             'delivered', COALESCE(d.qty, 0)
                           ) ORDER BY pr.name)
                    FROM prescription_items pi
                    JOIN products pr ON pr.id = pi.product_id
                    LEFT JOIN LATERAL (
                      SELECT SUM(oi.quantity) AS qty
                      FROM order_items oi
                      JOIN orders o ON o.id = oi.order_id
                      WHERE o.prescription_id = pi.prescription_id
                        AND oi.product_id = pi.product_id
                        AND o.status <> 'annulee'
                    ) d ON true
                    WHERE pi.prescription_id = p.id
                  ), '[]'::json) ELSE NULL END AS items
           FROM prescriptions p
           WHERE p.client_id = $1 AND p.merchant_id = $2
           ORDER BY p.created_at DESC`,
          [req.params.id, req.user.merchantId]
        );
        prescriptions = prescriptionsResult.rows;
      } catch (errPrescriptions) {
        console.error('Ordonnances du patient non chargées :', errPrescriptions.message);
      }
    }

    res.json({ ...client, orderHistory: historiqueCommandes, creditPayments: reglements, creditInvoices, prescriptions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du client.' });
  }
});

// POST /clients/:id/credit-payments — enregistrer un règlement de créance
// (partiel ou total). Accessible au caissier, au manager et au gérant.
router.post('/:id/credit-payments', requireRole('manager', 'gerant', 'caissier', 'vendeur_caissier'), async (req, res) => {
  const { amount, note, paymentMethod, warehouseId: warehouseIdInput, orderId } = req.body;

  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Le montant du règlement doit être un nombre positif.' });
  }
  if (!MOYENS_PAIEMENT.includes(paymentMethod)) {
    return res.status(400).json({ error: 'Moyen de paiement invalide.' });
  }
  if (typeof orderId !== 'string' || !orderId) {
    return res.status(400).json({ error: 'Choisissez la facture à laquelle ce règlement s\'applique.' });
  }

  try {
    const clientResult = await pool.query(
      `SELECT id, full_name FROM clients WHERE id = $1 AND merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const client = clientResult.rows[0];
    if (!client) return res.status(404).json({ error: 'Client introuvable.' });

    // La facture doit être une vente à crédit de ce client ; le versement ne peut pas dépasser son reste à payer.
    const factures = await calculerDetailCreances(req.user.merchantId, client.id);
    const facture = factures.find((f) => f.id === orderId);
    if (!facture) {
      return res.status(400).json({ error: 'Facture introuvable parmi les ventes à crédit de ce client.' });
    }
    if (facture.reste <= 0) {
      return res.status(400).json({ error: `La facture ${facture.order_number} est déjà entièrement payée.` });
    }
    if (amount > facture.reste) {
      return res.status(400).json({
        error: `Le montant dépasse le reste à payer de la facture ${facture.order_number} (${formatMontant(facture.reste)} FCFA).`,
      });
    }

    // Caisse qui encaisse : le manager choisit la boutique ; les autres rôles encaissent dans la leur.
    // Sans boutique rattachée, le règlement n'apparaîtrait dans aucune caisse.
    const boutiqueId = req.user.role === 'manager' ? warehouseIdInput : req.user.warehouseId;
    if (!boutiqueId) {
      return res.status(400).json({
        error: req.user.role === 'manager' ? 'Choisissez la boutique dont la caisse encaisse ce règlement.' : "Vous n'êtes assigné à aucune boutique.",
      });
    }
    const boutique = await pool.query(
      `SELECT id FROM warehouses WHERE id = $1 AND merchant_id = $2 AND is_active = TRUE`,
      [boutiqueId, req.user.merchantId]
    );
    if (boutique.rows.length === 0) return res.status(404).json({ error: 'Boutique introuvable.' });

    const result = await pool.query(
      `INSERT INTO credit_payments (merchant_id, client_id, amount, payment_method, recorded_by, note, warehouse_id, order_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.merchantId, req.params.id, amount, paymentMethod, req.user.id, note || null, boutiqueId, facture.id]
    );

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'credit_payment',
      description: `a enregistré un règlement de ${formatMontant(amount)} pour ${client.full_name} (facture ${facture.order_number})`,
    });

    getNomUtilisateur(req.user.id).then((nom) => {
      creerAlerte({
        merchantId: req.user.merchantId,
        type: 'reglement_recu',
        titre: 'Règlement client reçu',
        message: `${nom || 'Un utilisateur'} a enregistré un règlement de ${formatMontant(amount)} FCFA de ${client.full_name} (facture ${facture.order_number}).`,
        montant: amount,
        referenceId: result.rows[0].id,
        roles: ['manager', 'gerant'],
      }).catch((err) => console.error('Erreur alerte reglement_recu (client) :', err));
    }).catch((err) => console.error('Erreur getNomUtilisateur (reglement_recu) :', err));

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement du règlement." });
  }
});

// Le détail facture par facture (montant, déjà réglé, reste, statut) est calculé dans utils/creditInvoices.js,
// partagé avec la facture A4 (orders_routes.js).

function texteReleveCompte({ clientName, businessName, factures, totalRestant }) {
  const lignes = factures
    .map((f) => {
      const date = new Date(f.created_at).toLocaleDateString('fr-FR');
      const avance = f.avance > 0 ? `déjà réglé : ${formatMontant(f.avance)} FCFA — ` : '';
      return `• ${f.order_number} du ${date} : ${formatMontant(f.montant)} FCFA (${avance}reste ${formatMontant(f.reste)} FCFA)`;
    })
    .join('\n');

  return `Bonjour ${clientName},\n\nVoici votre relevé de compte chez ${businessName} :\n\n${lignes}\n\nTotal restant dû : ${formatMontant(totalRestant)} FCFA\n\nMerci de bien vouloir régulariser ce solde.`;
}

// Un numéro sénégalais est généralement enregistré sans indicatif (9
// chiffres, ex: 77 123 45 67) : on ajoute 221 dans ce cas précis. S'il a
// déjà un indicatif ou une forme différente, on le laisse tel quel (une
// fois les espaces/tirets retirés) — wa.me accepte le numéro complet avec
// indicatif, sans le "+".
function normaliserNumeroWhatsapp(phone) {
  const chiffres = (phone || '').replace(/\D/g, '');
  if (!chiffres) return null;
  if (chiffres.length === 9) return `221${chiffres}`;
  return chiffres;
}

// POST /clients/:id/whatsapp-statement — prépare le relevé de compte du
// client (détail facture par facture : montant, avance déjà imputée en
// FIFO, reste à payer) sous forme de message texte, prêt à être envoyé via
// WhatsApp. Ne contacte aucune API externe : c'est le frontend qui ouvre
// ensuite wa.me avec ce message pré-rempli, et l'utilisateur clique
// lui-même sur "Envoyer" dans WhatsApp.
router.post('/:id/whatsapp-statement', requireRole('manager', 'gerant', 'caissier', 'vendeur_caissier'), async (req, res) => {
  try {
    const clientResult = await pool.query(
      `SELECT c.*, m.business_name
       FROM clients c JOIN merchants m ON m.id = c.merchant_id
       WHERE c.id = $1 AND c.merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const client = clientResult.rows[0];
    if (!client) return res.status(404).json({ error: 'Client introuvable.' });
    if (!client.phone) {
      return res.status(400).json({ error: "Ce client n'a pas de numéro de téléphone enregistré." });
    }

    const numeroWhatsapp = normaliserNumeroWhatsapp(client.phone);
    if (!numeroWhatsapp) {
      return res.status(400).json({ error: 'Numéro de téléphone invalide.' });
    }

    const factures = await calculerDetailCreances(req.user.merchantId, client.id);
    if (factures.length === 0) {
      return res.status(400).json({ error: "Ce client n'a aucune facture à crédit à afficher." });
    }
    const totalRestant = factures.reduce((somme, f) => somme + f.reste, 0);

    const message = texteReleveCompte({
      clientName: client.full_name,
      businessName: client.business_name,
      factures,
      totalRestant,
    });

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'client_statement_sent',
      description: `a envoyé un relevé de compte via WhatsApp à ${client.full_name}`,
    });

    res.json({ phone: numeroWhatsapp, message, totalRestant });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la préparation du relevé.' });
  }
});

// PDF listant les factures à crédit impayées ou partiellement payées d'un
// client, avec pour chacune le montant, ce qui a déjà été réglé (versement)
// et le reste à payer — à envoyer directement au client.
function genererFacturesImpayeesPdf(res, { businessName, clientName, factures, totalRestant, merchant }) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="factures-impayees-${clientName.replace(/\s+/g, '-')}.pdf"`);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });

  // Si le client coupe la connexion (onglet fermé, téléchargement annulé,
  // timeout côté hébergeur), la réponse se ferme toute seule mais pdfkit,
  // lui, continue de pousser ses chunks dans le pipe → écriture dans une
  // réponse terminée → ERR_STREAM_WRITE_AFTER_END émis sur le
  // ServerResponse → crash du processus entier. On arrête donc le document
  // dès que la connexion se ferme.
  res.on('close', () => {
    if (!res.writableEnded) doc.destroy();
  });

  // Dernier filet : une erreur d'écriture sur la réponse ne doit jamais
  // remonter en exception non catchée.
  res.on('error', (err) => {
    console.error('Erreur réponse HTTP (factures impayées) :', err);
    doc.destroy();
  });

  // Filet de sécurité : si pdfkit échoue en cours de flux (ex : image de
  // logo corrompue) APRÈS que l'en-tête HTTP "Content-Type: application/pdf"
  // soit déjà parti, il est trop tard pour répondre du JSON — on ne peut
  // qu'arrêter proprement la connexion, sans jamais laisser une exception
  // non catchée remonter et faire planter tout le processus Node.
  doc.on('error', (err) => {
    console.error('Erreur pdfkit (factures impayées) :', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
    } else if (!res.writableEnded) {
      // IMPÉRATIF : débrancher le flux AVANT de fermer la réponse, sinon le
      // chunk suivant est écrit dans une réponse déjà terminée et fait
      // planter le processus.
      doc.unpipe(res);
      res.end();
    }
  });

  doc.pipe(res);

  let y = dessinerEntete(doc, {
    businessName,
    titre: 'Factures impayées',
    sousTitre: `${clientName} · ${factures.length} facture(s) · Total restant dû : ${formatMontant(totalRestant)} FCFA`,
    merchant,
  });
  y += 10;

  function entete() {
    y = dessinerEnteteTableau(doc, y, [
      { texte: 'Date', x: 56, largeur: 80 },
      { texte: 'Montant', x: 150, largeur: 110, aligner: 'right' },
      { texte: 'Déjà réglé', x: 280, largeur: 110, aligner: 'right' },
      { texte: 'Reste à payer', x: 410, largeur: 120, aligner: 'right' },
    ]);
  }
  entete();

  factures.forEach((f, index) => {
    if (y > 750) {
      doc.addPage();
      y = 50;
      entete();
    }
    if (index % 2 === 1) {
      doc.rect(50, y, doc.page.width - 100, 20).fill(COULEURS.fondAlterne);
      doc.fillColor(COULEURS.encre);
    }
    doc.fontSize(9).fillColor(COULEURS.encre);
    doc.text(new Date(f.created_at).toLocaleDateString('fr-FR'), 56, y + 5, { width: 80 });
    doc.text(`${formatMontant(f.montant)} FCFA`, 150, y + 5, { width: 110, align: 'right' });
    doc.text(`${formatMontant(f.avance)} FCFA`, 280, y + 5, { width: 110, align: 'right' });
    doc.text(`${formatMontant(f.reste)} FCFA`, 410, y + 5, { width: 120, align: 'right' });
    y += 20;
  });

  traitSeparateur(doc, y + 4);
  y += 16;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COULEURS.encre);
  doc.text('TOTAL RESTANT DÛ', 280, y, { width: 130, align: 'right' });
  doc.text(`${formatMontant(totalRestant)} FCFA`, 410, y, { width: 120, align: 'right' });
  doc.font('Helvetica');

  dessinerPiedDePage(doc, merchant);
  doc.end();
}

// GET /clients/:id/unpaid-invoices-pdf — export PDF des factures à crédit
// impayées ou partiellement réglées du client (avec le détail des
// versements déjà faits), à télécharger et envoyer au client.
router.get('/:id/unpaid-invoices-pdf', requireRole('manager', 'gerant', 'caissier', 'vendeur_caissier'), async (req, res) => {
  try {
    const clientResult = await pool.query(
      `SELECT c.*, m.business_name, m.logo_data, m.ninea, m.rccm,
              m.address AS merchant_address, m.bank_details, m.mobile_money_details, m.payment_terms
       FROM clients c JOIN merchants m ON m.id = c.merchant_id
       WHERE c.id = $1 AND c.merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const client = clientResult.rows[0];
    if (!client) return res.status(404).json({ error: 'Client introuvable.' });

    const factures = (await calculerDetailCreances(req.user.merchantId, client.id)).filter((f) => f.reste > 0);
    if (factures.length === 0) {
      return res.status(400).json({ error: "Ce client n'a aucune facture impayée." });
    }
    const totalRestant = factures.reduce((somme, f) => somme + f.reste, 0);

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'client_unpaid_invoices_pdf',
      description: `a exporté les factures impayées de ${client.full_name} en PDF`,
    });

    return genererFacturesImpayeesPdf(res, {
      businessName: client.business_name,
      clientName: client.full_name,
      factures,
      totalRestant,
      merchant: {
        logo_data: client.logo_data,
        ninea: client.ninea,
        rccm: client.rccm,
        address: client.merchant_address,
        bank_details: client.bank_details,
        mobile_money_details: client.mobile_money_details,
        payment_terms: client.payment_terms,
      },
    });
  } catch (err) {
    console.error(err);
    // Si la génération a déjà commencé, l'en-tête "application/pdf" est
    // parti : répondre du JSON ici déclencherait un second crash
    // ("Cannot set headers after they are sent"). On coupe la connexion.
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
    } else if (!res.writableEnded) {
      res.destroy();
    }
  }
});

// POST /clients — tous les rôles peuvent créer une fiche client (utile au comptoir)
router.post('/', async (req, res) => {
  const { fullName, phone, email, address, insurerId, insuranceCoveragePercent } = req.body;

  if (!fullName) {
    return res.status(400).json({ error: 'Le nom du client est requis.' });
  }
  if (insuranceCoveragePercent !== undefined && insuranceCoveragePercent !== null) {
    const pourcentage = Number(insuranceCoveragePercent);
    if (Number.isNaN(pourcentage) || pourcentage < 0 || pourcentage > 100) {
      return res.status(400).json({ error: 'Le pourcentage de prise en charge doit être entre 0 et 100.' });
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO clients (merchant_id, full_name, phone, email, address, insurer_id, insurance_coverage_percent)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.merchantId, fullName, phone || null, email || null, address || null, insurerId || null, insuranceCoveragePercent ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du client.' });
  }
});

// PATCH /clients/:id — modifier les coordonnées d'un client (ex : ajouter un
// numéro pour pouvoir lui envoyer des relances via WhatsApp). Ouvert à tous
// les rôles, comme la création, pour rester pratique au comptoir.
router.patch('/:id', async (req, res) => {
  const { fullName, phone, email, address, insurerId, insuranceCoveragePercent } = req.body;

  if (insuranceCoveragePercent !== undefined && insuranceCoveragePercent !== null) {
    const pourcentage = Number(insuranceCoveragePercent);
    if (Number.isNaN(pourcentage) || pourcentage < 0 || pourcentage > 100) {
      return res.status(400).json({ error: 'Le pourcentage de prise en charge doit être entre 0 et 100.' });
    }
  }

  try {
    const result = await pool.query(
      `UPDATE clients SET
         full_name = COALESCE($1, full_name),
         phone = COALESCE($2, phone),
         email = COALESCE($3, email),
         address = COALESCE($4, address),
         insurer_id = $5,
         insurance_coverage_percent = $6
       WHERE id = $7 AND merchant_id = $8
       RETURNING *`,
      [fullName, phone, email, address, insurerId || null, insuranceCoveragePercent ?? null, req.params.id, req.user.merchantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client introuvable.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du client.' });
  }
});

module.exports = router;
