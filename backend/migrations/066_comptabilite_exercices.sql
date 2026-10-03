-- Exercices comptables clôturés (année civile). Une ligne = un exercice figé :
-- plus aucune écriture ne peut y être ajoutée, modifiée ou supprimée.
-- Rouvrir un exercice supprime sa ligne.
CREATE TABLE IF NOT EXISTS accounting_fiscal_years (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id       UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  year              SMALLINT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  result_before_tax NUMERIC(16,2) NOT NULL DEFAULT 0,
  tax_amount        NUMERIC(16,2) NOT NULL DEFAULT 0,
  net_result        NUMERIC(16,2) NOT NULL DEFAULT 0,
  closed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by         UUID,
  UNIQUE (merchant_id, year)
);
