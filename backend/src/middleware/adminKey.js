// Protège la création d'un nouveau commerce : seule une personne connaissant
// la clé secrète ADMIN_REGISTRATION_KEY peut créer un compte commerçant.
// Les commerçants existants créent ensuite leurs propres gérants/vendeurs
// via /users, qui ne nécessite pas cette clé.
function requireAdminKey(req, res, next) {
  const expected = process.env.ADMIN_REGISTRATION_KEY;

  if (!expected) {
    return res.status(500).json({
      error: "L'inscription est désactivée : ADMIN_REGISTRATION_KEY n'est pas configurée.",
    });
  }

  const provided = req.headers['x-admin-key'];
  if (provided !== expected) {
    return res.status(403).json({ error: "Clé d'administration invalide." });
  }

  next();
}

module.exports = { requireAdminKey };
