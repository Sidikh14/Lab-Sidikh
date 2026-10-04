-- Capital, apports, emprunts (financement) et régularisations de fin de période.
-- Les écritures comptables sont générées par la synchronisation à partir de ces tables.

CREATE TABLE IF NOT EXISTS accounting_financing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('capital', 'apport', 'retrait', 'emprunt', 'remboursement')),
  label TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),          -- capital, apport, retrait, emprunt reçu, capital remboursé
  interest_amount NUMERIC(14,2) NOT NULL DEFAULT 0,          -- intérêts (remboursement seulement)
  op_date DATE NOT NULL,
  payment_method TEXT NOT NULL,                              -- especes, wave, orange_money, virement, existant
  cash_expense_id TEXT,
  warehouse_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_accounting_financing_merchant ON accounting_financing (merchant_id, op_date);

CREATE TABLE IF NOT EXISTS accounting_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('charge_avance', 'charge_a_payer')),
  nature_account TEXT NOT NULL,
  label TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  adj_date DATE NOT NULL,
  reverse BOOLEAN NOT NULL DEFAULT TRUE,                     -- extourne automatique le lendemain
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_accounting_adjustments_merchant ON accounting_adjustments (merchant_id, adj_date);
