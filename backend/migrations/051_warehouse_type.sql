-- =========================================================
-- Migration 024 — Type d'entrepôt : boutique ou dépôt
-- =========================================================
-- Décisions :
--  - 'boutique' : lieu de vente (caisse, commandes) + stock.
--  - 'depot'    : lieu de stockage uniquement (pas de vente), relié aux
--                 boutiques par les transferts de stock existants.
--  - Le dépôt est facultatif : un commerçant peut n'avoir que des boutiques.
--  - Tous les entrepôts existants restent des boutiques (DEFAULT).
--  - Le type est fixé à la création (non modifiable ensuite).
-- =========================================================

ALTER TABLE warehouses
    ADD COLUMN IF NOT EXISTS type VARCHAR(10) NOT NULL DEFAULT 'boutique';

ALTER TABLE warehouses
    DROP CONSTRAINT IF EXISTS warehouses_type_check;

ALTER TABLE warehouses
    ADD CONSTRAINT warehouses_type_check CHECK (type IN ('boutique', 'depot'));
