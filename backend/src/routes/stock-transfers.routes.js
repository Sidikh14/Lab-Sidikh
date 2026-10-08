const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');

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

// Dessine le bon de transfert (A4) : ce que le livreur emporte, d'où, vers où, avec les cases de signature.
const STATUTS_TRANSFERT = { envoye: 'En cours de livraison', recu: 'Reçu', annule: 'Annulé' };
const nombreFr = (n) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
const dateHeureFr = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');

function dessinerBonTransfert(doc, { commerce, transfert, articles }) {
  const gauche = doc.page.margins.left;
  const largeur = doc.page.width - gauche - doc.page.margins.right;
  const ref = String(transfert.id).replace(/-/g, '').slice(0, 8).toUpperCase();

  doc.font('Helvetica-Bold').fontSize(16).text(commerce, gauche, 40, { width: largeur });
  doc.font('Helvetica-Bold').fontSize(20).text('BON DE TRANSFERT', gauche, 40, { width: largeur, align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor('#555').text(`Réf. ${ref}`, gauche, 66, { width: largeur, align: 'right' });
  doc.fillColor('#000');
  doc.moveTo(gauche, 90).lineTo(gauche + largeur, 90).strokeColor('#999').stroke();

  // Origine → destination
  const demi = largeur / 2 - 10;
  doc.font('Helvetica').fontSize(9).fillColor('#555').text('DE (expéditeur)', gauche, 102).text('VERS (destinataire)', gauche + demi + 20, 102);
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#000')
    .text(transfert.from_warehouse_name, gauche, 116, { width: demi })
    .text(transfert.to_warehouse_name, gauche + demi + 20, 116, { width: demi });

  doc.font('Helvetica').fontSize(10).fillColor('#000');
  const infos = [
    ['Date d\'envoi', dateHeureFr(transfert.created_at)],
    ['Préparé par', transfert.created_by_name || '—'],
    ['Statut', STATUTS_TRANSFERT[transfert.status] || transfert.status],
  ];
  let y = 150;
  for (const [libelle, valeur] of infos) {
    doc.font('Helvetica').fillColor('#555').text(`${libelle} :`, gauche, y, { width: 90, continued: false });
    doc.font('Helvetica-Bold').fillColor('#000').text(valeur, gauche + 95, y, { width: largeur - 95 });
    y += 16;
  }
  if (transfert.notes) {
    doc.font('Helvetica').fillColor('#555').text('Remarque :', gauche, y, { width: 90 });
    doc.font('Helvetica').fillColor('#000').text(String(transfert.notes), gauche + 95, y, { width: largeur - 95 });
    y = doc.y + 4;
  }

  // Tableau des articles : N° | Article | Quantité | Vérifié à l'arrivée (case à cocher)
  y += 12;
  const colonnes = [
    { titre: 'N°', x: gauche, w: 30 },
    { titre: 'Article', x: gauche + 30, w: largeur - 30 - 90 - 90 },
    { titre: 'Quantité', x: gauche + largeur - 180, w: 90, align: 'right' },
    { titre: 'Vérifié', x: gauche + largeur - 90, w: 90, align: 'center' },
  ];
  const enteteTableau = (yy) => {
    doc.rect(gauche, yy, largeur, 20).fill('#eeeeee');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
    for (const c of colonnes) doc.text(c.titre, c.x + 4, yy + 5, { width: c.w - 8, align: c.align || 'left' });
    return yy + 20;
  };
  y = enteteTableau(y);
  doc.font('Helvetica').fontSize(10);
  let totalQuantite = 0;
  articles.forEach((a, i) => {
    const hauteurNom = doc.heightOfString(a.product_name, { width: colonnes[1].w - 8 });
    const h = Math.max(22, hauteurNom + 10);
    if (y + h > doc.page.height - 190) { // il faut garder la place pour les signatures
      doc.addPage();
      y = enteteTableau(40);
      doc.font('Helvetica').fontSize(10);
    }
    doc.fillColor('#000');
    doc.text(String(i + 1), colonnes[0].x + 4, y + 6, { width: colonnes[0].w - 8 });
    doc.text(a.product_name, colonnes[1].x + 4, y + 6, { width: colonnes[1].w - 8 });
    doc.font('Helvetica-Bold').text(nombreFr(a.quantity), colonnes[2].x + 4, y + 6, { width: colonnes[2].w - 8, align: 'right' }).font('Helvetica');
    doc.rect(colonnes[3].x + colonnes[3].w / 2 - 6, y + 5, 12, 12).strokeColor('#555').stroke();
    doc.moveTo(gauche, y + h).lineTo(gauche + largeur, y + h).strokeColor('#dddddd').stroke();
    totalQuantite += Number(a.quantity);
    y += h;
  });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000')
    .text(`${articles.length} article${articles.length > 1 ? 's' : ''} — quantité totale : ${nombreFr(totalQuantite)}`, gauche, y + 8, { width: largeur, align: 'right' });

  // Signatures : toujours en bas de la dernière page.
  let ySign = Math.max(doc.y + 30, doc.page.height - 170);
  if (ySign + 130 > doc.page.height - 40) { doc.addPage(); ySign = 60; }
  const tiers = largeur / 3 - 8;
  const cases = ['Remis par (expéditeur)', 'Livreur — nom, véhicule', 'Reçu par (destinataire)'];
  cases.forEach((titre, i) => {
    const x = gauche + i * (tiers + 12);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text(titre, x, ySign, { width: tiers });
    doc.rect(x, ySign + 16, tiers, 80).strokeColor('#999').stroke();
    doc.font('Helvetica').fontSize(8).fillColor('#777').text('Nom, date et signature', x + 4, ySign + 100, { width: tiers - 8 });
  });
  doc.page.margins.bottom = 0; // le pied de page est sous la marge basse : sans cela pdfkit ajoute une page vide
  doc.font('Helvetica').fontSize(8).fillColor('#777')
    .text(`Document imprimé le ${dateHeureFr(new Date())}. À contrôler à l'arrivée : toute différence doit être signalée avant signature.`, gauche, doc.page.height - 36, { width: largeur, align: 'center' });
}

// GET /stock-transfers/:id/pdf — bon de transfert à remettre au livreur (manager, ou gérant concerné)
router.get('/:id/pdf', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, wf.name AS from_warehouse_name, wt.name AS to_warehouse_name,
              uc.full_name AS created_by_name, m.business_name
       FROM stock_transfers t
       JOIN warehouses wf ON wf.id = t.from_warehouse_id
       JOIN warehouses wt ON wt.id = t.to_warehouse_id
       JOIN merchants m ON m.id = t.merchant_id
       LEFT JOIN users uc ON uc.id = t.created_by
       WHERE t.id = $1 AND t.merchant_id = $2`,
      [req.params.id, req.user.merchantId]
    );
    const transfert = result.rows[0];
    if (!transfert) return res.status(404).json({ error: 'Transfert introuvable.' });
    if (req.user.role === 'gerant' && req.user.warehouseId !== transfert.from_warehouse_id && req.user.warehouseId !== transfert.to_warehouse_id) {
      return res.status(403).json({ error: 'Ce transfert ne concerne pas votre boutique.' });
    }

    const articles = await pool.query(
      `SELECT p.name AS product_name, ti.quantity
       FROM stock_transfer_items ti JOIN products p ON p.id = ti.product_id
       WHERE ti.transfer_id = $1 ORDER BY p.name`,
      [transfert.id]
    );

    const ref = String(transfert.id).replace(/-/g, '').slice(0, 8).toUpperCase();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="bon-transfert-${ref}.pdf"`);
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.on('error', (e) => console.error('pdfkit (bon de transfert) :', e));
    doc.pipe(res);
    dessinerBonTransfert(doc, { commerce: transfert.business_name, transfert, articles: articles.rows });
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
