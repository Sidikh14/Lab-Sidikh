-- 061 : impôts directs (suivi des échéances et paiements) et CGU (barème modifiable + historique annuel).
CREATE TABLE IF NOT EXISTS accounting_direct_taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('is', 'acompte', 'patente', 'foncier')),
  label text NOT NULL,
  year text NOT NULL,
  due_date date NOT NULL,
  amount_due numeric(14,2) NOT NULL DEFAULT 0,
  amount_paid numeric(14,2) NOT NULL DEFAULT 0,
  paid_on date,
  payment_method text,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_direct_taxes_merchant_year ON accounting_direct_taxes (merchant_id, year);

CREATE TABLE IF NOT EXISTS accounting_cgu_settings (
  merchant_id uuid PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
  bareme jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounting_cgu_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  year text NOT NULL,
  turnover numeric(16,2) NOT NULL DEFAULT 0,
  amount_due numeric(14,2) NOT NULL DEFAULT 0,
  amount_paid numeric(14,2) NOT NULL DEFAULT 0,
  paid_on date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, year)
);
