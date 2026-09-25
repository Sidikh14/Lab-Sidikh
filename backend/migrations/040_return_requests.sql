-- Demandes de retour en attente de validation (double validation caissier
-- pharmacie -> manager/gérant). Tant qu'une demande n'est pas approuvée,
-- aucun mouvement de stock ni de caisse n'a lieu : c'est product_returns
-- (table existante) qui reste la trace des retours réellement exécutés.

CREATE TABLE IF NOT EXISTS return_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  order_id UUID NOT NULL REFERENCES orders(id),
  client_id UUID REFERENCES clients(id),
  items JSONB NOT NULL,
  reason TEXT NOT NULL,
  refund_method VARCHAR(20) NOT NULL,
  refund_amount NUMERIC NOT NULL,
  requested_by UUID NOT NULL REFERENCES users(id),
  reviewed_by UUID REFERENCES users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'en_attente', -- en_attente / validee / refusee
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_return_requests_merchant_warehouse
  ON return_requests (merchant_id, warehouse_id, status);
