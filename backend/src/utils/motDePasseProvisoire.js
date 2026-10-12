const crypto = require('crypto');

// Caractères sans ambiguïté (pas de 0/O, 1/l/I) pour faciliter la transmission orale.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

function genererMotDePasseProvisoire(longueur = 10) {
  const octets = crypto.randomBytes(longueur);
  let mdp = '';
  for (let i = 0; i < longueur; i++) mdp += ALPHABET[octets[i] % ALPHABET.length];
  return mdp;
}

module.exports = { genererMotDePasseProvisoire };
