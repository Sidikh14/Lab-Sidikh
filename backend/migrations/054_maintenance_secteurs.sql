-- Maintenance par secteur, pilotée depuis le panel owner.
CREATE TABLE IF NOT EXISTS maintenance_secteurs (
  sector      business_sector PRIMARY KEY,
  is_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  message     TEXT,
  return_at   TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO maintenance_secteurs (sector)
SELECT unnest(enum_range(NULL::business_sector))
ON CONFLICT (sector) DO NOTHING;
