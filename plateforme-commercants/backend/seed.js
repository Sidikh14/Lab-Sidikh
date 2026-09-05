// Script de données de démonstration.
// Usage :
//   local  : npm run seed
//   Render : définir DATABASE_URL (URL externe de commercants-db) puis
//            exécuter `node seed.js` depuis votre machine, ou lancer
//            un "Job" ponctuel depuis le tableau de bord Render.
//
// Ce script est idempotent sur l'email du commerce démo : le relancer
// plusieurs fois échouera proprement si le commerce existe déjà, plutôt
// que de dupliquer les données.

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./src/config/db');

const MOT_DE_PASSE_DEMO = 'Demo1234!';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const merchantResult = await client.query(
      `INSERT INTO merchants (business_name, sector, email, currency)
       VALUES ('Épicerie Fatou', 'Alimentation', 'demo@epicerie-fatou.sn', 'XOF')
       RETURNING id`
    );
    const merchantId = merchantResult.rows[0].id;

    const passwordHash = await bcrypt.hash(MOT_DE_PASSE_DEMO, 10);

    const usersResult = await client.query(
      `INSERT INTO users (merchant_id, full_name, email, password_hash, role)
       VALUES
         ($1, 'Fatou Ndiaye', 'manager@epicerie-fatou.sn', $2, 'manager'),
         ($1, 'Cheikh Ba', 'gerant@epicerie-fatou.sn', $2, 'gerant'),
         ($1, 'Aminata Sow', 'vendeur@epicerie-fatou.sn', $2, 'vendeur')
       RETURNING id, role`,
      [merchantId, passwordHash]
    );
    const vendeurId = usersResult.rows.find((u) => u.role === 'vendeur').id;

    const categoryResult = await client.query(
      `INSERT INTO categories (merchant_id, name) VALUES ($1, 'Épicerie') RETURNING id`,
      [merchantId]
    );
    const categoryId = categoryResult.rows[0].id;

    const productsResult = await client.query(
      `INSERT INTO products (merchant_id, category_id, name, sku, unit_price, quantity_in_stock, quantity_alert_threshold)
       VALUES
         ($1, $2, 'Riz brisé 25kg', 'RIZ-25', 15000, 4, 5),
         ($1, $2, 'Huile 1L', 'HUI-1L', 1200, 11, 10),
         ($1, $2, 'Savon Konkoré', 'SAV-KK', 500, 58, 15)
       RETURNING id, name, unit_price`,
      [merchantId, categoryId]
    );
    const produitVendu = productsResult.rows[0];

    const clientResult = await client.query(
      `INSERT INTO clients (merchant_id, full_name, phone)
       VALUES ($1, 'Aïcha Diallo', '+221 77 000 00 00') RETURNING id`,
      [merchantId]
    );
    const clientId = clientResult.rows[0].id;

    const orderResult = await client.query(
      `INSERT INTO orders (merchant_id, client_id, created_by, status, total_amount)
       VALUES ($1, $2, $3, 'en_attente', $4) RETURNING id`,
      [merchantId, clientId, vendeurId, produitVendu.unit_price * 2]
    );
    await client.query(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
       VALUES ($1, $2, 2, $3)`,
      [orderResult.rows[0].id, produitVendu.id, produitVendu.unit_price]
    );

    await client.query('COMMIT');

    console.log('Données de démonstration créées avec succès.\n');
    console.log('Connexion (mot de passe identique pour les 3 comptes) :');
    console.log(`  Mot de passe : ${MOT_DE_PASSE_DEMO}\n`);
    console.log('  manager@epicerie-fatou.sn   (rôle manager)');
    console.log('  gerant@epicerie-fatou.sn    (rôle gerant)');
    console.log('  vendeur@epicerie-fatou.sn   (rôle vendeur)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Échec du seed — les données n'ont pas été insérées.");
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
