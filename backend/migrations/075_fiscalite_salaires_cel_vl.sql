-- Déclarations séparées pour les retenues sur salaires (IR RAS Salaires, TRIMF, CFCE) et
-- CEL sur la valeur locative. 'vrs' est conservé pour les dépôts déjà enregistrés.
ALTER TABLE accounting_tax_filings DROP CONSTRAINT IF EXISTS accounting_tax_filings_kind_check;
ALTER TABLE accounting_tax_filings ADD CONSTRAINT accounting_tax_filings_kind_check
  CHECK (kind IN ('tva', 'ir', 'trimf', 'cfce', 'brs', 'cel', 'cel_vl', 'vrs'));
