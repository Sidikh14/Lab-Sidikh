// Gestion des lots (pharmacie) : entrée de lot + décrément FEFO
// (First Expired, First Out) à la vente. Additif par rapport à
// product_stock, qui reste la source de vérité du total en stock — ce
// module ne fait que répartir/consommer ce total à l'intérieur des lots
// quand des lots existent pour le produit.

// Ajoute un lot lors d'une entrée de stock. À appeler uniquement pour les
// commerçants du secteur pharmacie et uniquement si l'appelant a fourni
// une date de péremption (sinon on ne force rien — champ facultatif tant
// que l'utilisateur ne l'a pas renseigné côté frontend).
async function addLot(client, { merchantId, productId, warehouseId, lotNumber, expiryDate, quantity }) {
  if (!expiryDate || !Number(quantity) || Number(quantity) <= 0) return null;
  const result = await client.query(
    `INSERT INTO product_lots (merchant_id, product_id, warehouse_id, lot_number, expiry_date, quantity)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [merchantId, productId, warehouseId, lotNumber || null, expiryDate, Number(quantity)]
  );
  return result.rows[0];
}

// Consomme `quantity` unités en FEFO parmi les lots NON périmés du produit
// dans cette boutique. Si le produit n'a aucun lot enregistré (stock
// géré à l'ancienne, sans suivi de péremption), retourne
// { tracked: false } et n'empêche pas la vente — comportement inchangé.
// Si des lots existent mais que le total NON périmé est insuffisant,
// retourne { tracked: true, ok: false } : à l'appelant de bloquer la
// vente plutôt que de vendre un produit périmé.
async function consumeFEFO(client, { merchantId, productId, warehouseId, quantity }) {
  const lotsResult = await client.query(
    `SELECT id, quantity, expiry_date FROM product_lots
     WHERE merchant_id = $1 AND product_id = $2 AND warehouse_id = $3 AND quantity > 0
     ORDER BY expiry_date ASC
     FOR UPDATE`,
    [merchantId, productId, warehouseId]
  );

  if (lotsResult.rows.length === 0) {
    return { tracked: false, ok: true };
  }

  const aujourdHui = new Date().toISOString().slice(0, 10);
  const lotsValides = lotsResult.rows.filter((l) => l.expiry_date.toISOString().slice(0, 10) >= aujourdHui);
  const totalValide = lotsValides.reduce((s, l) => s + Number(l.quantity), 0);

  if (totalValide < Number(quantity)) {
    return { tracked: true, ok: false, disponibleNonPerime: totalValide };
  }

  let reste = Number(quantity);
  const consommes = [];
  for (const lot of lotsValides) {
    if (reste <= 0) break;
    const pris = Math.min(reste, Number(lot.quantity));
    await client.query(`UPDATE product_lots SET quantity = quantity - $1 WHERE id = $2`, [pris, lot.id]);
    consommes.push({ lotId: lot.id, quantity: pris, expiryDate: lot.expiry_date });
    reste -= pris;
  }

  return { tracked: true, ok: true, consommes };
}

module.exports = { addLot, consumeFEFO };
