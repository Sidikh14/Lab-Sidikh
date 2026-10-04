-- Immobilisations (registre + amortissements) et factures de charges à payer.
-- Les écritures comptables sont générées par la synchronisation à partir de ces tables.

CREATE TABLE IF NOT EXISTS accounting_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  asset_account TEXT NOT NULL,
  depreciation_account TEXT,
  acquisition_date DATE NOT NULL,
  cost NUMERIC(14,2) NOT NULL CHECK (cost > 0),
  residual_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  useful_life_years NUMERIC(5,2),
  payment_method TEXT NOT NULL,           -- especes, wave, orange_money, virement, a_payer, existant
  cash_expense_id TEXT,
  warehouse_id UUID,
  paid_at DATE,                           -- règlement d'une acquisition « à payer »
  paid_method TEXT,
  paid_cash_expense_id TEXT,
  disposal_date DATE,
  disposal_price NUMERIC(14,2),
  disposal_method TEXT,
  disposal_cash_id TEXT,
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_accounting_assets_merchant ON accounting_assets (merchant_id);

CREATE TABLE IF NOT EXISTS accounting_charge_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  nature_account TEXT NOT NULL,
  label TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  bill_date DATE NOT NULL,
  warehouse_id UUID,
  paid_at DATE,
  paid_method TEXT,
  paid_cash_expense_id TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_accounting_charge_bills_merchant ON accounting_charge_bills (merchant_id, paid_at);

-- Les nouveaux types d'écritures automatiques (facture_charge, reglement_charge,
-- immobilisation, amortissement, cession) ne doivent pas être refusés par une
-- ancienne contrainte CHECK sur source_type, si elle existe.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'accounting_entries'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%source_type%'
  LOOP
    EXECUTE format('ALTER TABLE accounting_entries DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
