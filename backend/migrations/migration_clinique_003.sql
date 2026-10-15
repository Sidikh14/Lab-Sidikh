-- =====================================================================
-- Migration clinique 003 — étape 3 (rendez-vous, liste d'attente, file)
-- À exécuter dans Neon après migration_clinique_002.sql.
-- =====================================================================

-- Extension nécessaire pour la contrainte d'absence de chevauchement (EXCLUDE sur uuid + plage horaire).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------
-- RENDEZ-VOUS
-- practitioner_id = un utilisateur soignant (médecin) ; service_id = le service (warehouses).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  practitioner_id uuid REFERENCES users(id),
  service_id uuid REFERENCES warehouses(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  motif text,
  status varchar(20) NOT NULL DEFAULT 'planifie'
    CHECK (status IN ('planifie', 'arrive', 'en_consultation', 'termine', 'annule', 'absent')),
  reminder_sent_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

-- Deux rendez-vous ne peuvent jamais se chevaucher pour un même praticien (protection au niveau base,
-- en plus du contrôle dans l'application). Les rendez-vous annulés ou absents ne comptent plus.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_no_overlap') THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
      EXCLUDE USING gist (practitioner_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
      WHERE (status NOT IN ('annule', 'absent') AND practitioner_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_appointments_merchant_start ON appointments (merchant_id, starts_at);

-- ---------------------------------------------------------------------
-- LISTE D'ATTENTE (créneau souhaité non disponible)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  practitioner_id uuid REFERENCES users(id),
  service_id uuid REFERENCES warehouses(id),
  motif text,
  status varchar(15) NOT NULL DEFAULT 'en_attente'
    CHECK (status IN ('en_attente', 'planifie', 'retire')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_merchant_status ON waitlist (merchant_id, status);

-- ---------------------------------------------------------------------
-- FILE D'ATTENTE : tickets numérotés par service et par jour
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS queue_counters (
  service_id uuid NOT NULL REFERENCES warehouses(id),
  ticket_date date NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (service_id, ticket_date)
);

CREATE TABLE IF NOT EXISTS queue_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  service_id uuid NOT NULL REFERENCES warehouses(id),
  ticket_date date NOT NULL,
  number integer NOT NULL,
  client_id uuid REFERENCES clients(id),
  appointment_id uuid REFERENCES appointments(id),
  priorite varchar(10) NOT NULL DEFAULT 'normale' CHECK (priorite IN ('normale', 'rdv', 'urgence')),
  status varchar(15) NOT NULL DEFAULT 'en_attente'
    CHECK (status IN ('en_attente', 'appele', 'en_cours', 'termine', 'absent')),
  guichet varchar(30),
  created_at timestamptz NOT NULL DEFAULT now(),
  called_at timestamptz,
  UNIQUE (service_id, ticket_date, number)
);

CREATE INDEX IF NOT EXISTS idx_queue_tickets_service_day ON queue_tickets (service_id, ticket_date, status);

-- ---------------------------------------------------------------------
-- Vérification
-- ---------------------------------------------------------------------
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('appointments', 'waitlist', 'queue_counters', 'queue_tickets');
