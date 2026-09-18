-- Migration 019 — produits vendus au poids (prix au kg, quantités décimales).
-- Idempotente.

-- is_weighted = TRUE : products.unit_price s'interprète comme un prix par kg
-- (au lieu d'un prix par unité/pièce).
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_weighted BOOLEAN NOT NULL DEFAULT FALSE;

-- Passage en NUMERIC(12,3) (au lieu d'INTEGER) pour permettre les quantités
-- décimales (ex: 0,5 kg) — appliqué globalement, pas seulement aux produits
-- pesés, pour garder un seul type de colonne partout.
ALTER TABLE products ALTER COLUMN quantity_in_stock TYPE NUMERIC(12,3);
ALTER TABLE products ALTER COLUMN quantity_alert_threshold TYPE NUMERIC(12,3);
ALTER TABLE stock_movements ALTER COLUMN quantity TYPE NUMERIC(12,3);

-- order_items.quantity est référencée par la colonne générée line_total :
-- il faut la retirer avant de changer le type, puis la recréer.
ALTER TABLE order_items DROP COLUMN IF EXISTS line_total;
ALTER TABLE order_items ALTER COLUMN quantity TYPE NUMERIC(12,3);
ALTER TABLE order_items ADD COLUMN line_total NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED;
