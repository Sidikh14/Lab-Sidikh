-- Migration 006 : parts fiscales (quotient familial) pour le calcul de l'IRPP
-- À exécuter après 005_payroll.sql.

ALTER TABLE employee_salaries
  ADD COLUMN IF NOT EXISTS parts_fiscales NUMERIC(3,1) NOT NULL DEFAULT 1;

ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS parts_fiscales NUMERIC(3,1) NOT NULL DEFAULT 1;
