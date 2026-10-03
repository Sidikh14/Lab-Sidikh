-- Modules Paie et Fiscalité, activés par l'owner commerçant par commerçant
-- (comme la Comptabilité). fiscalite_enabled existe déjà (migration 062).
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS payroll_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Les commerçants qui utilisent déjà la paie la gardent.
UPDATE merchants m SET payroll_enabled = TRUE
WHERE EXISTS (
  SELECT 1 FROM employee_salaries es JOIN users u ON u.id = es.user_id WHERE u.merchant_id = m.id
);

-- Parts sociales activables salarié par salarié : le calcul n'est plus forcé.
-- Les salariés déjà configurés gardent leur calcul actuel (IPRES et CSS appliquées) ;
-- les nouveaux salariés démarrent sans (à cocher dans leur fiche).
ALTER TABLE employee_salaries ADD COLUMN IF NOT EXISTS ipres_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE employee_salaries ADD COLUMN IF NOT EXISTS css_enabled BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE employee_salaries SET ipres_enabled = TRUE, css_enabled = TRUE;
