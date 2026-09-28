-- Rattache chaque ordonnance à la fiche client (= dossier patient en pharmacie).
ALTER TABLE prescriptions
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_prescriptions_client ON prescriptions(client_id) WHERE client_id IS NOT NULL;
