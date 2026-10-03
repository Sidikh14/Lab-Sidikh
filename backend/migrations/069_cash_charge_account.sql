-- Nature de la charge choisie dans le formulaire « Nouvelle sortie de caisse »
-- (compte SYSCOHADA de classe 6). Sert à imputer la sortie en comptabilité.
ALTER TABLE cash_expenses ADD COLUMN IF NOT EXISTS charge_account TEXT;
