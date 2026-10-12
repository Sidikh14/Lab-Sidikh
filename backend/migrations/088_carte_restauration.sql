-- Étape 2 (M2) — carte du restaurant : plats, options, menus, prix par horaire, plats du jour, photos.
-- BROUILLON : à valider après les requêtes de contrôle (types de products, categories, merchants).
-- Migration additive et idempotente : aucune donnée existante n'est modifiée ni supprimée.
-- Prérequis : 077_secteur_restauration.sql exécuté.

-- 1. Colonnes ajoutées à products (les allergènes et régimes vont dans attributes, JSONB, sans colonne).
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_dish BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_ingredient BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS station TEXT;            -- 'cuisine' ou 'bar'
ALTER TABLE products ADD COLUMN IF NOT EXISTS course TEXT;             -- 'entree', 'plat', 'dessert', 'boisson'
ALTER TABLE products ADD COLUMN IF NOT EXISTS prep_minutes INTEGER;    -- temps de préparation prévu (alerte de retard)
ALTER TABLE products ADD COLUMN IF NOT EXISTS available BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS photo_id UUID;           -- lien vers product_photos
ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT;         -- description affichée sur la carte et le QR
ALTER TABLE products ADD COLUMN IF NOT EXISTS ingredients_text TEXT;   -- ingrédients affichés au client (liste libre)

-- 1 bis. Tables du restaurant : chaque table a son propre QR code (jeton aléatoire généré par l'application).
CREATE TABLE IF NOT EXISTS dining_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,                      -- ex. « Table 4 », « Terrasse 2 »
  capacity INTEGER NOT NULL DEFAULT 2 CHECK (capacity > 0),
  qr_token TEXT NOT NULL UNIQUE,            -- jeton du QR code, non devinable
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, label)
);

-- Origine des commandes : le caissier voit si la commande vient de la salle (table) ou de la caisse.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dining_table_id UUID REFERENCES dining_tables(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'caisse';  -- 'caisse' ou 'qr'

-- 2. Photos des plats, compressées côté application (200 Ko maximum, décision H8).
CREATE TABLE IF NOT EXISTS product_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL,
  data BYTEA NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 204800),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Groupes d'options (cuisson, sauces, suppléments) et options avec supplément de prix.
CREATE TABLE IF NOT EXISTS product_option_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  selection_mode TEXT NOT NULL CHECK (selection_mode IN ('unique', 'multiple')),
  required BOOLEAN NOT NULL DEFAULT FALSE,
  min_choices INTEGER NOT NULL DEFAULT 0 CHECK (min_choices >= 0),
  max_choices INTEGER NOT NULL DEFAULT 1 CHECK (max_choices >= min_choices),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES product_option_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_delta NUMERIC(12, 2) NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);

-- Un groupe peut servir à plusieurs plats.
CREATE TABLE IF NOT EXISTS product_group_links (
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES product_option_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, group_id)
);

-- 4. Menus et formules : composition d'un menu (ex. « entrée au choix parmi la catégorie Entrées »).
CREATE TABLE IF NOT EXISTS combo_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  parent_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  slot_name TEXT NOT NULL,
  choice_category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  position INTEGER NOT NULL DEFAULT 0
);

-- 5. Prix par horaire (ex. happy hour). Une règle s'applique si l'heure est dans [start_time, end_time[.
CREATE TABLE IF NOT EXISTS product_price_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  CHECK (end_time > start_time)
);

-- 6. Plats du jour : disponibilité et prix du jour par date.
CREATE TABLE IF NOT EXISTS product_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  available_on DATE NOT NULL,
  price_override NUMERIC(12, 2),
  UNIQUE (product_id, available_on)
);

-- 7. Index pour les listes de la carte et les rapports.
CREATE INDEX IF NOT EXISTS idx_product_option_groups_merchant ON product_option_groups (merchant_id);
CREATE INDEX IF NOT EXISTS idx_combo_slots_parent ON combo_slots (parent_product_id);
CREATE INDEX IF NOT EXISTS idx_product_price_rules_product ON product_price_rules (product_id);
CREATE INDEX IF NOT EXISTS idx_product_availability_merchant_date ON product_availability (merchant_id, available_on);
