const { Pool } = require('pg');

// Render Postgres exige une connexion chiffrée. On l'active uniquement en
// production pour ne pas gêner une base locale en développement.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Erreur inattendue sur le pool PostgreSQL', err);
  process.exit(1);
});

module.exports = pool;
