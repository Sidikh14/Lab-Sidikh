-- À exécuter si 053_comptabilite_tiers.sql a déjà été lancé AVANT cette version :
-- ajoute les types de tiers "assureur" et "personnel" (comptes 4119xx et 422xxx).
-- Sans danger si 053 vient d'être lancé dans sa version à jour.
ALTER TABLE accounting_tiers_accounts DROP CONSTRAINT IF EXISTS accounting_tiers_accounts_tiers_type_check;
ALTER TABLE accounting_tiers_accounts
  ADD CONSTRAINT accounting_tiers_accounts_tiers_type_check
  CHECK (tiers_type IN ('client', 'assureur', 'fournisseur', 'personnel'));
