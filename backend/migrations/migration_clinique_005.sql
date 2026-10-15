-- =====================================================================
-- Migration clinique 005 — étape 5 (actes, tarifs, honoraires, comptabilité)
-- À exécuter dans Neon après migration_clinique_004.sql.
-- =====================================================================

-- Les actes sont des produits sans stock (décision H7) : track_stock = FALSE.
-- Cette colonne sert à les classer dans les rapports (consultation, laboratoire, imagerie…).
ALTER TABLE products ADD COLUMN IF NOT EXISTS categorie_clinique varchar(60);

-- Praticien qui a réalisé l'acte, sur chaque ligne de vente : base des honoraires et des rapports par praticien.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS praticien_id uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_order_items_praticien ON order_items (praticien_id);

-- Réglage d'honoraires par praticien (H6).
--   pourcentage       : valeur = % du montant de la ligne
--   montant_par_acte  : valeur = montant fixe par acte réalisé
--   salaire           : aucune écriture d'honoraires (le praticien est payé par la paie)
CREATE TABLE IF NOT EXISTS practitioner_fee_settings (
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  practitioner_id uuid NOT NULL REFERENCES users(id),
  mode varchar(20) NOT NULL CHECK (mode IN ('pourcentage', 'montant_par_acte', 'salaire')),
  valeur numeric(12, 2) NOT NULL DEFAULT 0 CHECK (valeur >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id),
  PRIMARY KEY (merchant_id, practitioner_id),
  CHECK (mode = 'salaire' OR valeur > 0),
  CHECK (mode <> 'pourcentage' OR valeur <= 100)
);

-- Écriture d'honoraires à reverser : créée à l'encaissement de la ligne (H6).
-- Une seule écriture par ligne de vente.
CREATE TABLE IF NOT EXISTS practitioner_fee_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  practitioner_id uuid NOT NULL REFERENCES users(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  order_item_id uuid NOT NULL UNIQUE REFERENCES order_items(id),
  base_montant numeric(12, 2) NOT NULL,
  montant numeric(12, 2) NOT NULL CHECK (montant >= 0),
  mode varchar(20) NOT NULL,
  statut varchar(10) NOT NULL DEFAULT 'du' CHECK (statut IN ('du', 'verse')),
  created_at timestamptz NOT NULL DEFAULT now(),
  verse_at timestamptz,
  verse_par uuid REFERENCES users(id),
  CHECK ((statut = 'verse') = (verse_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_fee_entries_praticien ON practitioner_fee_entries (merchant_id, practitioner_id, statut);

-- ---------------------------------------------------------------------
-- Vérification
-- ---------------------------------------------------------------------
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('practitioner_fee_settings', 'practitioner_fee_entries');
