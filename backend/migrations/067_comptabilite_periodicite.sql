-- Périodicité des cotisations sociales (CSS, IPRES) choisie par le manager :
-- mensuelle, trimestrielle ou semestrielle. Les impôts restent mensuels.
CREATE TABLE IF NOT EXISTS accounting_tax_settings (
  merchant_id             UUID PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
  contributions_frequency TEXT NOT NULL DEFAULT 'monthly'
                          CHECK (contributions_frequency IN ('monthly', 'quarterly', 'semiannual')),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La période d'un paiement peut être AAAA-MM, AAAA-T1..T4 ou AAAA-S1..S2.
ALTER TABLE accounting_state_payments ALTER COLUMN period TYPE VARCHAR(10);
