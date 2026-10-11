const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');
const {
  COULEURS: CH,
  dessinerEntete,
  dessinerEnteteTableau,
  dessinerBandeauTotal,
  lireLogoCommercant,
} = require('../utils/pdfHelpers');
const { FORMATS, mmEnPt, formaterDate, nomFichierPdf, metadonneesPdf } = require('../utils/pdfTheme');
const { creerAlerte, getNomUtilisateur } = require('../services/alerts.service');

const router = express.Router();
router.use(authenticate);

// Réservé manager/gérant, comme le reste de la gestion du stock inter-
// boutiques. Un gérant ne peut agir que sur SA boutique (assignée via
// req.user.warehouseId) ; le manager peut agir sur n'importe quelle paire.
router.use(requireRole('manager', 'gerant'));

// GET /stock-transfers — le manager voit tout ; le gérant ne voit que les
// transferts qui concernent SA boutique (source ou destination).
router.get('/', async (req, res) => {
  try {
    const conditions = ['t.merchant_id = $1'];
    const params = [req.user.merchantId];

    if (req.user.role === 'gerant') {
      if (!req.user.warehouseId) {
        return res.status(403).json({ error: "Vous n'êtes assigné à aucune boutique." });
      }
      params.push(req.user.warehouseId);
      conditions.push(`(t.from_warehouse_id = $${params.length} OR t.to_warehouse_id = $${params.length})`);
    }

    const result = await pool.query(
      `SELECT t.*, wf.name AS from_warehouse_name, wt.name AS to_warehouse_name,
              uc.full_name AS created_by_name
       FROM stock_transfers t
       JOIN warehouses wf ON wf.id = t.from_warehouse_id
       JOIN warehouses wt ON wt.id = t.to_warehouse_id
       LEFT JOIN users uc ON uc.id = t.created_by
       WHERE ${conditions.join(' AND ')}
       ORDER BY t.created_at DESC
       LIMIT 100`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des transferts.' });
  }
});

// GET /stock-transfers/:id — détail avec les articles
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, wf.name AS from_warehouse_name, wt.name AS to_warehouse_name,
              uc.full_name AS created_by_name, ur.full_name AS received_by_name
       FROM stock_transfers t
       JOIN warehouses wf ON wf.id = t.from_warehouse_id
       JOIN warehouses wt ON wt.id = t.to_warehouse_id
       LEFT JOIN users uc ON uc.id = t.created_by
       LEFT JOIN users ur ON ur.id = t.received_by
       WHERE t.id = $1 AND t.merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const transfer = result.rows[0];
    if (!transfer) return res.status(404).json({ error: 'Transfert introuvable.' });

    if (req.user.role === 'gerant' && req.user.warehouseId !== transfer.from_warehouse_id && req.user.warehouseId !== transfer.to_warehouse_id) {
      return res.status(403).json({ error: 'Ce transfert ne concerne pas votre boutique.' });
    }

    const items = await pool.query(
      `SELECT ti.id, ti.product_id, p.name AS product_name, p.is_weighted, ti.quantity
       FROM stock_transfer_items ti JOIN products p ON p.id = ti.product_id
       WHERE ti.transfer_id = $1`,
      [transfer.id]
    );

    res.json({ ...transfer, items: items.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du transfert.' });
  }
});

// ---------------------------------------------------------------------------
// Bon de transfert interne (A4 portrait) — charte graphique Amaterasu v8.
// Document à imprimer pour organiser un transfert entre deux boutiques/dépôts du même commerçant :
// d'où, vers où, quoi, avec une colonne « Qté reçue » à remplir à la main à l'arrivée.
// Quantités seulement (aucune valeur en argent).
// ---------------------------------------------------------------------------
const STATUTS_TRANSFERT = { envoye: 'En transit', recu: 'Réceptionné', annule: 'Annulé' };
const nombreFr = (n) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
const dateHeureFr = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const typeLieu = (type) => (/d[eé]p[oô]t/i.test(String(type || '')) ? 'Dépôt' : 'Boutique');

// TRF-2026-0007 (année de création + numéro de séquence) ; repli sur l'ancienne référence si pas de séquence.
function numeroTransfert(t) {
  const annee = new Date(t.created_at).getFullYear();
  const seq = t.transfer_seq !== null && t.transfer_seq !== undefined
    ? String(t.transfer_seq).padStart(4, '0')
    : String(t.id).replace(/-/g, '').slice(0, 8).toUpperCase();
  return `TRF-${annee}-${seq}`;
}

