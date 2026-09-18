-- =========================================================
-- Migration 021 — Multi-dépôts (boutiques)
-- =========================================================
-- Décisions :
--  - Plusieurs boutiques actives, chacune avec son propre stock.
--  - gérant/caissier/vendeur assignés à UNE boutique fixe (users.warehouse_id).
--  - manager : toujours global (warehouse_id NULL), choisit la boutique
--    manuellement à chaque vente/entrée de stock qu'il fait lui-même.
--  - Employé assigné à une boutique ne voit QUE le stock/les ventes de
--    cette boutique (isolation stricte, pas de vue globale filtrable).
--  - product_stock devient la source de vérité du stock (remplace
--    products.quantity_in_stock, colonne conservée mais dépréciée/plus
--    mise à jour après cette migration).
--  - Transferts de stock entre boutiques inclus (stock_transfers).
-- =========================================================

-- ---------------------------------------------------------
-- 1. Boutiques
-- ---------------------------------------------------------
CREATE TABLE warehouses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    address         TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_warehouses_merchant ON warehouses(merchant_id);

CREATE TRIGGER trg_warehouses_updated_at BEFORE UPDATE ON warehouses
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- 2. Stock par boutique (remplace products.quantity_in_stock)
--    NUMERIC(12,3) pour rester cohérent avec les produits vendus au poids
--    (migration 019).
-- ---------------------------------------------------------
CREATE TABLE product_stock (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id         UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    product_id          UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    warehouse_id        UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    quantity_in_stock   NUMERIC(12,3) NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_id, warehouse_id)
);

CREATE INDEX idx_product_stock_product ON product_stock(product_id);
CREATE INDEX idx_product_stock_warehouse ON product_stock(warehouse_id);

CREATE TRIGGER trg_product_stock_updated_at BEFORE UPDATE ON product_stock
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- 3. Affectation boutique par membre d'équipe et par vente
-- ---------------------------------------------------------
ALTER TABLE users ADD COLUMN warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;

-- ---------------------------------------------------------
-- 4. Mouvements de stock : rattachés à une boutique, + type "transfert"
-- ---------------------------------------------------------
ALTER TABLE stock_movements ADD COLUMN warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;
ALTER TABLE stock_movements ADD COLUMN transfer_id UUID;

ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'transfert';

-- ---------------------------------------------------------
-- 5. Transferts de stock entre boutiques
-- ---------------------------------------------------------
CREATE TYPE transfer_status AS ENUM ('envoye', 'recu', 'annule');

CREATE TABLE stock_transfers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_seq        BIGSERIAL,
    merchant_id         UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    from_warehouse_id   UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    to_warehouse_id     UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    status              transfer_status NOT NULL DEFAULT 'envoye',
    notes               TEXT,
    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    received_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    received_at         TIMESTAMPTZ,
    cancelled_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    cancelled_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (from_warehouse_id != to_warehouse_id)
);

CREATE INDEX idx_stock_transfers_merchant ON stock_transfers(merchant_id);

CREATE TABLE stock_transfer_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id     UUID NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity        NUMERIC(12,3) NOT NULL CHECK (quantity > 0)
);

CREATE INDEX idx_stock_transfer_items_transfer ON stock_transfer_items(transfer_id);

ALTER TABLE stock_movements ADD CONSTRAINT fk_stock_movements_transfer
    FOREIGN KEY (transfer_id) REFERENCES stock_transfers(id) ON DELETE SET NULL;

-- ---------------------------------------------------------
-- 6. Backfill — un commerçant qui n'a jamais eu de multi-dépôt bascule sur
--    une boutique unique "Boutique principale" qui reprend tout le stock,
--    tous les membres d'équipe non-manager, et toutes les commandes.
--    À exécuter UNE SEULE FOIS, avant toute création manuelle d'une 2e
--    boutique par un commerçant.
-- ---------------------------------------------------------
DO $$
DECLARE
    m RECORD;
    v_warehouse_id UUID;
BEGIN
    FOR m IN SELECT id FROM merchants LOOP
        INSERT INTO warehouses (merchant_id, name)
        VALUES (m.id, 'Boutique principale')
        RETURNING id INTO v_warehouse_id;

        -- Stock existant → product_stock de la boutique principale
        INSERT INTO product_stock (merchant_id, product_id, warehouse_id, quantity_in_stock)
        SELECT m.id, p.id, v_warehouse_id, p.quantity_in_stock
        FROM products p
        WHERE p.merchant_id = m.id;

        -- Employés non-manager → assignés à la boutique principale
        UPDATE users SET warehouse_id = v_warehouse_id
        WHERE merchant_id = m.id AND role != 'manager';

        -- Commandes existantes → rattachées à la boutique principale
        UPDATE orders SET warehouse_id = v_warehouse_id
        WHERE merchant_id = m.id;
    END LOOP;
END $$;

-- Après cette migration : products.quantity_in_stock n'est PLUS mise à
-- jour par le code applicatif (product_stock est la source de vérité).
-- La colonne est conservée pour ne pas casser les anciens PDF/exports qui
-- la lisent encore, mais elle deviendra obsolète/figée à sa valeur au
-- moment de cette migration.
