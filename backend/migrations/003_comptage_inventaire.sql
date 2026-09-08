-- Migration 003 — sessions de comptage d'inventaire (stock théorique vs compté).
-- Idempotent : peut être relancée sans risque.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_session_status') THEN
    CREATE TYPE inventory_session_status AS ENUM ('en_cours', 'ajustee', 'cloturee');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS inventory_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_seq     BIGSERIAL,
    merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    status          inventory_session_status NOT NULL DEFAULT 'en_cours',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inventory_sessions_merchant ON inventory_sessions(merchant_id);

CREATE TABLE IF NOT EXISTS inventory_session_items (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id            UUID NOT NULL REFERENCES inventory_sessions(id) ON DELETE CASCADE,
    product_id            UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    theoretical_quantity  INTEGER NOT NULL,
    counted_quantity      INTEGER,
    counted_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inventory_session_items_session ON inventory_session_items(session_id);
