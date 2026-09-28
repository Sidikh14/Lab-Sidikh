-- Ordonnances renouvelables / chroniques avec suivi de la quantité délivrée.
-- La quantité délivrée n'est PAS stockée : elle est calculée à partir des
-- lignes de vente (order_items) des commandes liées à l'ordonnance, hors
-- commandes annulées — elle reste donc juste en cas d'annulation.

ALTER TABLE prescriptions
  ADD COLUMN IF NOT EXISTS is_renewable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS valid_until DATE;

CREATE TABLE IF NOT EXISTS prescription_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity_prescribed NUMERIC(12,3) NOT NULL CHECK (quantity_prescribed > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (prescription_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_prescription_items_prescription ON prescription_items(prescription_id);
CREATE INDEX IF NOT EXISTS idx_orders_prescription ON orders(prescription_id) WHERE prescription_id IS NOT NULL;
