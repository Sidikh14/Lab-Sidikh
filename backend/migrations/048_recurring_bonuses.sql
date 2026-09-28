-- Migration 045 : primes/indemnités récurrentes par employé (reprises à chaque bulletin)
ALTER TABLE employee_salaries
  ADD COLUMN IF NOT EXISTS recurring_bonuses JSONB NOT NULL DEFAULT '[]'::jsonb;
