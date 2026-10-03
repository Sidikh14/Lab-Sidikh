-- Comptes auxiliaires à 6 chiffres : 411001… (clients à crédit), 411901… (assureurs),
-- 401001… (fournisseurs), 422001… (personnel).
-- Cette table garde le lien entre un client/fournisseur et son compte, pour que
-- le numéro ne change jamais.
CREATE TABLE IF NOT EXISTS accounting_tiers_accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  tiers_type  TEXT NOT NULL CHECK (tiers_type IN ('client', 'assureur', 'fournisseur', 'personnel')),
  tiers_id    TEXT NOT NULL,
  account_id  UUID NOT NULL REFERENCES accounting_accounts(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, tiers_type, tiers_id)
);
