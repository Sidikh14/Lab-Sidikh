-- =====================================================================
-- Migration clinique 009 — étape 9 (maternité, vaccination, planning et gardes)
-- À exécuter dans Neon après migration_clinique_008.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- MATERNITÉ : grossesse, visites prénatales, accouchement, nouveau-né
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pregnancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  date_prevue_accouchement date NOT NULL,
  statut varchar(12) NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'accouchee', 'interrompue')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CHECK ((statut = 'en_cours') = (closed_at IS NULL))
);

-- Une seule grossesse en cours par patiente.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_grossesse_en_cours ON pregnancies (client_id) WHERE statut = 'en_cours';

-- Visites prénatales : append-only.
CREATE TABLE IF NOT EXISTS pregnancy_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pregnancy_id uuid NOT NULL REFERENCES pregnancies(id),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  date_visite date NOT NULL DEFAULT CURRENT_DATE,
  semaine_amenorrhee smallint CHECK (semaine_amenorrhee BETWEEN 0 AND 45),
  poids_kg numeric(5, 2),
  tension varchar(10),
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pregnancy_visits ON pregnancy_visits (pregnancy_id, date_visite);

-- Accouchement : clôt la grossesse.
CREATE TABLE IF NOT EXISTS deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  pregnancy_id uuid NOT NULL UNIQUE REFERENCES pregnancies(id),
  mother_client_id uuid NOT NULL REFERENCES clients(id),
  delivered_at timestamptz NOT NULL,
  mode varchar(15) NOT NULL CHECK (mode IN ('voie_basse', 'cesarienne', 'autre')),
  admission_id uuid REFERENCES clinic_admissions(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Nouveau-né : son propre dossier client (fiche), lié à la mère (H12).
CREATE TABLE IF NOT EXISTS newborns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  delivery_id uuid NOT NULL UNIQUE REFERENCES deliveries(id),
  mother_client_id uuid NOT NULL REFERENCES clients(id),
  client_id uuid NOT NULL UNIQUE REFERENCES clients(id),
  date_naissance timestamptz NOT NULL,
  sexe varchar(12) CHECK (sexe IN ('masculin', 'feminin', 'indetermine')),
  poids_grammes integer CHECK (poids_grammes IS NULL OR poids_grammes BETWEEN 200 AND 8000),
  apgar_1 smallint CHECK (apgar_1 IS NULL OR apgar_1 BETWEEN 0 AND 10),
  apgar_5 smallint CHECK (apgar_5 IS NULL OR apgar_5 BETWEEN 0 AND 10),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Accouchement et nouveau-né : protégés contre la modification (même principe que les consultations signées).
CREATE OR REPLACE FUNCTION maternite_immuable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Un enregistrement de maternité ne peut être ni modifié ni supprimé.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deliveries_immuable ON deliveries;
CREATE TRIGGER trg_deliveries_immuable
  BEFORE UPDATE OR DELETE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION maternite_immuable();

DROP TRIGGER IF EXISTS trg_newborns_immuable ON newborns;
CREATE TRIGGER trg_newborns_immuable
  BEFORE UPDATE OR DELETE ON newborns
  FOR EACH ROW EXECUTE FUNCTION maternite_immuable();

DROP TRIGGER IF EXISTS trg_visites_immuables ON pregnancy_visits;
CREATE TRIGGER trg_visites_immuables
  BEFORE UPDATE OR DELETE ON pregnancy_visits
  FOR EACH ROW EXECUTE FUNCTION maternite_immuable();

-- ---------------------------------------------------------------------
-- VACCINATION : catalogue paramétrable et vaccinations administrées
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vaccine_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  nom varchar(120) NOT NULL,
  nombre_doses smallint NOT NULL DEFAULT 1 CHECK (nombre_doses BETWEEN 1 AND 10),
  age_premiere_dose_jours integer CHECK (age_premiere_dose_jours IS NULL OR age_premiere_dose_jours >= 0),
  delai_entre_doses_jours integer CHECK (delai_entre_doses_jours IS NULL OR delai_entre_doses_jours > 0),
  rappel_jours integer CHECK (rappel_jours IS NULL OR rappel_jours > 0),
  actif boolean NOT NULL DEFAULT true,
  UNIQUE (merchant_id, nom)
);

CREATE TABLE IF NOT EXISTS vaccinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  vaccine_id uuid NOT NULL REFERENCES vaccine_catalog(id),
  dose_numero smallint NOT NULL CHECK (dose_numero >= 1),
  date_administration date NOT NULL,
  lot_numero varchar(50),
  product_lot_id uuid REFERENCES product_lots(id),
  prochain_rappel date,
  administered_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, vaccine_id, dose_numero)
);

CREATE INDEX IF NOT EXISTS idx_vaccinations_client ON vaccinations (merchant_id, client_id, date_administration);

-- Le carnet ne se corrige pas : une erreur se signale par un nouvel enregistrement.
DROP TRIGGER IF EXISTS trg_vaccinations_immuables ON vaccinations;
CREATE TRIGGER trg_vaccinations_immuables
  BEFORE UPDATE OR DELETE ON vaccinations
  FOR EACH ROW EXECUTE FUNCTION maternite_immuable();

-- ---------------------------------------------------------------------
-- PLANNING ET GARDES (K16)
-- Pas deux créneaux qui se chevauchent pour une même personne.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinic_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  service_id uuid REFERENCES warehouses(id),
  user_id uuid NOT NULL REFERENCES users(id),
  debut timestamptz NOT NULL,
  fin timestamptz NOT NULL,
  type varchar(12) NOT NULL CHECK (type IN ('jour', 'nuit', 'garde', 'astreinte')),
  prime numeric(12, 2) NOT NULL DEFAULT 0 CHECK (prime >= 0),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (fin > debut),
  EXCLUDE USING gist (user_id WITH =, tstzrange(debut, fin) WITH &&)
);

CREATE INDEX IF NOT EXISTS idx_shifts_merchant_debut ON clinic_shifts (merchant_id, debut);

-- ---------------------------------------------------------------------
-- Vérification
-- ---------------------------------------------------------------------
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('pregnancies', 'pregnancy_visits', 'deliveries', 'newborns', 'vaccine_catalog', 'vaccinations', 'clinic_shifts');
