// Réinitialise le mot de passe d'un compte, identifié par son email.
//
// Usage : node scripts/reset-password.js <email> <nouveau_mot_de_passe> "URL_DE_CONNEXION"

const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const [, , email, newPassword, connArg] = process.argv;
const connectionString = connArg || process.env.DATABASE_URL;

if (!email || !newPassword || !connectionString) {
  console.error('Usage : node scripts/reset-password.js <email> <nouveau_mot_de_passe> "URL_DE_CONNEXION"');
  process.exit(1);
}

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

async function run() {
  await client.connect();
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const result = await client.query(
    `UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING full_name, email`,
    [passwordHash, email]
  );

  if (result.rows.length === 0) {
    console.log(`Aucun compte trouvé avec l'email ${email}.`);
  } else {
    console.log(`Mot de passe mis à jour pour ${result.rows[0].full_name} (${result.rows[0].email}).`);
  }

  await client.end();
}

run().catch((err) => {
  console.error('Erreur :', err.message);
  process.exit(1);
});
