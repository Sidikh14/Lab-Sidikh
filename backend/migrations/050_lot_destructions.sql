-- Registre des destructions de lots périmés (pharmacie) : trace de qui a
-- détruit quoi, quand, et pour quelle valeur, une fois le lot sorti du stock.
CREATE TABLE IF NOT EXISTS lot_destructions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL,
  warehouse_id UUID,
  product_id UUID NOT NULL,
  lot_id UUID,
  lot_number VARCHAR(100),
  expiry_date DATE,
  quantity NUMERIC NOT NULL,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  destroyed_by UUID,
  destroyed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lot_destructions_merchant_date
  ON lot_destructions (merchant_id, destroyed_at DESC);

-- Reprise de l'historique : les destructions déjà faites avaient seulement
-- laissé un mouvement de stock 'ajustement'. Exécuté une seule fois (table vide).
INSERT INTO lot_destructions (merchant_id, warehouse_id, product_id, quantity, unit_price, destroyed_by, destroyed_at)
SELECT sm.merchant_id, sm.warehouse_id, sm.product_id, sm.quantity, COALESCE(p.unit_price, 0), sm.user_id, sm.created_at
FROM stock_movements sm
JOIN products p ON p.id = sm.product_id
WHERE sm.reason LIKE 'Lot périmé détruit%'
  AND NOT EXISTS (SELECT 1 FROM lot_destructions);
