-- Migration 004 — Reliquat : suivi de la remise au client. Une réservation
-- peut être "complete" (stock reçu, prélevé) sans que l'article ait encore
-- été physiquement remis au client — ce sont deux étapes distinctes.
-- Idempotent, comme les migrations précédentes.

ALTER TABLE pending_reservations ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- Retrouver rapidement les réservations "reçues, pas encore livrées".
CREATE INDEX IF NOT EXISTS idx_pending_reservations_a_livrer
  ON pending_reservations(merchant_id, warehouse_id)
  WHERE status = 'complete' AND delivered_at IS NULL;
