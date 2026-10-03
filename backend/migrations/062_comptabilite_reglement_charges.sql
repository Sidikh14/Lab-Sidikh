-- Charges "à payer" (charges mensuelles, ou enregistrées à payer plus tard) :
-- elles sont réglées depuis la caisse, ce qui crée la sortie de caisse et
-- l'écriture de règlement (débit 401, crédit caisse/Wave/Orange Money).
ALTER TABLE accounting_charge_postings ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
ALTER TABLE accounting_charge_postings ADD COLUMN IF NOT EXISTS settled_method TEXT;
ALTER TABLE accounting_charge_postings ADD COLUMN IF NOT EXISTS settled_entry_id UUID;
