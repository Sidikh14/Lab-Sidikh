-- =========================================================
-- Schéma de base de données
-- Plateforme de gestion pour commerçants (multi-tenant SaaS)
-- Modules : comptes commerçants, rôles, stock, commandes, clients
-- SGBD cible : PostgreSQL 14+
-- =========================================================

-- ---------------------------------------------------------
-- Extensions utiles (génération d'UUID)
-- ---------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------
-- 1. Commerçants (le "tenant" principal de la plateforme)
--    Chaque commerçant possède son propre espace isolé.
-- ---------------------------------------------------------
CREATE TABLE merchants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name   VARCHAR(150) NOT NULL,
    sector          VARCHAR(100),                 -- ex: alimentation, textile, cosmétique
    phone           VARCHAR(30),
    email           VARCHAR(150) UNIQUE,
    address         TEXT,
    currency        VARCHAR(10) NOT NULL DEFAULT 'XOF',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- 2. Utilisateurs et rôles (RBAC)
--    Un utilisateur appartient toujours à un commerçant
--    et possède un rôle : manager, gerant, vendeur.
-- ---------------------------------------------------------
CREATE TYPE user_role AS ENUM ('manager', 'gerant', 'vendeur', 'caissier');

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    full_name       VARCHAR(150) NOT NULL,
    email           VARCHAR(150) NOT NULL,
    phone           VARCHAR(30),
    password_hash   VARCHAR(255) NOT NULL,
    role            user_role NOT NULL DEFAULT 'vendeur',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (merchant_id, email)
);

CREATE INDEX idx_users_merchant ON users(merchant_id);

-- ---------------------------------------------------------
-- 3. Catégories de produits (facultatif mais utile pour le stock)
-- ---------------------------------------------------------
CREATE TABLE categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    UNIQUE (merchant_id, name)
);

-- ---------------------------------------------------------
-- 4. Produits / Stock
--    quantity_alert_threshold sert à déclencher les alertes
--    (statut "faible" / "rupture" calculé côté application).
-- ---------------------------------------------------------
CREATE TABLE products (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id             UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    category_id             UUID REFERENCES categories(id) ON DELETE SET NULL,
    name                    VARCHAR(150) NOT NULL,
    sku                     VARCHAR(60),
    unit_price              NUMERIC(12,2) NOT NULL DEFAULT 0,
    quantity_in_stock       INTEGER NOT NULL DEFAULT 0,
    quantity_alert_threshold INTEGER NOT NULL DEFAULT 5,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (merchant_id, sku)
);

CREATE INDEX idx_products_merchant ON products(merchant_id);
CREATE INDEX idx_products_low_stock ON products(merchant_id, quantity_in_stock);

-- Historique des mouvements de stock (entrées/sorties), utile pour
-- la traçabilité : qui a modifié le stock, quand, et pourquoi.
CREATE TYPE stock_movement_type AS ENUM ('entree', 'sortie', 'ajustement');

CREATE TABLE stock_movements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    movement_type   stock_movement_type NOT NULL,
    quantity        INTEGER NOT NULL,
    reason          VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_movements_product ON stock_movements(product_id);

-- ---------------------------------------------------------
-- 5. Clients (fiche simple)
-- ---------------------------------------------------------
CREATE TABLE clients (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    full_name       VARCHAR(150) NOT NULL,
    phone           VARCHAR(30),
    email           VARCHAR(150),
    address         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clients_merchant ON clients(merchant_id);

-- ---------------------------------------------------------
-- 6. Commandes clients (ventes)
-- ---------------------------------------------------------
CREATE TYPE order_status AS ENUM ('en_attente', 'validee', 'livree', 'annulee');
CREATE TYPE payment_method AS ENUM ('especes', 'wave', 'orange_money', 'cheque', 'virement');

CREATE TABLE orders (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_seq         BIGSERIAL,                                       -- sert à générer le n° de commande (CMD-2026-0001)
    merchant_id       UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    client_id         UUID REFERENCES clients(id) ON DELETE SET NULL,
    created_by        UUID REFERENCES users(id) ON DELETE SET NULL,    -- vendeur ayant enregistré la vente
    status            order_status NOT NULL DEFAULT 'en_attente',
    subtotal_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
    tva_applicable    BOOLEAN NOT NULL DEFAULT FALSE,
    tva_rate          NUMERIC(5,2) NOT NULL DEFAULT 18,
    tva_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    payment_method    payment_method,                                  -- renseigné à l'encaissement par le caissier
    amount_received   NUMERIC(12,2),
    change_given      NUMERIC(12,2),
    validated_by      UUID REFERENCES users(id) ON DELETE SET NULL,    -- caissier ayant encaissé
    validated_at      TIMESTAMPTZ,
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_merchant ON orders(merchant_id);
CREATE INDEX idx_orders_status ON orders(merchant_id, status);

-- Lignes de commande : détail des produits vendus.
-- unit_price est dupliqué ici pour figer le prix au moment de la vente
-- (le prix catalogue peut changer plus tard sans affecter l'historique).
CREATE TABLE order_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    unit_price      NUMERIC(12,2) NOT NULL,
    line_total      NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);

-- ---------------------------------------------------------
-- 7. Déclencheur : maintenir updated_at à jour automatiquement
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_merchants_updated_at BEFORE UPDATE ON merchants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_clients_updated_at BEFORE UPDATE ON clients
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- 8. Fournisseurs
-- ---------------------------------------------------------
CREATE TABLE suppliers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    phone           VARCHAR(30),
    email           VARCHAR(150),
    address         TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_suppliers_merchant ON suppliers(merchant_id);

-- ---------------------------------------------------------
-- 9. Commandes fournisseurs (bons de commande)
-- ---------------------------------------------------------
CREATE TYPE purchase_order_status AS ENUM ('envoyee', 'recue', 'annulee');

CREATE TABLE purchase_orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    supplier_id     UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    status          purchase_order_status NOT NULL DEFAULT 'envoyee',
    total_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchase_orders_merchant ON purchase_orders(merchant_id);

CREATE TABLE purchase_order_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id   UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id          UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity            INTEGER NOT NULL CHECK (quantity > 0),
    unit_cost           NUMERIC(12,2) NOT NULL,
    line_total          NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_cost) STORED
);

CREATE INDEX idx_purchase_order_items_po ON purchase_order_items(purchase_order_id);

CREATE TRIGGER trg_suppliers_updated_at BEFORE UPDATE ON suppliers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_purchase_orders_updated_at BEFORE UPDATE ON purchase_orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- 10. Permissions d'affichage par membre d'équipe (NULL = accès complet du rôle)
-- ---------------------------------------------------------
ALTER TABLE users ADD COLUMN visible_modules TEXT[];
