-- =====================================================================
-- Migration clinique 010 — étape 10 (portail patient, alertes, rapports)
-- À exécuter dans Neon après migration_clinique_009.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PORTAIL PATIENT : un code d'accès par patient, remis par l'accueil.
-- Seul le hachage du code est stocké. Le code est affiché une seule fois.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portail_acces (
  client_id uuid PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  code_hash varchar(100) NOT NULL,
  tentatives_echouees smallint NOT NULL DEFAULT 0,
  bloque_jusqua timestamptz,
  cree_par uuid REFERENCES users(id),
  cree_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- ALERTES : journal anti-doublon. Une même alerte n'est créée qu'une fois par jour pour un même objet.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinic_alert_log (
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  type varchar(40) NOT NULL,
  reference_id uuid NOT NULL,
  jour date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_id, type, reference_id, jour)
);

-- ---------------------------------------------------------------------
-- Vérification
-- ---------------------------------------------------------------------
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('portail_acces', 'clinic_alert_log');
