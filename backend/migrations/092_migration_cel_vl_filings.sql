-- Autorise tous les types de déclaration (dont cel_vl) dans accounting_tax_filings.
-- Sans danger si la contrainte est déjà à jour : elle est simplement recréée.
ALTER TABLE accounting_tax_filings DROP CONSTRAINT IF EXISTS accounting_tax_filings_kind_check;
ALTER TABLE accounting_tax_filings
  ADD CONSTRAINT accounting_tax_filings_kind_check
  CHECK (kind IN ('tva', 'ir', 'trimf', 'cfce', 'brs', 'cel', 'cel_vl', 'vrs'));
