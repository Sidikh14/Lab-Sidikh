-- Migration 010 : entrées de stock au comptant ou à crédit, dette fournisseur
-- (même logique que les créances clients : rien n'est stocké en agrégat,
-- la dette se calcule à la volée à partir des mouvements et des règlements).
--
-- Corrigé : merchants/suppliers/users utilisent des clés UUID (comme dans
-- la migration 008 pour credit_payments), pas des entiers.

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS payment_method TEXT CHECK (payment_method IN ('comptant', 'a_credit'));
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS total_cost NUMERIC(12,2);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  user_id UUID REFERENCES users(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  paid_at TIMESTAMP NOT NULL DEFAULT now(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_supplier_credit ON stock_movements(supplier_id) WHERE payment_method = 'a_credit';