function dessinerBonTransfert(doc, { commerce, merchant, logo, transfert, articles }) {
  const marge = FORMATS.marge;
  const gauche = marge;
  const largeur = doc.page.width - 2 * marge;
  const droite = gauche + largeur;
  const bas = doc.page.height - mmEnPt(25); // limite du contenu : le pied de la charte est à 12 mm du bord
  const numero = numeroTransfert(transfert);

  // Seules les infos légales passent à l'en-tête : jamais les coordonnées bancaires sur un bon de transfert.
  const enteteMarchand = { address: merchant.address, ninea: merchant.ninea, rccm: merchant.rccm };
  let y = dessinerEntete(doc, {
    businessName: commerce,
    titre: 'Bon de transfert',
    sousTitre: `N° ${numero}  ·  ${formaterDate(transfert.created_at)}`,
    merchant: enteteMarchand,
    marge,
    logo,
  });

  // --- D'où → vers où -------------------------------------------------------
  const espace = 40;
  const largeurBoite = (largeur - espace) / 2;
  const hauteurBoite = 56;
  const boites = [
    { x: gauche, libelle: 'DE · ORIGINE', nom: transfert.from_warehouse_name, type: typeLieu(transfert.from_warehouse_type) },
    { x: gauche + largeurBoite + espace, libelle: 'VERS · DESTINATION', nom: transfert.to_warehouse_name, type: typeLieu(transfert.to_warehouse_type) },
  ];
  for (const b of boites) {
    doc.rect(b.x, y, largeurBoite, hauteurBoite).fill(CH.brume);
    doc.rect(b.x, y, 3, hauteurBoite).fill(CH.azur);
    doc.fillColor(CH.muted).font('Helvetica-Bold').fontSize(7.5)
      .text(b.libelle, b.x + 14, y + 9, { characterSpacing: 0.6, lineBreak: false });
    doc.fillColor(CH.marine).font('Titre').fontSize(13)
      .text(b.nom || '—', b.x + 14, y + 22, { width: largeurBoite - 26, lineBreak: false, ellipsis: true });
    doc.fillColor(CH.muted).font('Helvetica').fontSize(9)
      .text(b.type, b.x + 14, y + 40, { width: largeurBoite - 26, lineBreak: false });
  }
  // Flèche entre les deux boîtes
  const milieuY = y + hauteurBoite / 2;
  const xFleche = gauche + largeurBoite;
  doc.moveTo(xFleche + 9, milieuY).lineTo(xFleche + espace - 17, milieuY).lineWidth(1.6).strokeColor(CH.azur).stroke();
  doc.polygon([xFleche + espace - 18, milieuY - 5], [xFleche + espace - 8, milieuY], [xFleche + espace - 18, milieuY + 5]).fill(CH.azur);
  y += hauteurBoite + 16;

  // --- Infos : date, préparé par, statut, réception ---------------------------------
  const statut = STATUTS_TRANSFERT[transfert.status] || transfert.status;
  const couleurStatut = transfert.status === 'recu' ? CH.succes : transfert.status === 'annule' ? CH.brique : CH.alerte;
  let reception = '—';
  if (transfert.status === 'recu') {
    reception = [dateHeureFr(transfert.received_at), transfert.received_by_name].filter(Boolean).join(' · ') || 'Reçu';
  } else if (transfert.status === 'annule') {
    reception = dateHeureFr(transfert.cancelled_at) || 'Annulé';
  }
  const infos = [
    ["DATE D'ENVOI", dateHeureFr(transfert.created_at), CH.marine],
    ['PRÉPARÉ PAR', transfert.created_by_name || '—', CH.marine],
    ['STATUT', statut, couleurStatut],
    ['RÉCEPTION', reception, CH.marine],
  ];
  const largeurInfo = largeur / infos.length;
  infos.forEach(([libelle, valeur, couleur], i) => {
    const x = gauche + i * largeurInfo;
    doc.fillColor(CH.muted).font('Helvetica-Bold').fontSize(7.5)
      .text(libelle, x, y, { characterSpacing: 0.6, lineBreak: false });
    doc.fillColor(couleur).font('Helvetica-Bold').fontSize(9.5)
      .text(valeur, x, y + 12, { width: largeurInfo - 10, lineBreak: false, ellipsis: true });
  });
  y += 34;

  if (transfert.notes) {
    const texteNote = String(transfert.notes);
    doc.font('Helvetica').fontSize(9);
    const hauteurNote = Math.min(doc.heightOfString(texteNote, { width: largeur - 70 }), 36);
    doc.fillColor(CH.muted).font('Helvetica-Bold').fontSize(7.5)
      .text('REMARQUE', gauche, y + 1, { characterSpacing: 0.6, lineBreak: false });
    doc.fillColor(CH.marine).font('Helvetica').fontSize(9)
      .text(texteNote, gauche + 70, y, { width: largeur - 70, height: 36, ellipsis: true });
    y += hauteurNote + 12;
  }

  // --- Tableau des articles ---------------------------------------------------------------
  const xEnvoye = droite - 150;
  const xRecu = droite - 72;
  const colonnes = [
    { texte: 'N°', x: gauche + 8, largeur: 22 },
    { texte: 'Réf.', x: gauche + 36, largeur: 76 },
    { texte: 'Désignation', x: gauche + 118, largeur: xEnvoye - (gauche + 118) - 8 },
    { texte: 'Qté envoyée', x: xEnvoye, largeur: 66, aligner: 'right' },
    { texte: 'Qté reçue', x: xRecu, largeur: 64, aligner: 'center' },
  ];
  const debutTableau = (yy) => dessinerEnteteTableau(doc, yy + 7, colonnes, marge) - 4;
  y = debutTableau(y);

  let total = 0;
  articles.forEach((a, i) => {
    doc.font('Helvetica').fontSize(9.5);
    const hauteurNom = doc.heightOfString(a.product_name || '', { width: colonnes[2].largeur });
    const h = Math.max(24, hauteurNom + 12);
    if (y + h > bas) {
      doc.addPage();
      y = debutTableau(marge);
    }
    if (i % 2 === 1) doc.rect(gauche, y, largeur, h).fill(CH.brume);
    doc.fillColor(CH.muted).font('Helvetica').fontSize(9.5)
      .text(String(i + 1), colonnes[0].x, y + (h - 10) / 2, { width: colonnes[0].largeur, lineBreak: false });
    doc.fillColor(CH.muted).font('Helvetica').fontSize(8.5)
      .text(a.sku || '', colonnes[1].x, y + (h - 9) / 2, { width: colonnes[1].largeur, lineBreak: false, ellipsis: true });
    doc.fillColor(CH.marine).font('Helvetica').fontSize(9.5)
      .text(a.product_name || '', colonnes[2].x, y + 6, { width: colonnes[2].largeur });
    const qte = `${nombreFr(a.quantity)}${a.is_weighted ? ' kg' : ''}`;
    doc.fillColor(CH.marine).font('Helvetica-Bold').fontSize(10)
      .text(qte, colonnes[3].x, y + (h - 10) / 2, { width: colonnes[3].largeur, align: 'right', lineBreak: false });
    // Case vide à remplir à la main à la réception
    doc.roundedRect(xRecu + 6, y + 4, 52, h - 8, 3).lineWidth(0.6).strokeColor(CH.muted).stroke();
    doc.moveTo(gauche, y + h).lineTo(droite, y + h).lineWidth(0.5).strokeColor(CH.bordure).stroke();
    total += Number(a.quantity);
    y += h;
  });

  // --- Bloc de fin : total, observations, transporteur, signatures ----------------------
  const hauteurFin = 30 + 12 + 12 + 38 + 12 + 24 + 14 + 58 + 16;
  if (y + 14 + hauteurFin > bas) {
    doc.addPage();
    y = marge;
  } else {
    y += 14;
  }

  y = dessinerBandeauTotal(doc, {
    x: gauche, y, largeur,
    label: `${articles.length} article${articles.length > 1 ? 's' : ''} · quantité totale`,
    texteMontant: nombreFr(total),
  }) + 14;

  doc.fillColor(CH.muted).font('Helvetica-Bold').fontSize(7.5)
    .text('ÉCART / OBSERVATIONS À LA RÉCEPTION', gauche, y, { characterSpacing: 0.6, lineBreak: false });
  doc.rect(gauche, y + 12, largeur, 38).lineWidth(0.6).strokeColor(CH.muted).stroke();
  y += 12 + 38 + 14;

  doc.fillColor(CH.marine).font('Helvetica').fontSize(9.5)
    .text('Transporté par (nom, véhicule) :', gauche, y, { lineBreak: false });
  doc.moveTo(gauche + 160, y + 11).lineTo(droite, y + 11).lineWidth(0.6).strokeColor(CH.muted).stroke();
  y += 24 + 6;

  const largeurSign = (largeur - 24) / 2;
  const signatures = [
    { titre: 'Préparé par · origine', nom: transfert.created_by_name },
    { titre: 'Reçu par · destination', nom: transfert.received_by_name },
  ];
  signatures.forEach((s, i) => {
    const x = gauche + i * (largeurSign + 24);
    doc.fillColor(CH.marine).font('Helvetica-Bold').fontSize(9)
      .text(s.titre, x, y, { width: largeurSign, lineBreak: false });
    doc.rect(x, y + 14, largeurSign, 58).lineWidth(0.6).strokeColor(CH.muted).stroke();
    if (s.nom) {
      doc.fillColor(CH.muted).font('Helvetica').fontSize(8)
        .text(s.nom, x + 6, y + 19, { width: largeurSign - 12, lineBreak: false, ellipsis: true });
    }
    doc.fillColor(CH.muted).font('Helvetica').fontSize(8)
      .text('Nom, date et signature', x + 6, y + 60, { width: largeurSign - 12, lineBreak: false });
  });
}

