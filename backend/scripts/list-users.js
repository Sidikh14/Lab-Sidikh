// Liste les comptes existants (email, rôle, commerce) sans jamais afficher
// de mot de passe — ils sont chiffrés et irrécupérables, mais réinitialisables.
//
// Usage : node scripts/list-users.js "URL_DE_CONNEXION"

const { Client } = require('pg');

const connectionString = process.argv[2] || process.env.DATABASE_URL;

if (!connectionString) {
  console.error('Usage : node scripts/list-users.js "URL_DE_CONNEXION"');
  process.exit(1);
}

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

async function run() {
  await client.connect();
  const result = await client.query(`
    SELECT u.full_name, u.email, u.role, u.is_active, m.business_name
    FROM users u
    JOIN merchants m ON m.id = u.merchant_id
    ORDER BY m.business_name, u.role
  `);

  if (result.rows.length === 0) {
    console.log('Aucun compte trouvé sur cette base.');
  } else {
    console.log('');
    result.rows.forEach((u) => {
      console.log(`${u.business_name} — ${u.full_name} (${u.email}) — ${u.role}${u.is_active ? '' : ' [désactivé]'}`);
    });
    console.log('');
    console.log(`${result.rows.length} compte(s) trouvé(s).`);
  }

  await client.end();
}

run().catch((err) => {
  console.error('Erreur :', err.message);
  process.exit(1);
});
