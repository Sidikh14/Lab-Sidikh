-- =========================================================
-- Migration 030 — Secteur pharmacie : activation produits + lots/péremption
-- =========================================================
-- Contexte :
--  1) Un produit fraîchement créé (ou le catalogue de départ pharmacie
--     inséré à l'inscription) démarre à quantity_in_stock = 0, ce qui le
--     fait apparaître IMMÉDIATEMENT en "Rupture" dans la liste, le PDF et
--     les alertes — avant même d'avoir reçu du stock. On ajoute un flag
--     is_activated : un produit non activé n'est jamais affiché en
--     rupture, il est "à activer" (l'activation se fait automatiquement
--     dès qu'une entrée de stock lui est faite).
--     Défaut TRUE pour ne rien changer aux secteurs autres que pharmacie
--     (grossiste/électroménager/textile continuent comme avant).
--  2) Gestion des lots avec date de péremption pour la pharmacie :
--     product_lots, un lot = une entrée de stock avec sa propre date de
--     péremption. Le décrément à la vente doit se faire en FEFO (premier
--     périmé, premier sorti), jamais en piochant un lot déjà périmé.
--     Additif : ne remplace pas product_stock (qui reste la source de
--     vérité du total par boutique), sert uniquement au suivi par lot et
--     au calcul FEFO côté pharmacie.
-- =========================================================

ALTER TABLE products ADD COLUMN is_activated BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE product_lots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    warehouse_id    UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    lot_number      VARCHAR(80),
    expiry_date     DATE NOT NULL,
    quantity        NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index FEFO : pour un produit+boutique donné, trouver vite le lot dont la
-- péremption est la plus proche parmi ceux qui ont encore du stock.
CREATE INDEX idx_product_lots_fefo ON product_lots(product_id, warehouse_id, expiry_date)
    WHERE quantity > 0;
CREATE INDEX idx_product_lots_merchant ON product_lots(merchant_id);

CREATE TRIGGER trg_product_lots_updated_at BEFORE UPDATE ON product_lots
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Catalogue de départ pharmacie déjà inséré (à l'inscription) avec un
-- stock à 0 : on le bascule en "non activé" pour ne pas polluer les
-- commerces pharmacie existants avec des faux "Rupture".
UPDATE products p
SET is_activated = FALSE
FROM merchants m
WHERE p.merchant_id = m.id
  AND m.sector = 'pharmacie'
  AND NOT EXISTS (
    SELECT 1 FROM product_stock ps
    WHERE ps.product_id = p.id AND ps.quantity_in_stock > 0
  );
