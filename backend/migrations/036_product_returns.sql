-- Migration 036 : module retours client (motif obligatoire, remise en
-- stock, remboursement obligatoire sorti de caisse), lié à une commande
-- existante. Séparé du flux "retour facture vendeur↔caissier avant
-- encaissement" (orders.status = 'renvoyee_vendeur'), qui reste inchangé.
BEGIN;

CREATE TABLE IF NOT EXISTS product_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  order_id UUID NOT NULL REFERENCES orders(id),
  product_id UUID NOT NULL REFERENCES products(id),
  client_id UUID REFERENCES clients(id),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  reason TEXT NOT NULL,
  -- Rattachés uniquement à la première ligne d'un retour multi-articles
  -- (même convention que total_cost sur products.purchases) pour ne pas
  -- compter deux fois le même remboursement.
  refund_amount NUMERIC,
  refund_method VARCHAR(20),
  recorded_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_returns_order ON product_returns(order_id);
CREATE INDEX IF NOT EXISTS idx_product_returns_warehouse ON product_returns(merchant_id, warehouse_id);

-- movement_type est un ENUM Postgres (stock_movement_type), pas un CHECK :
-- on lui ajoute la nouvelle valeur 'retour_client'. Cette valeur ne peut
-- pas être utilisée dans la même transaction que celle où elle est créée
-- (restriction Postgres sur ALTER TYPE ... ADD VALUE) — sans impact ici
-- puisqu'elle n'est consommée que plus tard, côté application.
ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'retour_client';

COMMIT;
