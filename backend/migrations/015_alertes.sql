-- Migration 014 : système d'alertes manager (push web + e-mail + in-app)
-- À exécuter dans la console SQL Neon, comme les migrations précédentes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Réglages d'alerte par commerçant
CREATE TABLE IF NOT EXISTS alert_settings (
  merchant_id UUID PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE, -- confirmé via products.routes.js (SELECT business_name FROM merchants)
  seuil_vente_elevee NUMERIC(12,2) NOT NULL DEFAULT 500000,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Préférences de canal par utilisateur (manager/gérant)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS alertes_in_app_actif BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS alertes_push_actif BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alertes_email_actif BOOLEAN NOT NULL DEFAULT false;

-- Abonnements push web (un par navigateur/appareil)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Historique des alertes (alimente aussi la cloche dans l'app)
CREATE TYPE alert_type AS ENUM ('vente_elevee', 'annulation_suspecte', 'rupture_imminente');

CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  type alert_type NOT NULL,
  titre TEXT NOT NULL,
  message TEXT NOT NULL,
  montant NUMERIC(12,2),
  reference_id UUID,
  lu BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_merchant_lu ON alerts(merchant_id, lu);
