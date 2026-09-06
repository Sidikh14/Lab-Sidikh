-- Migration 002 — à exécuter sur la base déjà déployée (schema.sql seul ne suffit
-- plus pour une base existante). Ce fichier est idempotent : le relancer par
-- erreur ne casse rien.

-- ---------------------------------------------------------
-- Fournisseurs
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30),
    email VARCHAR(150),
    address TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_merchant ON suppliers(merchant_id);

-- ---------------------------------------------------------
-- Commandes fournisseurs (bons de commande)
-- ---------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_order_status') THEN
    CREATE TYPE purchase_order_status AS ENUM ('envoyee', 'recue', 'annulee');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    status purchase_order_status NOT NULL DEFAULT 'envoyee',
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_merchant ON purchase_orders(merchant_id);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC(12,2) NOT NULL,
    line_total NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_cost) STORED
);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po ON purchase_order_items(purchase_order_id);

-- ---------------------------------------------------------
-- TVA sur les ventes
-- ---------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tva_applicable BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tva_rate NUMERIC(5,2) NOT NULL DEFAULT 18;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tva_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------
-- Permissions d'affichage par membre d'équipe (NULL = accès complet par défaut du rôle)
-- ---------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS visible_modules TEXT[];

-- ---------------------------------------------------------
-- Déclencheurs updated_at pour les nouvelles tables
-- ---------------------------------------------------------
DROP TRIGGER IF EXISTS trg_suppliers_updated_at ON suppliers;
CREATE TRIGGER trg_suppliers_updated_at BEFORE UPDATE ON suppliers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_purchase_orders_updated_at ON purchase_orders;
CREATE TRIGGER trg_purchase_orders_updated_at BEFORE UPDATE ON purchase_orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- Rôle caissier
-- ---------------------------------------------------------
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'caissier';

-- ---------------------------------------------------------
-- Numéro de commande lisible + informations de paiement
-- ---------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN
    CREATE TYPE payment_method AS ENUM ('especes', 'wave', 'orange_money', 'cheque', 'virement');
  END IF;
END$$;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_seq BIGSERIAL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method payment_method;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_received NUMERIC(12,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS change_given NUMERIC(12,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS validated_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;
