// Exécute n'importe quel fichier .sql sur la base, sans avoir besoin de psql.
//
// Usage :
//   node scripts/run-sql.js <chemin-du-fichier-sql> "postgresql://...url-externe..."
//
// Exemples :
//   node scripts/run-sql.js schema.sql "postgresql://..."
//   node scripts/run-sql.js migrations/002_fournisseurs_achats_tva_permissions.sql "postgresql://..."

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const sqlFile = process.argv[2];
const connectionString = process.argv[3] || process.env.DATABASE_URL;

if (!sqlFile || !connectionString) {
  console.error('Usage : node scripts/run-sql.js <fichier.sql> "URL_DE_CONNEXION"');
  process.exit(1);
}

const sqlPath = path.isAbsolute(sqlFile) ? sqlFile : path.join(__dirname, '..', sqlFile);
const sql = fs.readFileSync(sqlPath, 'utf8');

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  await client.connect();
  console.log(`Connecté à la base. Exécution de ${sqlFile}...`);
  await client.query(sql);
  console.log('Terminé avec succès.');
  await client.end();
}

run().catch((err) => {
  console.error("Échec de l'exécution du fichier SQL :");
  console.error(err.message);
  process.exit(1);
});
