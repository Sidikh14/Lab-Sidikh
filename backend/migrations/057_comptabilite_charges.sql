-- Charges (loyer, électricité, assurance…) comptabilisées automatiquement.
-- Une "charge" est un modèle (compte de classe 6, montant habituel, mode de
-- paiement, mensuelle ou ponctuelle). Chaque comptabilisation crée une écriture
-- en partie double et laisse une trace dans accounting_charge_postings.
CREATE TABLE IF NOT EXISTS accounting_charges (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id    UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  label          TEXT NOT NULL,
  account_id     UUID NOT NULL REFERENCES accounting_accounts(id),
  amount         NUMERIC(16,2) CHECK (amount IS NULL OR amount > 0),
  is_recurring   BOOLEAN NOT NULL DEFAULT FALSE,
  day_of_month   SMALLINT CHECK (day_of_month BETWEEN 1 AND 28),
  payment_method TEXT NOT NULL DEFAULT 'especes'
                 CHECK (payment_method IN ('especes','wave','orange_money','virement','a_payer')),
  start_month    CHAR(7),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounting_charge_postings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id    UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  charge_id      UUID NOT NULL REFERENCES accounting_charges(id) ON DELETE CASCADE,
  period         CHAR(7),            -- 'YYYY-MM' pour une charge mensuelle, NULL pour une dépense ponctuelle
  entry_id       UUID REFERENCES accounting_entries(id) ON DELETE SET NULL,
  entry_date     DATE NOT NULL,
  amount         NUMERIC(16,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL,
  cancelled      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (charge_id, period)
);
CREATE INDEX IF NOT EXISTS idx_acc_postings_merchant ON accounting_charge_postings (merchant_id, entry_date);
