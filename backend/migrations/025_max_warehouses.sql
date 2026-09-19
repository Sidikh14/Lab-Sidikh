-- Plafond du nombre de boutiques qu'un commerçant peut créer, fixé par le
-- propriétaire de la plateforme (même principe que merchants.max_team_members).
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS max_warehouses integer NOT NULL DEFAULT 3;
