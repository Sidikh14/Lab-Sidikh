-- Rattache chaque règlement client à une facture précise (vente à crédit).
-- Les règlements déjà enregistrés gardent order_id vide : ils restent répartis de la plus ancienne facture à la plus récente.
ALTER TABLE credit_payments ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_credit_payments_order ON credit_payments(order_id);
