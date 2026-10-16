-- Documents RH : informations d'identité de l'employé et signataire des documents.
-- Sans risque pour les données existantes (colonnes ajoutées, vides au départ) et rejouable.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS civility text,
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS birth_place text,
  ADD COLUMN IF NOT EXISTS nationality text,
  ADD COLUMN IF NOT EXISTS id_document text;

ALTER TABLE payroll_settings
  ADD COLUMN IF NOT EXISTS signatory_name text,
  ADD COLUMN IF NOT EXISTS signatory_title text,
  ADD COLUMN IF NOT EXISTS signature_city text;
