-- Étape 2 bis — réglages du restaurant et niveau de gestion du stock.
-- BROUILLON : à exécuter après 077 et 078, sur la branche Neon de test d'abord.
-- Additive et idempotente.

-- 1. Suivi de stock par produit. Par défaut TRUE : les produits existants gardent leur comportement.
--    Les plats d'un restaurant seront créés avec FALSE ; les boissons et eaux avec TRUE.
ALTER TABLE products ADD COLUMN IF NOT EXISTS track_stock BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Réglages par restaurant. Modifiables uniquement par le propriétaire de la plateforme (admin).
CREATE TABLE IF NOT EXISTS restaurant_settings (
  merchant_id UUID PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
  -- 'simple' : stock des boissons et produits suivis, sans recettes ni gestion d'ingrédients (par défaut).
  -- 'complet' : recettes, ingrédients, pertes, inventaires (activé par l'admin pour les restaurants qui le demandent).
  stock_mode TEXT NOT NULL DEFAULT 'simple' CHECK (stock_mode IN ('simple', 'complet')),
  qr_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  online_payment_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  reservations_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  catering_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  reservation_default_minutes INTEGER NOT NULL DEFAULT 90 CHECK (reservation_default_minutes > 0),
  tip_rule TEXT NOT NULL DEFAULT 'egal' CHECK (tip_rule IN ('serveur_ticket', 'egal', 'prorata_ca')),
  delivery_default_fee NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (delivery_default_fee >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Une ligne par restaurant existant de secteur restauration (les autres secteurs n'ont pas de réglages).
INSERT INTO restaurant_settings (merchant_id)
SELECT m.id FROM merchants m
WHERE m.sector = 'restauration'
ON CONFLICT (merchant_id) DO NOTHING;
