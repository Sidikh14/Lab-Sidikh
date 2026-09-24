const pool = require('../src/config/db');

async function main() {
  const res = await pool.query('SELECT * FROM merchants LIMIT 3');
  console.table(res.rows);
  process.exit(0);
}

main();