// GET /stock-transfers/:id/pdf — bon de transfert à imprimer (manager, ou gérant concerné)
router.get('/:id/pdf', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, wf.name AS from_warehouse_name, wf.type AS from_warehouse_type,
              wt.name AS to_warehouse_name, wt.type AS to_warehouse_type,
              uc.full_name AS created_by_name, ur.full_name AS received_by_name,
              m.business_name, to_jsonb(m) AS merchant_json
       FROM stock_transfers t
       JOIN warehouses wf ON wf.id = t.from_warehouse_id
       JOIN warehouses wt ON wt.id = t.to_warehouse_id
       JOIN merchants m ON m.id = t.merchant_id
       LEFT JOIN users uc ON uc.id = t.created_by
       LEFT JOIN users ur ON ur.id = t.received_by
       WHERE t.id = $1 AND t.merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const transfert = result.rows[0];
    if (!transfert) return res.status(404).json({ error: 'Transfert introuvable.' });
    if (req.user.role === 'gerant' && req.user.warehouseId !== transfert.from_warehouse_id && req.user.warehouseId !== transfert.to_warehouse_id) {
      return res.status(403).json({ error: 'Ce transfert ne concerne pas votre boutique.' });
    }

    // to_jsonb(p)->>'sku' : lit la référence sans planter si la colonne porte un autre nom.
    const articles = await pool.query(
      `SELECT p.name AS product_name, p.is_weighted, to_jsonb(p) ->> 'sku' AS sku, ti.quantity
       FROM stock_transfer_items ti JOIN products p ON p.id = ti.product_id
       WHERE ti.transfer_id = $1 ORDER BY p.name`,
      [transfert.id]
    );

    const merchant = typeof transfert.merchant_json === 'string' ? JSON.parse(transfert.merchant_json) : (transfert.merchant_json || {});
    const logo = lireLogoCommercant(merchant);
    const numero = numeroTransfert(transfert);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nomFichierPdf('Bon-transfert', numero)}"`);
    // Marge basse à 0 : la pagination est gérée à la main (le pied de la charte s'écrit sous la marge).
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: FORMATS.marge, left: FORMATS.marge, right: FORMATS.marge, bottom: 0 },
      ...metadonneesPdf({ titre: `Bon de transfert ${numero}`, commercant: transfert.business_name }),
    });
    doc.on('error', (e) => console.error('pdfkit (bon de transfert) :', e));
    doc.pipe(res);
    dessinerBonTransfert(doc, { commerce: transfert.business_name, merchant, logo, transfert, articles: articles.rows });
    doc.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur lors de la génération du bon de transfert.' });
  }
});

