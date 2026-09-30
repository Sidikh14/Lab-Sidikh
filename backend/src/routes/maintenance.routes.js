const express = require('express');
const { getMaintenance } = require('../middleware/maintenance');

const router = express.Router();

const SECTEURS_VALIDES = ['grossiste', 'pharmacie', 'electromenager', 'textile'];

// GET /maintenance/status?sector=pharmacie — public (sans token) : utilisé
// par la page maintenance.html pour savoir si elle doit rester affichée.
router.get('/status', async (req, res) => {
  const sector = String(req.query.sector || '');
  res.set('Cache-Control', 'no-store');
  if (!SECTEURS_VALIDES.includes(sector)) {
    return res.json({ enabled: false, message: null, returnAt: null });
  }
  const etat = await getMaintenance(sector);
  res.json({ enabled: etat.enabled, message: etat.message || null, returnAt: etat.returnAt || null });
});

module.exports = router;
