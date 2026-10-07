-- 074 : TVA déductible facultative sur les factures de charges et les sorties de caisse.
-- Idempotente : sans effet si la 073 a déjà créé ces colonnes sous le même nom.
ALTER TABLE accounting_charge_bills ADD COLUMN IF NOT EXISTS tva_amount numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE cash_expenses           ADD COLUMN IF NOT EXISTS tva_amount numeric(14,2) NOT NULL DEFAULT 0;

SELECT table_name, column_name FROM information_schema.columns
WHERE column_name = 'tva_amount' AND table_name IN ('accounting_charge_bills', 'cash_expenses', 'stock_movements')
ORDER BY table_name;
