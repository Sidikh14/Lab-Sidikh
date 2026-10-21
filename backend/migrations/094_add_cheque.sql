-- D'abord, vérifier le texte exact des contraintes existantes (noms/valeurs peuvent différer) :
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conname LIKE '%payment_method_check%';

-- employee_salaries (fiche employé : mode de paiement par défaut)
ALTER TABLE employee_salaries
  DROP CONSTRAINT IF EXISTS employee_salaries_payment_method_check;
ALTER TABLE employee_salaries
  ADD CONSTRAINT employee_salaries_payment_method_check
  CHECK (payment_method IN ('especes', 'wave', 'orange_money', 'virement', 'cheque'));

-- salary_payments (paiement effectif du mois) — même souci probable, à vérifier avec la requête
-- ci-dessus ; si la contrainte existe sous un autre nom ou avec d'autres valeurs, adapter.
ALTER TABLE salary_payments
  DROP CONSTRAINT IF EXISTS salary_payments_payment_method_check;
ALTER TABLE salary_payments
  ADD CONSTRAINT salary_payments_payment_method_check
  CHECK (payment_method IN ('especes', 'wave', 'orange_money', 'virement', 'cheque'));
