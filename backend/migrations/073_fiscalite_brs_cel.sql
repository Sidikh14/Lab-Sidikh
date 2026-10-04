-- Déclarations DGID supplémentaires : BRS (retenue à la source de 5 % sur loyers et prestations)
-- et CEL sur la valeur ajoutée. Le registre BRS liste les sommes versées à des tiers.
ALTER TABLE accounting_tax_filings DROP CONSTRAINT IF EXISTS accounting_tax_filings_kind_check;
ALTER TABLE accounting_tax_filings ADD CONSTRAINT accounting_tax_filings_kind_check CHECK (kind IN ('tva', 'vrs', 'brs', 'cel'));

CREATE TABLE IF NOT EXISTS accounting_brs_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id      UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  beneficiary_name TEXT NOT NULL,
  beneficiary_ref  TEXT,                              -- NINEA ou pièce d'identité du bénéficiaire
  nature           TEXT NOT NULL CHECK (nature IN ('loyer', 'prestation')),
  paid_on          DATE NOT NULL,
  gross_ht         NUMERIC(16,2) NOT NULL CHECK (gross_ht > 0),   -- montant brut hors taxes
  note             TEXT,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_acc_brs_date ON accounting_brs_entries (merchant_id, paid_on);
