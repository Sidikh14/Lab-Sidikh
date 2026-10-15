-- =====================================================================
-- Migration clinique 004 — étape 4 (consultation, prescriptions, documents)
-- À exécuter dans Neon après migration_clinique_003.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- CONSULTATIONS
-- Brouillon modifiable ; une fois signée, elle est verrouillée (trigger ci-dessous).
-- Toute correction ultérieure passe par consultation_addenda.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  practitioner_id uuid NOT NULL REFERENCES users(id),
  appointment_id uuid REFERENCES appointments(id),
  service_id uuid REFERENCES warehouses(id),
  motif text,
  constantes jsonb NOT NULL DEFAULT '{}'::jsonb,
  examen text,
  diagnostic text,
  status varchar(10) NOT NULL DEFAULT 'brouillon' CHECK (status IN ('brouillon', 'signee')),
  signed_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'signee') = (signed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_consultations_client ON consultations (merchant_id, client_id, created_at);

-- Actes réalisés pendant la consultation (tarification : étape 5)
CREATE TABLE IF NOT EXISTS consultation_actes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  libelle varchar(200) NOT NULL,
  quantite integer NOT NULL DEFAULT 1 CHECK (quantite > 0)
);

-- Addenda : ajouts datés et signés à une consultation déjà signée. Insertion seule.
CREATE TABLE IF NOT EXISTS consultation_addenda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES consultations(id),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  auteur_id uuid NOT NULL REFERENCES users(id),
  texte text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Verrouillage : une consultation signée ne peut plus être modifiée ni supprimée.
CREATE OR REPLACE FUNCTION consultation_verrouillee() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'signee' THEN
      RAISE EXCEPTION 'Une consultation signée ne peut pas être supprimée.';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'signee' THEN
    RAISE EXCEPTION 'Consultation signée : utilisez un addendum pour la compléter.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_consultation_verrouillee ON consultations;
CREATE TRIGGER trg_consultation_verrouillee
  BEFORE UPDATE OR DELETE ON consultations
  FOR EACH ROW EXECUTE FUNCTION consultation_verrouillee();

-- Les actes d'une consultation signée ne peuvent plus changer non plus.
CREATE OR REPLACE FUNCTION actes_verrouilles() RETURNS trigger AS $$
DECLARE
  cible uuid;
BEGIN
  cible := COALESCE(NEW.consultation_id, OLD.consultation_id);
  IF EXISTS (SELECT 1 FROM consultations WHERE id = cible AND status = 'signee') THEN
    RAISE EXCEPTION 'Consultation signée : les actes ne peuvent plus être modifiés.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_actes_verrouilles ON consultation_actes;
CREATE TRIGGER trg_actes_verrouilles
  BEFORE INSERT OR UPDATE OR DELETE ON consultation_actes
  FOR EACH ROW EXECUTE FUNCTION actes_verrouilles();

-- Addenda : insertion seule (même principe que access_log).
CREATE OR REPLACE FUNCTION addenda_immuable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Un addendum ne peut être ni modifié ni supprimé.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_addenda_immuable ON consultation_addenda;
CREATE TRIGGER trg_addenda_immuable
  BEFORE UPDATE OR DELETE ON consultation_addenda
  FOR EACH ROW EXECUTE FUNCTION addenda_immuable();

-- ---------------------------------------------------------------------
-- MODÈLES DE DOCUMENTS (modifiables par le médecin et le gérant)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinic_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  type varchar(20) NOT NULL CHECK (type IN ('ordonnance', 'certificat', 'arret_travail', 'compte_rendu')),
  nom varchar(120) NOT NULL,
  corps text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);

-- ---------------------------------------------------------------------
-- DOCUMENTS MÉDICAUX ÉMIS (ordonnance, certificat, arrêt de travail, compte rendu)
-- Numérotés par commerce, par type et par année. Non modifiables une fois émis.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinic_document_counters (
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  type varchar(20) NOT NULL,
  annee integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (merchant_id, type, annee)
);

CREATE TABLE IF NOT EXISTS clinic_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  consultation_id uuid REFERENCES consultations(id),
  type varchar(20) NOT NULL CHECK (type IN ('ordonnance', 'certificat', 'arret_travail', 'compte_rendu')),
  numero varchar(30) NOT NULL,
  contenu jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_clinic_documents_client ON clinic_documents (merchant_id, client_id, created_at);

CREATE OR REPLACE FUNCTION document_immuable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Un document émis ne peut être ni modifié ni supprimé. Émettez un nouveau document.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_document_immuable ON clinic_documents;
CREATE TRIGGER trg_document_immuable
  BEFORE UPDATE OR DELETE ON clinic_documents
  FOR EACH ROW EXECUTE FUNCTION document_immuable();

-- ---------------------------------------------------------------------
-- Vérification
-- ---------------------------------------------------------------------
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('consultations', 'consultation_actes', 'consultation_addenda', 'clinic_templates', 'clinic_documents', 'clinic_document_counters');
