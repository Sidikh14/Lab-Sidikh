-- 075 : retenue à la source (BRS, 5 %) réellement opérée sur un paiement.
-- Les lignes existantes gardent 0 : leurs écritures ne changent pas.
ALTER TABLE accounting_charge_bills ADD COLUMN IF NOT EXISTS brs_retenue numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE cash_expenses           ADD COLUMN IF NOT EXISTS brs_retenue numeric(14,2) NOT NULL DEFAULT 0;
