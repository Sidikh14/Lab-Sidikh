-- Profil fiscal du commerçant (repris en en-tête des déclarations) et suivi des déclarations
-- préparées puis déposées sur le portail de la DGID (Mon Espace Perso / e-Tax).
CREATE TABLE IF NOT EXISTS accounting_tax_profile (
  merchant_id    UUID PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
  ninea          VARCHAR(20),
  legal_name     TEXT,
  address        TEXT,
  tax_center     TEXT,                       -- Centre des services fiscaux de rattachement
  regime         TEXT NOT NULL DEFAULT 'reel_simplifie' CHECK (regime IN ('cgu', 'reel_simplifie', 'reel_normal')),
  legal_form     TEXT NOT NULL DEFAULT 'societe_is' CHECK (legal_form IN ('societe_is', 'entreprise_individuelle')),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounting_tax_filings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id    UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('tva', 'vrs')),
  period         VARCHAR(10) NOT NULL,       -- AAAA-MM
  amount_due     NUMERIC(16,2) NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'filed' CHECK (status IN ('filed')),
  filed_on       DATE NOT NULL,
  receipt_number TEXT,                       -- récépissé / quittance délivré par la DGID
  snapshot       JSONB,                      -- chiffres tels qu'ils étaient au moment du dépôt
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, kind, period)
);
