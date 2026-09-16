const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();
router.use(authenticate);

// GET /merchant/profile — informations de l'entreprise, affichées sur les
// factures (logo, NINEA, RCCM, adresse, coordonnées bancaires/Mobile Money,
// conditions de règlement). Manager et gérant peuvent consulter.
router.get('/profile', requireRole('manager', 'gerant'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT business_name, currency, ninea, rccm, address, bank_details, mobile_money_details, payment_terms, logo_data
       FROM merchants WHERE id = $1`,
      [req.user.merchantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Commerce introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la récupération des informations de l'entreprise." });
  }
});

// PATCH /merchant/profile — manager uniquement met à jour ces informations.
// Le logo (logoData) est une image encodée en base64 (data URI PNG/JPEG) ;
// s'il n'est pas renvoyé (chaîne vide), le logo existant est conservé — pas
// besoin de le renvoyer à chaque modification d'un autre champ.
router.patch('/profile', requireRole('manager'), async (req, res) => {
  const { ninea, rccm, address, bankDetails, mobileMoneyDetails, paymentTerms, logoData } = req.body;

  if (logoData && !/^data:image\/(png|jpe?g);base64,/.test(logoData)) {
    return res.status(400).json({ error: 'Format de logo invalide (PNG ou JPEG requis).' });
  }
  // ~2 Mo de texte base64 (environ 1,5 Mo d'image décodée) : largement
  // suffisant pour un logo, sans gonfler démesurément la base.
  if (logoData && logoData.length > 2_000_000) {
    return res.status(400).json({ error: 'Le logo est trop volumineux (2 Mo maximum).' });
  }

  try {
    const result = await pool.query(
      `UPDATE merchants SET
         ninea = $1, rccm = $2, address = $3, bank_details = $4,
         mobile_money_details = $5, payment_terms = $6,
         logo_data = COALESCE(NULLIF($7, ''), logo_data)
       WHERE id = $8
       RETURNING business_name, currency, ninea, rccm, address, bank_details, mobile_money_details, payment_terms, logo_data`,
      [ninea || null, rccm || null, address || null, bankDetails || null, mobileMoneyDetails || null, paymentTerms || null, logoData || '', req.user.merchantId]
    );

    await logActivity({
      merchantId: req.user.merchantId,
      userId: req.user.id,
      action: 'merchant_profile_updated',
      description: "a mis à jour les informations de l'entreprise",
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la mise à jour des informations de l'entreprise." });
  }
});

module.exports = router;
