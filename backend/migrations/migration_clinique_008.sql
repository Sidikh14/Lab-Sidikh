-- =====================================================================
-- Migration clinique 008 — étape 8 (hospitalisation, urgences)
-- À exécuter dans Neon après migration_clinique_007.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- LITS (rattachés à un service = warehouses)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinic_beds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  service_id uuid NOT NULL REFERENCES warehouses(id),
  numero varchar(20) NOT NULL,
  tarif_journalier numeric(12, 2) NOT NULL CHECK (tarif_journalier >= 0),
  statut varchar(15) NOT NULL DEFAULT 'libre'
    CHECK (statut IN ('libre', 'occupe', 'nettoyage', 'hors_service')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, numero)
);

-- ---------------------------------------------------------------------
-- ADMISSIONS (hospitalisation)
-- Le tarif journalier est figé à l'admission : un changement de tarif ultérieur ne modifie pas le séjour.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinic_admissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  bed_id uuid NOT NULL REFERENCES clinic_beds(id),
  service_id uuid NOT NULL REFERENCES warehouses(id),
  medecin_id uuid NOT NULL REFERENCES users(id),
  motif text NOT NULL,
  tarif_journalier numeric(12, 2) NOT NULL CHECK (tarif_journalier >= 0),
  caution_montant numeric(12, 2) NOT NULL DEFAULT 0 CHECK (caution_montant >= 0),
  caution_moyen varchar(20),
  caution_restituee boolean NOT NULL DEFAULT false,
  admitted_at timestamptz NOT NULL DEFAULT now(),
  discharged_at timestamptz,
  montant_sejour numeric(12, 2),
  statut varchar(12) NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'sorti')),
  created_by uuid REFERENCES users(id),
  CHECK ((statut = 'sorti') = (discharged_at IS NOT NULL))
);

-- Un lit ne peut avoir qu'un seul séjour en cours.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_admission_lit_en_cours ON clinic_admissions (bed_id) WHERE statut = 'en_cours';
CREATE INDEX IF NOT EXISTS idx_admissions_client ON clinic_admissions (merchant_id, client_id, admitted_at);

-- ---------------------------------------------------------------------
-- SURVEILLANCE (constantes et notes infirmières pendant le séjour) — insertion seule
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinic_surveillance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES clinic_admissions(id),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  constantes jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_surveillance_admission ON clinic_surveillance (admission_id, created_at);

CREATE OR REPLACE FUNCTION surveillance_immuable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Une entrée de surveillance ne peut être ni modifiée ni supprimée.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_surveillance_immuable ON clinic_surveillance;
CREATE TRIGGER trg_surveillance_immuable
  BEFORE UPDATE OR DELETE ON clinic_surveillance
  FOR EACH ROW EXECUTE FUNCTION surveillance_immuable();

-- ---------------------------------------------------------------------
-- URGENCES : passages avec triage (1 = immédiat … 5 = non urgent)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinic_urgences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  client_id uuid REFERENCES clients(id),
  nom_patient varchar(200) NOT NULL,
  triage_niveau smallint NOT NULL CHECK (triage_niveau BETWEEN 1 AND 5),
  motif text,
  statut varchar(15) NOT NULL DEFAULT 'attente'
    CHECK (statut IN ('attente', 'en_soins', 'observation', 'sorti', 'transfere', 'hospitalise')),
  medecin_id uuid REFERENCES users(id),
  admission_id uuid REFERENCES clinic_admissions(id),
  arrived_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_by uuid REFERENCES users(id),
  CHECK ((statut IN ('sorti', 'transfere', 'hospitalise')) = (closed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_urgences_salle ON clinic_urgences (merchant_id, statut, triage_niveau, arrived_at);

-- ---------------------------------------------------------------------
-- Vérification
-- ---------------------------------------------------------------------
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('clinic_beds', 'clinic_admissions', 'clinic_surveillance', 'clinic_urgences');