// POST /stock-transfers — crée le bon ET décrémente immédiatement la
// boutique source (le stock "part" dès l'envoi, comme une commande
// fournisseur envoyée). Un gérant ne peut envoyer que depuis SA boutique.
router.post('/', async (req, res) => {
  const { fromWarehouseId, toWarehouseId, items, notes } = req.body;

  if (!fromWarehouseId || !toWarehouseId || fromWarehouseId === toWarehouseId) {
    return res.status(400).json({ error: 'Boutique source et destination invalides.' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Le transfert doit contenir au moins un article.' });
  }
  if (req.user.role === 'gerant' && req.user.warehouseId !== fromWarehouseId) {
    return res.status(403).json({ error: 'Vous ne pouvez transférer que depuis votre propre boutique.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const warehousesCheck = await client.query(
      `SELECT id FROM warehouses WHERE id = ANY($1) AND merchant_id = $2 AND is_active = TRUE`,
      [[fromWarehouseId, toWarehouseId], req.user.merchantId]
    );
    if (warehousesCheck.rows.length !== 2) {
      throw { status: 404, message: 'Boutique source ou destination introuvable.' };
    }

    const transferResult = await client.query(
      `INSERT INTO stock_transfers (merchant_id, from_warehouse_id, to_warehouse_id, created_by, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.merchantId, fromWarehouseId, toWarehouseId, req.user.id, notes || null]
    );
    const transfer = transferResult.rows[0];

    for (const item of items) {
      if (!item.productId || typeof item.quantity !== 'number' || item.quantity <= 0) {
        throw { status: 400, message: 'Article de transfert invalide.' };
      }

      const stockResult = await client.query(
        `SELECT ps.quantity_in_stock, p.name, p.is_weighted
         FROM product_stock ps JOIN products p ON p.id = ps.product_id
         WHERE ps.product_id = $1 AND ps.warehouse_id = $2 AND ps.merchant_id = $3
         FOR UPDATE`,
        [item.productId, fromWarehouseId, req.user.merchantId]
      );
      const stock = stockResult.rows[0];
      if (!stock) {
        throw { status: 404, message: `Produit introuvable dans la boutique source.` };
      }
      if (!stock.is_weighted && !Number.isInteger(item.quantity)) {
        throw { status: 400, message: `${stock.name} n'est pas vendu au poids : la quantité doit être un nombre entier.` };
      }
      if (Number(stock.quantity_in_stock) < item.quantity) {
        throw { status: 400, message: `Stock insuffisant pour ${stock.name} dans la boutique source.` };
      }

      await client.query(
        `UPDATE product_stock SET quantity_in_stock = quantity_in_stock - $1
         WHERE product_id = $2 AND warehouse_id = $3`,
        [item.quantity, item.productId, fromWarehouseId]
      );

      await client.query(
        `INSERT INTO stock_transfer_items (transfer_id, product_id, quantity) VALUES ($1, $2, $3)`,
        [transfer.id, item.productId, item.quantity]
      );

      await client.query(
        `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, warehouse_id, transfer_id)
         VALUES ($1, $2, $3, 'transfert', $4, $5, $6, $7)`,
        [req.user.merchantId, item.productId, req.user.id, item.quantity, `Transfert envoyé vers une autre boutique`, fromWarehouseId, transfer.id]
      );
    }

    await client.query('COMMIT');

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'stock_transfer_sent',
      description: `a envoyé un transfert de stock entre deux boutiques`,
    });

    res.status(201).json(transfer);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du transfert.' });
  } finally {
    client.release();
  }
});

