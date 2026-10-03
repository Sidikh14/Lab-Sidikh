-- Paiements à l'État et aux organismes sociaux (TVA, retenues sur salaires,
-- CSS, IPRES, CFCE, impôt sur les résultats). Chaque paiement garde le lien
-- avec son écriture comptable et, si payé depuis une caisse, la sortie de caisse.
CREATE TABLE IF NOT EXISTS accounting_state_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('tva','retenues','css','ipres','cfce','is')),
  period          CHAR(7),
  amount          NUMERIC(16,2) NOT NULL CHECK (amount > 0),
  payment_method  TEXT NOT NULL CHECK (payment_method IN ('especes','wave','orange_money','virement')),
  payment_date    DATE NOT NULL,
  note            TEXT,
  entry_id        UUID REFERENCES accounting_entries(id) ON DELETE SET NULL,
  cash_expense_id UUID,
  paid_by         UUID,
  cancelled       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_acc_state_pay ON accounting_state_payments (merchant_id, payment_date);
