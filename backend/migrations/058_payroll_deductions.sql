-- Migration 045 : retenues manuelles sur les bulletins de paie
-- (avance sur salaire, absence non rémunérée, remboursement de prêt, autre).
-- À exécuter après 044_payroll_parts_fiscales.sql (renommer le numéro si besoin).
-- Idempotente : peut être relancée sans risque.

-- 1) Retenues saisies par mois et par employé, avant génération du bulletin.
CREATE TABLE IF NOT EXISTS salary_deductions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month VARCHAR(7) NOT NULL, -- 'YYYY-MM'
  type VARCHAR(20) NOT NULL CHECK (type IN ('avance', 'absence', 'pret', 'autre')),
  label VARCHAR(120) NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_salary_deductions_user_month ON salary_deductions(user_id, month);

-- 2) Snapshot figé dans le bulletin :
--    - deductions_detail : [{type, label, amount}] (toutes les retenues du mois)
--    - absences_total    : somme des absences, déjà retirée du brut (donc des cotisations/impôt)
--    - deductions_total  : avances/prêts/autres, déduits du net APRÈS cotisations et impôt
ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS deductions_detail JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS absences_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deductions_total NUMERIC(12,2) NOT NULL DEFAULT 0;