// PATCH /stock-transfers/:id/receive — incrémente la boutique destination.
// Un gérant ne peut réceptionner que dans SA boutique.
router.patch('/:id/receive', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const transferResult = await client.query(
      `SELECT * FROM stock_transfers WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
      [req.params.id, req.user.merchantId]
    );
    const transfer = transferResult.rows[0];
    if (!transfer) throw { status: 404, message: 'Transfert introuvable.' };
    if (transfer.status !== 'envoye') {
      throw { status: 400, message: 'Ce transfert a déjà été réceptionné ou annulé.' };
    }
    if (req.user.role === 'gerant' && req.user.warehouseId !== transfer.to_warehouse_id) {
      throw { status: 403, message: 'Vous ne pouvez réceptionner que dans votre propre boutique.' };
    }

    const items = await client.query(
      `SELECT product_id, quantity FROM stock_transfer_items WHERE transfer_id = $1`,
      [transfer.id]
    );

    for (const item of items.rows) {
      await client.query(
        `INSERT INTO product_stock (merchant_id, product_id, warehouse_id, quantity_in_stock)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id, warehouse_id)
         DO UPDATE SET quantity_in_stock = product_stock.quantity_in_stock + $4`,
        [req.user.merchantId, item.product_id, transfer.to_warehouse_id, item.quantity]
      );

      await client.query(
        `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, warehouse_id, transfer_id)
         VALUES ($1, $2, $3, 'transfert', $4, $5, $6, $7)`,
        [req.user.merchantId, item.product_id, req.user.id, item.quantity, `Transfert reçu d'une autre boutique`, transfer.to_warehouse_id, transfer.id]
      );
    }

    const result = await client.query(
      `UPDATE stock_transfers SET status = 'recu', received_by = $1, received_at = now()
       WHERE id = $2 RETURNING *`,
      [req.user.id, transfer.id]
    );

    await client.query('COMMIT');

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'stock_transfer_received',
      description: `a réceptionné un transfert de stock`,
    });

    (async () => {
      const [{ rows: noms }, nomReceveur] = await Promise.all([
        pool.query(
          `SELECT wf.name AS source, wt.name AS destination FROM warehouses wf, warehouses wt WHERE wf.id = $1 AND wt.id = $2`,
          [transfer.from_warehouse_id, transfer.to_warehouse_id]
        ),
        getNomUtilisateur(req.user.id),
      ]);
      await creerAlerte({
        merchantId: req.user.merchantId,
        type: 'transfert_recu',
        titre: 'Transfert de stock reçu',
        message: `${nomReceveur || 'Un utilisateur'} a réceptionné le transfert de ${noms[0]?.source || 'la boutique source'} vers ${noms[0]?.destination || 'la boutique de destination'}.`,
        referenceId: transfer.id,
        roles: ['manager', 'gerant'],
      });
    })().catch((err) => console.error('Erreur alerte transfert_recu :', err));

    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la réception du transfert.' });
  } finally {
    client.release();
  }
});

