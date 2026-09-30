-- =========================================================
-- Migration 026 — Registre des destructions de lots périmés
-- =========================================================
-- Chaque destruction d'un lot périmé (DELETE /products/:id/lots/:lotId) est
-- inscrite ici, avec un instantané du produit (nom, prix) pour que le registre
-- reste lisible même si le produit est supprimé ensuite.
-- À exécuter AVANT de déployer le nouveau products_routes.js.
-- =========================================================

CREATE TABLE IF NOT EXISTS lot_destructions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id   UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    warehouse_id  UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    product_id    UUID REFERENCES products(id) ON DELETE SET NULL,
    lot_id        UUID REFERENCES product_lots(id) ON DELETE SET NULL,
    product_name  TEXT NOT NULL,
    lot_number    TEXT,
    expiry_date   DATE,
    quantity      NUMERIC(12,3) NOT NULL,
    unit_price    NUMERIC,
    lost_value    NUMERIC NOT NULL DEFAULT 0,
    destroyed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    destroyed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lot_destructions_lieu
    ON lot_destructions (merchant_id, warehouse_id, destroyed_at DESC);
