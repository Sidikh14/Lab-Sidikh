-- Charges payées depuis la page Caisse : on garde le lien avec la sortie de
-- caisse créée (pour pouvoir l'annuler avec l'écriture) et qui a payé.
ALTER TABLE accounting_charge_postings ADD COLUMN IF NOT EXISTS cash_expense_id UUID;
ALTER TABLE accounting_charge_postings ADD COLUMN IF NOT EXISTS paid_by UUID;
