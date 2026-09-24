/**
 * Import de la Liste Nationale des Médicaments et Produits Essentiels (LNMPE 2022)
 * dans la table "products" d'un commerçant pharmacie.
 *
 * Pas de warehouse_id : products est partagé au niveau du commerçant ; le stock
 * par boutique se pose ensuite via une session d'inventaire (workflow déjà en place).
 *
 * Usage (depuis le dossier backend/) :
 *   node scripts/import_lnmpe_products.js <merchantId>
 *
 * Si NODE_ENV n'est pas déjà "production" dans ton environnement, force-le pour
 * que db.js active le SSL exigé par Render :
 *   $env:NODE_ENV="production"; node scripts/import_lnmpe_products.js <merchantId>
 */

const fs = require('fs');
const path = require('path');
const pool = require('../src/config/db');

const DATA_FILE = path.join(__dirname, 'lnmpe_medicaments_import.json');

async function main() {
  const merchantId = process.argv[2];
  if (!merchantId) {
    console.error('Usage: node import_lnmpe_products.js <merchantId>');
    process.exit(1);
  }

  const items = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  const client = await pool.connect();
  let inserted = 0, skipped = 0;

  try {
    await client.query('BEGIN');
    for (const item of items) {
      const exists = await client.query(
        'SELECT id FROM products WHERE merchant_id = $1 AND sku = $2',
        [merchantId, item.sku]
      );
      if (exists.rows.length) { skipped++; continue; }

      await client.query(
        `INSERT INTO products
           (merchant_id, name, sku, unit_price, quantity_alert_threshold,
            is_weighted, tva_applicable, is_activated, is_vital,
            requires_prescription, requires_cold_chain, attributes)
         VALUES ($1, $2, $3, 0, 5, false, true, false, true, false, false, $4::jsonb)`,
        [merchantId, item.name, item.sku, JSON.stringify(item.attributes)]
      );
      inserted++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Erreur, rollback effectué :', e);
    process.exit(1);
  } finally {
    client.release();
  }

  console.log(`Import terminé : ${inserted} produits insérés, ${skipped} déjà présents (ignorés).`);
  console.log('is_activated = false : ces produits resteront invisibles en stock/ventes');
  console.log('jusqu\'à la session d\'inventaire de chaque boutique (comme prévu).');
  console.log('tva_applicable = true par défaut (colonne existante), unit_price = 0 : à ajuster ensuite.');
}

main().then(() => process.exit(0));
