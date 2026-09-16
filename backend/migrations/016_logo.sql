-- Migration 015 : informations entreprise pour des factures professionnelles
-- (entête + pied de page PDF : logo, NINEA, RCCM, adresse, coordonnées
-- bancaires/Mobile Money, conditions de règlement).
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS ninea TEXT,
  ADD COLUMN IF NOT EXISTS rccm TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS bank_details TEXT,
  ADD COLUMN IF NOT EXISTS mobile_money_details TEXT,
  ADD COLUMN IF NOT EXISTS payment_terms TEXT,
  ADD COLUMN IF NOT EXISTS logo_data TEXT;
