-- =====================================================================
-- Migration clinique 001 — étape 1 (socle)
-- À exécuter DANS NEON, en lançant CHAQUE « ALTER TYPE » SEUL,
-- sans BEGIN/COMMIT autour (ADD VALUE ne peut pas être dans une transaction
-- qui utilise la nouvelle valeur). Le reste peut être lancé bloc par bloc.
-- =====================================================================

-- ---------------------------------------------------------------------
-- BLOC A : valeurs d'enum (une instruction par exécution)
-- ---------------------------------------------------------------------
ALTER TYPE business_sector ADD VALUE IF NOT EXISTS 'clinique';

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'medecin';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'infirmier';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'sage_femme';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'laborantin';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'accueil';

ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'rdv_proche';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'resultat_pret';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'attente_longue';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'vaccin_du';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'accord_expire';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'acces_urgence';

-- ---------------------------------------------------------------------
-- BLOC B : journal d'accès aux données médicales (insertion seule)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  patient_id uuid REFERENCES clients(id),
  action varchar(50) NOT NULL,
  urgence boolean NOT NULL DEFAULT false,
  motif text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_log_merchant_date ON access_log (merchant_id, created_at);

CREATE OR REPLACE FUNCTION access_log_immuable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Le journal d''accès ne peut être ni modifié ni supprimé.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_access_log_immuable ON access_log;
CREATE TRIGGER trg_access_log_immuable
  BEFORE UPDATE OR DELETE ON access_log
  FOR EACH ROW EXECUTE FUNCTION access_log_immuable();

-- ---------------------------------------------------------------------
-- BLOC C : interrupteurs de modules de la clinique (table dédiée)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinic_modules (
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  module varchar(40) NOT NULL CHECK (module IN (
    'rendez_vous', 'laboratoire_imagerie', 'hospitalisation',
    'maternite', 'urgences', 'vaccination', 'portail_patient'
  )),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id),
  PRIMARY KEY (merchant_id, module)
);

-- ---------------------------------------------------------------------
-- Vérification finale (doit renvoyer les 6 nouvelles valeurs de alert_type
-- et les 5 nouvelles valeurs de user_role, plus 'clinique' pour business_sector)
-- ---------------------------------------------------------------------
SELECT t.typname, e.enumlabel
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN ('user_role', 'business_sector', 'alert_type')
ORDER BY t.typname, e.enumsortorder;
