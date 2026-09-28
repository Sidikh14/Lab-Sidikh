-- Les règlements reçus d'une mutuelle doivent entrer dans la caisse de la
-- boutique concernée (comme les règlements de crédit et les reste-à-charge
-- tiers payant) : il leur faut donc une boutique, comme aux autres
-- mouvements de caisse.
ALTER TABLE insurer_payments
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id);

CREATE INDEX IF NOT EXISTS idx_insurer_payments_warehouse ON insurer_payments(warehouse_id);
