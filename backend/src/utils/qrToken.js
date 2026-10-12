// Jeton non devinable pour le QR code d'une table (dining_tables.qr_token).
const crypto = require('crypto');

function genererQrToken() {
  return crypto.randomBytes(24).toString('base64url');
}

module.exports = { genererQrToken };
