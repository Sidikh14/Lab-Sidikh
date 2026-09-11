-- Migration 005 — conditionnements de vente (gros/détail) par produit.
-- Un produit garde son prix "détail" habituel (products.unit_price) et peut
-- en plus avoir des conditionnements (carton, pack, paquet...) avec leur
-- propre prix et le nombre d'unités de base qu'ils représentent.

CREATE TABLE IF NOT EXISTS product_units (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id          UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    merchant_id         UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    label               VARCHAR(50) NOT NULL,
    price               NUMERIC(12,2) NOT NULL,
    quantity_per_unit   INTEGER NOT NULL CHECK (quantity_per_unit > 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_units_product ON product_units(product_id);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS packaging_label VARCHAR(50);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS packaging_quantity INTEGER;
