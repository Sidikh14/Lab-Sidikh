-- Migration 009 : demandes de validation pour une vente à crédit demandée
-- par un client de passage.
--
-- Le statut est en TEXT avec une contrainte CHECK (pas un ENUM) : ce champ
-- est propre à cette table, pas partagé avec d'autres fonctionnalités, donc
-- pas besoin du mécanisme d'ENUM Postgres ici.

CREATE TABLE IF NOT EXISTS credit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  order_id UUID NOT NULL REFERENCES orders(id),
  requested_by UUID REFERENCES users(id),
  full_name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente', 'approuvee', 'rejetee')),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,
  rejection_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_requests_merchant_status ON credit_requests(merchant_id, status);
