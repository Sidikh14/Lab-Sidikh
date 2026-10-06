-- Fiscalité : BRS automatique depuis la caisse, types de vente/achat, importations.
-- (Renommer le fichier avec le prochain numéro de migration disponible.)

-- 1. Registre BRS : lien avec la sortie de caisse / la facture de charge qui l'a généré
ALTER TABLE accounting_brs_entries ADD COLUMN IF NOT EXISTS cash_expense_id UUID REFERENCES cash_expenses(id) ON DELETE CASCADE;
ALTER TABLE accounting_brs_entries ADD COLUMN IF NOT EXISTS charge_bill_id UUID REFERENCES accounting_charge_bills(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_brs_cash_expense ON accounting_brs_entries(cash_expense_id) WHERE cash_expense_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_brs_charge_bill ON accounting_brs_entries(charge_bill_id) WHERE charge_bill_id IS NOT NULL;

-- 2. Factures de charges : bénéficiaire de la retenue, conservé jusqu'au règlement
ALTER TABLE accounting_charge_bills ADD COLUMN IF NOT EXISTS brs_nature TEXT CHECK (brs_nature IN ('loyer', 'prestation'));
ALTER TABLE accounting_charge_bills ADD COLUMN IF NOT EXISTS brs_beneficiary_name TEXT;
ALTER TABLE accounting_charge_bills ADD COLUMN IF NOT EXISTS brs_beneficiary_ref TEXT;

-- 3. Ventes : type d'opération TVA + précompte
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tva_regime TEXT NOT NULL DEFAULT 'normal' CHECK (tva_regime IN ('normal', 'export', 'suspension'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS precompte_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (precompte_amount >= 0);

-- 4. Achats / entrées de stock : local ou importation
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS purchase_kind TEXT NOT NULL DEFAULT 'local' CHECK (purchase_kind IN ('local', 'import'));
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS customs_declaration TEXT;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS customs_value NUMERIC(14,2);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS customs_duties NUMERIC(14,2);
