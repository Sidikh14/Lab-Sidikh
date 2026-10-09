-- 075_paie_absences_avances_documents.sql
-- À exécuter après 074. Nouvelles tables uniquement (plus le lien batch_id de salary_payments).
-- Aucun CHECK sur les types : les valeurs sont validées côté application.

BEGIN;

-- Absences datées (aucun solde de congé calculé). Une absence compte pour le mois de sa date de début.
CREATE TABLE IF NOT EXISTS employee_absences (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  start_date   date NOT NULL,
  end_date     date,
  absence_type text NOT NULL DEFAULT 'non_payee',   -- non_payee | payee | maladie | conge
  days         numeric NOT NULL,
  is_paid      boolean NOT NULL DEFAULT false,
  note         text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employee_absences_emp_date ON employee_absences (employee_id, start_date);

-- Heures supplémentaires par date ; la catégorie renvoie à payroll_settings.overtime_rates[].code.
CREATE TABLE IF NOT EXISTS employee_overtime (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  work_date    date NOT NULL,
  hours        numeric NOT NULL,
  category     text NOT NULL,
  note         text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employee_overtime_emp_date ON employee_overtime (employee_id, work_date);

-- Avances et prêts : sortie de caisse + plan de remboursement.
CREATE TABLE IF NOT EXISTS employee_advances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  kind            text NOT NULL DEFAULT 'avance',          -- avance | pret
  amount          numeric NOT NULL,
  advance_date    date NOT NULL,
  repay_mode      text NOT NULL DEFAULT 'unique',          -- unique | echelonne | libre
  installments    integer,
  monthly_amount  numeric NOT NULL,
  start_month     text NOT NULL,                           -- AAAA-MM, premier bulletin concerné
  balance         numeric NOT NULL,
  status          text NOT NULL DEFAULT 'en_cours',        -- en_cours | solde
  payment_method  text,
  warehouse_id    uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  cash_expense_id uuid,
  note            text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employee_advances_emp ON employee_advances (employee_id, status);

CREATE TABLE IF NOT EXISTS employee_advance_repayments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_id  uuid NOT NULL REFERENCES employee_advances(id) ON DELETE CASCADE,
  payslip_id  uuid REFERENCES payslips(id) ON DELETE SET NULL,
  month       text NOT NULL,
  amount      numeric NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_advance_repayments_advance ON employee_advance_repayments (advance_id, month);

-- Historique des salaires de base, avec date d'effet.
CREATE TABLE IF NOT EXISTS employee_salary_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  monthly_salary numeric NOT NULL,
  effective_from date NOT NULL,
  note           text,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_salary_history_emp ON employee_salary_history (employee_id, effective_from);

-- Reprise de l'existant : un point de départ par salaire déjà configuré.
INSERT INTO employee_salary_history (employee_id, monthly_salary, effective_from, note)
SELECT es.user_id, es.monthly_salary, COALESCE(es.updated_at, now())::date, 'Salaire repris à la mise en place de l''historique'
FROM employee_salaries es
WHERE es.monthly_salary IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM employee_salary_history h WHERE h.employee_id = es.user_id);

-- Paiements groupés (un lot = un clic sur « Payer tout »).
CREATE TABLE IF NOT EXISTS salary_payment_batches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  month        text NOT NULL,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  total        numeric NOT NULL DEFAULT 0,
  employees_count integer NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'salary_payments_batch_fkey') THEN
    ALTER TABLE salary_payments
      ADD CONSTRAINT salary_payments_batch_fkey FOREIGN KEY (batch_id) REFERENCES salary_payment_batches(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Documents RH : modèles par commerçant et journal des documents émis.
CREATE TABLE IF NOT EXISTS hr_document_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  doc_type    text NOT NULL,        -- attestation_travail | certificat_travail | contrat_cdi | contrat_cdd
  title       text NOT NULL,
  body        text NOT NULL,
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, doc_type)
);

CREATE TABLE IF NOT EXISTS hr_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  doc_type    text NOT NULL,
  title       text NOT NULL,
  snapshot    text NOT NULL,        -- texte exact émis
  issued_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  issued_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hr_documents_emp ON hr_documents (employee_id, issued_at DESC);

COMMIT;
