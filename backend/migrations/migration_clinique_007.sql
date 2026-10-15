-- =====================================================================
-- Migration clinique 007 — étape 7 (laboratoire, imagerie, pièces jointes)
-- À exécuter dans Neon après migration_clinique_006.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- DEMANDES D'EXAMENS (prescrites par le médecin)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exam_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  consultation_id uuid REFERENCES consultations(id),
  requested_by uuid NOT NULL REFERENCES users(id),
  type varchar(15) NOT NULL CHECK (type IN ('laboratoire', 'imagerie')),
  libelle varchar(200) NOT NULL,
  statut varchar(15) NOT NULL DEFAULT 'demande'
    CHECK (statut IN ('demande', 'en_cours', 'termine', 'annule')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_requests_worklist ON exam_requests (merchant_id, type, statut, created_at);
CREATE INDEX IF NOT EXISTS idx_exam_requests_client ON exam_requests (merchant_id, client_id, created_at);

-- ---------------------------------------------------------------------
-- RÉSULTATS
-- saisi  : modifiable par le laborantin
-- valide : figé, validé par le médecin (plus aucune modification du contenu)
-- publie : visible du patient sur le portail (publication volontaire, H4)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exam_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES exam_requests(id),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  valeurs jsonb NOT NULL DEFAULT '[]'::jsonb,
  interpretation text,
  statut varchar(10) NOT NULL DEFAULT 'saisi' CHECK (statut IN ('saisi', 'valide', 'publie')),
  saisi_par uuid NOT NULL REFERENCES users(id),
  saisi_at timestamptz NOT NULL DEFAULT now(),
  valide_par uuid REFERENCES users(id),
  valide_at timestamptz,
  publie_par uuid REFERENCES users(id),
  publie_at timestamptz,
  CHECK ((statut = 'saisi') OR valide_at IS NOT NULL),
  CHECK ((statut <> 'publie') OR publie_at IS NOT NULL)
);

-- Un résultat validé ne peut plus changer de contenu. Seule la publication fait évoluer son statut.
CREATE OR REPLACE FUNCTION resultat_verrouille() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.statut <> 'saisi' THEN
      RAISE EXCEPTION 'Un résultat validé ou publié ne peut pas être supprimé.';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.statut <> 'saisi' AND (NEW.valeurs IS DISTINCT FROM OLD.valeurs OR NEW.interpretation IS DISTINCT FROM OLD.interpretation) THEN
    RAISE EXCEPTION 'Résultat validé : son contenu ne peut plus être modifié.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_resultat_verrouille ON exam_results;
CREATE TRIGGER trg_resultat_verrouille
  BEFORE UPDATE OR DELETE ON exam_results
  FOR EACH ROW EXECUTE FUNCTION resultat_verrouille();

-- ---------------------------------------------------------------------
-- PIÈCES JOINTES (H8 : dans la base, 1,5 Mo maximum, pas de DICOM)
-- Insertion et lecture seulement : une pièce jointe ne se modifie pas.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exam_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  request_id uuid REFERENCES exam_requests(id),
  file_name varchar(200) NOT NULL,
  mime_type varchar(40) NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  taille_octets integer NOT NULL CHECK (taille_octets > 0 AND taille_octets <= 1572864),
  contenu bytea NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_attachments_client ON exam_attachments (merchant_id, client_id, created_at);

CREATE OR REPLACE FUNCTION piece_jointe_immuable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Une pièce jointe ne peut être ni modifiée ni supprimée.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_piece_jointe_immuable ON exam_attachments;
CREATE TRIGGER trg_piece_jointe_immuable
  BEFORE UPDATE OR DELETE ON exam_attachments
  FOR EACH ROW EXECUTE FUNCTION piece_jointe_immuable();

-- ---------------------------------------------------------------------
-- Vérification
-- ---------------------------------------------------------------------
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('exam_requests', 'exam_results', 'exam_attachments');
