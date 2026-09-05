// Exécute schema.sql sur la base de données, sans avoir besoin d'installer psql.
//
// Usage :
//   node scripts/run-schema.js "postgresql://...url-externe-copiée-sur-render..."
//
// Ou en définissant la variable d'environnement DATABASE_URL avant de lancer :
//   set DATABASE_URL=postgresql://...   (PowerShell : $env:DATABASE_URL="...")
//   node scripts/run-schema.js

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const connectionString = process.argv[2] || process.env.DATABASE_URL;

if (!connectionString) {
  console.error("Fournissez l'URL de connexion en argument, ou via la variable DATABASE_URL.");
  process.exit(1);
}

const schemaPath = path.join(__dirname, '..', 'schema.sql');
const schemaSql = fs.readFileSync(schemaPath, 'utf8');

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  await client.connect();
  console.log('Connecté à la base. Exécution de schema.sql...');
  await client.query(schemaSql);
  console.log('Schéma appliqué avec succès.');
  await client.end();
}

run().catch((err) => {
  console.error("Échec de l'exécution du schéma :");
  console.error(err.message);
  process.exit(1);
});