// PATCH /stock-transfers/:id/cancel — annule un transfert. S'il n'a pas
// encore été reçu, restitue le stock à la boutique source. S'il a déjà été
// reçu, retire le stock de la destination et le restitue à la source
// (mêmes deux cas que l'annulation d'un bon de commande fournisseur).
router.patch('/:id/cancel', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const transferResult = await client.query(
      `SELECT * FROM stock_transfers WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
      [req.params.id, req.user.merchantId]
    );
    const transfer = transferResult.rows[0];
    if (!transfer) throw { status: 404, message: 'Transfert introuvable.' };
    if (transfer.status === 'annule') {
      throw { status: 400, message: 'Ce transfert est déjà annulé.' };
    }
    if (req.user.role === 'gerant' && req.user.warehouseId !== transfer.from_warehouse_id) {
      throw { status: 403, message: 'Vous ne pouvez annuler que les transferts partis de votre propre boutique.' };
    }

    const items = await client.query(
      `SELECT product_id, quantity FROM stock_transfer_items WHERE transfer_id = $1`,
      [transfer.id]
    );

    for (const item of items.rows) {
      // Restitue toujours le stock à la source.
      await client.query(
        `UPDATE product_stock SET quantity_in_stock = quantity_in_stock + $1
         WHERE product_id = $2 AND warehouse_id = $3`,
        [item.quantity, item.product_id, transfer.from_warehouse_id]
      );

      // Si déjà réceptionné, retire ce qui avait été ajouté à la destination.
      if (transfer.status === 'recu') {
        await client.query(
          `UPDATE product_stock SET quantity_in_stock = GREATEST(0, quantity_in_stock - $1)
           WHERE product_id = $2 AND warehouse_id = $3`,
          [item.quantity, item.product_id, transfer.to_warehouse_id]
        );
      }

      await client.query(
        `INSERT INTO stock_movements (merchant_id, product_id, user_id, movement_type, quantity, reason, warehouse_id, transfer_id)
         VALUES ($1, $2, $3, 'transfert', $4, $5, $6, $7)`,
        [req.user.merchantId, item.product_id, req.user.id, item.quantity, `Annulation du transfert`, transfer.from_warehouse_id, transfer.id]
      );
    }

    const result = await client.query(
      `UPDATE stock_transfers SET status = 'annule', cancelled_by = $1, cancelled_at = now()
       WHERE id = $2 RETURNING *`,
      [req.user.id, transfer.id]
    );

    await client.query('COMMIT');

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'stock_transfer_cancelled',
      description: `a annulé un transfert de stock`,
    });

    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'annulation du transfert." });
  } finally {
    client.release();
  }
});

module.exports = router;
