// Restreint l'accès à une route à une liste de rôles autorisés.
// Usage : router.delete('/products/:id', authenticate, requireRole('manager', 'gerant'), handler)
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: "Vous n'avez pas les droits nécessaires pour cette action.",
      });
    }
    next();
  };
}

module.exports = { requireRole };
