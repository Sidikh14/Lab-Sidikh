-- Migration 003 — Commandes clients en attente (reliquat), sur articles en
-- rupture de stock. Idempotent, comme les migrations précédentes.
-- Réservé aux secteurs grossiste, textile et électroménager (pharmacie
-- exclue — géré côté applicatif, pas ici).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reservation_status') THEN
    CREATE TYPE reservation_status AS ENUM ('en_attente', 'partielle', 'complete', 'annulee');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS pending_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
    quantity_fulfilled NUMERIC(12,2) NOT NULL DEFAULT 0,
    status reservation_status NOT NULL DEFAULT 'en_attente',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    fulfilled_at TIMESTAMPTZ
);

-- FIFO : on lit toujours les réservations "en_attente"/"partielle" d'un
-- produit+boutique triées par ancienneté — index qui matche cet ordre exact.
CREATE INDEX IF NOT EXISTS idx_pending_reservations_fifo
  ON pending_reservations(merchant_id, product_id, warehouse_id, created_at)
  WHERE status IN ('en_attente', 'partielle');

CREATE INDEX IF NOT EXISTS idx_pending_reservations_order ON pending_reservations(order_id);
CREATE INDEX IF NOT EXISTS idx_pending_reservations_client ON pending_reservations(client_id);
