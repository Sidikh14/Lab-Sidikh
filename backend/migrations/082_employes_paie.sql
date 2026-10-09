-- 074_employes_paie.sql
-- Socle du lot paie : table employees (lien facultatif vers un compte), repointage des
-- clés étrangères de la paie vers employees, colonnes ajoutées sur payslips,
-- salary_payments, payroll_settings et salary_deductions.
-- À exécuter UNE seule fois, d'abord sur la branche Neon de test, puis sur la base principale.
-- Les ids existants restent valides : chaque employé repris a id = users.id.

BEGIN;

-- 1. Table des employés -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  user_id       uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  full_name     text NOT NULL,
  phone         text,
  email         text,
  address       text,
  job_title     text,
  hire_date     date,
  end_date      date,
  contract_type text,
  ipres_number  text,
  css_number    text,
  warehouse_id  uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'actif',
  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employees_merchant_status ON employees (merchant_id, status);

-- 2. Rattrapage : un employé par utilisateur déjà présent dans la paie (id = users.id) --
INSERT INTO employees (id, merchant_id, user_id, full_name, warehouse_id, status, created_at)
SELECT u.id, u.merchant_id, u.id, u.full_name, u.warehouse_id,
       CASE WHEN u.is_active THEN 'actif' ELSE 'archive' END, COALESCE(u.created_at, now())
FROM users u
WHERE u.id IN (
        SELECT user_id FROM employee_salaries
  UNION SELECT user_id FROM salary_payments
  UNION SELECT user_id FROM salary_bonuses
  UNION SELECT user_id FROM payslips
  UNION SELECT user_id FROM salary_deductions
)
ON CONFLICT (id) DO NOTHING;

UPDATE employees SET archived_at = now() WHERE status = 'archive' AND archived_at IS NULL;

-- 3. Clés étrangères user_id : de users vers employees ------------------------------
-- Les noms réels sont relevés dynamiquement (employee_salaries_user_id_fkey, etc.) : toute clé
-- de ces tables sur user_id qui pointe vers users est supprimée, puis remplacée.
DO $$
DECLARE
  t text;
  c record;
BEGIN
  FOREACH t IN ARRAY ARRAY['employee_salaries', 'salary_payments', 'salary_bonuses', 'payslips', 'salary_deductions'] LOOP
    FOR c IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
      WHERE con.contype = 'f' AND rel.relname = t AND att.attname = 'user_id'
        AND con.confrelid = 'users'::regclass
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, c.conname);
    END LOOP;
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES employees(id) ON DELETE RESTRICT',
      t, t || '_employee_fkey');
  END LOOP;
END $$;

-- 4. payslips : numéro, version, statut, rectificatif, totaux, envoi ------------------
ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS number          text,
  ADD COLUMN IF NOT EXISTS version         integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS rectifies_id    uuid REFERENCES payslips(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rectify_reason  text,
  ADD COLUMN IF NOT EXISTS status          text NOT NULL DEFAULT 'emis',
  ADD COLUMN IF NOT EXISTS overtime_total  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS advances_total  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_at         timestamptz,
  ADD COLUMN IF NOT EXISTS sent_to         text;

-- Numérotation BUL-AAAA-MM-NNN par commerçant (rattrapage des bulletins existants).
WITH num AS (
  SELECT id, 'BUL-' || month || '-' || lpad(
           (row_number() OVER (PARTITION BY merchant_id, month ORDER BY generated_at, id))::text, 3, '0') AS n
  FROM payslips WHERE number IS NULL
)
UPDATE payslips p SET number = num.n FROM num WHERE p.id = num.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payslips_merchant_number ON payslips (merchant_id, number);

-- Unicité (user_id, month) remplacée par (user_id, month, version) : contrainte ou index,
-- quel que soit son nom.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'payslips'::regclass AND con.contype = 'u'
      AND (SELECT array_agg(att.attname::text ORDER BY att.attname::text)
           FROM pg_attribute att WHERE att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey))
          = ARRAY['month', 'user_id']
  LOOP
    EXECUTE format('ALTER TABLE payslips DROP CONSTRAINT %I', c.conname);
  END LOOP;
  FOR c IN
    SELECT i.indexrelid::regclass::text AS idx
    FROM pg_index i
    WHERE i.indrelid = 'payslips'::regclass AND i.indisunique AND NOT i.indisprimary
      AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid)
      AND (SELECT array_agg(att.attname::text ORDER BY att.attname::text)
           FROM pg_attribute att WHERE att.attrelid = i.indrelid AND att.attnum = ANY (i.indkey))
          = ARRAY['month', 'user_id']
  LOOP
    EXECUTE format('DROP INDEX %s', c.idx);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payslips_user_month_version ON payslips (user_id, month, version);

-- 5. salary_payments : commerçant, lien vers la sortie de caisse, boutique, lot --------
ALTER TABLE salary_payments
  ADD COLUMN IF NOT EXISTS merchant_id      uuid REFERENCES merchants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS cash_expense_id  uuid,
  ADD COLUMN IF NOT EXISTS warehouse_id     uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS batch_id         uuid;

UPDATE salary_payments sp SET merchant_id = e.merchant_id
FROM employees e WHERE e.id = sp.user_id AND sp.merchant_id IS NULL;

-- NOT NULL seulement si le rattrapage est complet.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM salary_payments WHERE merchant_id IS NULL) THEN
    ALTER TABLE salary_payments ALTER COLUMN merchant_id SET NOT NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_salary_payments_merchant_month ON salary_payments (merchant_id, month);

-- 6. payroll_settings : base de jours, heures par jour, majorations, numéros employeur --
ALTER TABLE payroll_settings
  ADD COLUMN IF NOT EXISTS working_days_base     integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS hours_per_day         numeric NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS overtime_rates        jsonb   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS employer_ipres_number text,
  ADD COLUMN IF NOT EXISTS employer_css_number   text;

-- 7. salary_deductions : origine de la ligne (saisie manuelle ou calculée) --------------
ALTER TABLE salary_deductions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manuel';

COMMIT;

-- Contrôles à lancer après exécution (sur la branche de test) :
--   SELECT count(*) FROM employees;                                          -- = nb d'utilisateurs présents dans la paie
--   SELECT count(*) FROM payslips WHERE number IS NULL;                      -- 0
--   SELECT count(*) FROM salary_payments WHERE merchant_id IS NULL;          -- 0
--   SELECT conname FROM pg_constraint WHERE conname LIKE '%_employee_fkey';  -- 5 lignes
