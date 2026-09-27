-- Tiers payant / mutuelle : un assureur prend en charge un % du montant de
-- la vente pour ses assurés (clients enregistrés). Fonctionne en miroir de
-- suppliers/supplier_payments, mais la créance est dans l'autre sens :
-- c'est l'assureur qui NOUS doit de l'argent (au lieu qu'on doive au
-- fournisseur).

CREATE TABLE IF NOT EXISTS insurers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Association client -> mutuelle + son % de prise en charge personnel
-- (chaque client peut avoir un % différent selon son contrat, même chez la
-- même mutuelle).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS insurer_id UUID REFERENCES insurers(id);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS insurance_coverage_percent NUMERIC;

-- Une ligne par vente réglée en tiers payant : montant pris en charge par
-- l'assureur, figé au moment de la vente (indépendant d'un changement
-- ultérieur de mutuelle ou de % sur la fiche client).
CREATE TABLE IF NOT EXISTS insurer_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  insurer_id UUID NOT NULL REFERENCES insurers(id),
  client_id UUID NOT NULL REFERENCES clients(id),
  order_id UUID NOT NULL REFERENCES orders(id),
  amount NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Règlement reçu de l'assureur (mirroir de supplier_payments) — réduit sa
-- créance envers nous.
CREATE TABLE IF NOT EXISTS insurer_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  insurer_id UUID NOT NULL REFERENCES insurers(id),
  user_id UUID NOT NULL REFERENCES users(id),
  amount NUMERIC NOT NULL,
  payment_method VARCHAR(20) NOT NULL,
  notes TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insurer_claims_insurer ON insurer_claims (merchant_id, insurer_id);
CREATE INDEX IF NOT EXISTS idx_insurer_payments_insurer ON insurer_payments (merchant_id, insurer_id);

-- Reste à charge réglé immédiatement par le client sur une vente en tiers
-- payant (le seul montant qui entre réellement en caisse à la vente) —
-- distinct de insurer_claims (la part assureur, jamais en caisse).
CREATE TABLE IF NOT EXISTS insurer_copayments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  order_id UUID NOT NULL REFERENCES orders(id),
  user_id UUID NOT NULL REFERENCES users(id),
  amount NUMERIC NOT NULL,
  payment_method VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insurer_copayments_merchant ON insurer_copayments (merchant_id, payment_method, created_at);
