-- =====================================================================
-- Migration clinique 002 — étape 2 (patients, dossier léger)
-- À exécuter dans Neon après migration_clinique_001.sql.
-- =====================================================================

-- Dossier léger : un seul par patient (fiche clients). Les fiches propres
-- à chaque module (consultations, labo, maternité…) viendront dans des
-- tables séparées aux étapes suivantes.
CREATE TABLE IF NOT EXISTS patient_dossiers (
  client_id uuid PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  allergies text,
  antecedents text,
  groupe_sanguin varchar(5) CHECK (groupe_sanguin IS NULL OR groupe_sanguin IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  notes_generales text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_patient_dossiers_merchant ON patient_dossiers (merchant_id);

-- Recherche de doublons à l'inscription d'un patient (étape 2, K2).
CREATE INDEX IF NOT EXISTS idx_clients_merchant_phone ON clients (merchant_id, phone);

-- Vérification
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('patient_dossiers', 'access_log', 'clinic_modules');
