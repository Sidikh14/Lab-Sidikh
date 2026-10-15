// Contrôle d'accès propre au secteur clinique (dossier H3, module K3).
//
// Séparé de middleware/roles.js : requireRole ne regarde que le rôle, alors que la clinique
// a besoin de droits par ressource (ex. un laborantin saisit les résultats sans voir le reste du dossier).
// Ce middleware ne s'applique qu'aux routes du secteur « clinique » ; les autres secteurs ne sont pas touchés.
//
// Usage :
//   router.get('/patients/:patientId/dossier', authenticate, requireClinique('dossier_medical', 'lire', { patient: 'patientId' }), handler)
//   router.post('/patients/:patientId/urgence', authenticate, requireClinique('dossier_medical', 'lire', { patient: 'patientId', urgence: true }), handler)

const pool = require('../config/db');
const { creerAlerte, getNomUtilisateur } = require('../services/alerts.service');
const { aRole } = require('./roles');

// Ressources et droits. Une action est autorisée si au moins un rôle de l'utilisateur la possède.
//   lire / ecrire : accès aux données de la ressource
//   lire_journal  : consultation du journal d'accès (manager uniquement)
const MATRICE = {
  identite_patient: {
    lire: ['medecin', 'infirmier', 'sage_femme', 'laborantin', 'accueil', 'caissier', 'gerant', 'manager'],
    ecrire: ['accueil', 'gerant', 'manager'],
  },
  dossier_medical: {
    // Médecin : tous les dossiers de la clinique (chaque ouverture journalisée).
    // Infirmier et sage-femme : limités à leur service (contrôle de périmètre à ajouter, voir plus bas).
    lire: ['medecin', 'infirmier', 'sage_femme'],
    ecrire: ['medecin', 'infirmier', 'sage_femme'],
  },
  resultats_examens: {
    lire: ['medecin', 'laborantin', 'infirmier', 'sage_femme'],
    ecrire: ['laborantin'],
    valider: ['medecin'],
  },
  facturation: {
    lire: ['caissier', 'accueil', 'gerant', 'manager'],
    ecrire: ['caissier', 'gerant', 'manager'],
  },
  journal_acces: {
    lire_journal: ['manager'],
  },
};

// Rôles pour lesquels un accès ponctuel « urgence » est possible (un soignant hors de son périmètre).
const ROLES_URGENCE = ['medecin', 'infirmier', 'sage_femme'];

function estAutorise(roles, ressource, action) {
  const autorises = (MATRICE[ressource] && MATRICE[ressource][action]) || [];
  return autorises.some((role) => aRole({ roles, role: null }, role));
}

// Journal d'accès : insertion seule, jamais modifiable ni supprimable depuis l'application.
async function journaliser({ merchantId, userId, patientId, action, urgence, motif }) {
  await pool.query(
    `INSERT INTO access_log (merchant_id, user_id, patient_id, action, urgence, motif, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [merchantId, userId, patientId || null, action, Boolean(urgence), motif || null]
  );
}

// requireClinique(ressource, action, options)
//   options.patient : nom du paramètre de route contenant l'id du patient (ex. 'patientId'), pour journaliser
//   options.urgence : true si la route accepte un accès d'urgence (motif obligatoire)
function requireClinique(ressource, action, options = {}) {
  return async (req, res, next) => {
    try {
      if (req.user.sector !== 'clinique') {
        return res.status(403).json({ error: 'Cette fonction est réservée à la clinique.' });
      }

      const roles = req.user.roles || [];
      const patientId = options.patient ? req.params[options.patient] : null;
      const lectureDossier = ressource === 'dossier_medical' && (action === 'lire' || action === 'ecrire');

      if (estAutorise(roles, ressource, action)) {
        if (lectureDossier) {
          await journaliser({ merchantId: req.user.merchantId, userId: req.user.id, patientId, action });
        }
        req.clinique = { urgence: false };
        return next();
      }

      // Accès d'urgence : soignant hors périmètre, motif obligatoire, alerte immédiate au manager.
      const peutUrgence = options.urgence && ROLES_URGENCE.some((r) => roles.includes(r));
      if (peutUrgence) {
        const motif = typeof req.body?.motif === 'string' ? req.body.motif.trim() : '';
        if (!motif) {
          return res.status(400).json({ error: "Un motif est obligatoire pour un accès d'urgence." });
        }
        await journaliser({ merchantId: req.user.merchantId, userId: req.user.id, patientId, action, urgence: true, motif });

        const nom = await getNomUtilisateur(req.user.id).catch(() => null);
        creerAlerte({
          merchantId: req.user.merchantId,
          type: 'acces_urgence',
          titre: "Accès d'urgence au dossier",
          message: `${nom || 'Un soignant'} a ouvert un dossier en urgence. Motif : ${motif}`,
          referenceId: patientId,
          roles: ['manager'],
        }).catch((err) => console.error('Erreur alerte acces_urgence :', err));

        req.clinique = { urgence: true, motif };
        return next();
      }

      return res.status(403).json({ error: "Vous n'avez pas accès à cette ressource." });
    } catch (err) {
      console.error('Erreur requireClinique :', err);
      res.status(500).json({ error: "Erreur de contrôle d'accès." });
    }
  };
}

module.exports = { requireClinique, MATRICE, ROLES_URGENCE };
