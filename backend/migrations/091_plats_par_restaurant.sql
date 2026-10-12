-- Migration 091 : plats par restaurant (une boutique = un restaurant d'un même commerçant).
-- Décision : le prix reste unique par plat (products.unit_price). Seule la présence sur la carte
-- et la disponibilité du jour sont propres à chaque restaurant.
-- Additive : aucune donnée existante n'est modifiée ni supprimée.
-- Prérequis : 088_carte_restauration.sql appliquée (ou rattrapée), boutiques (warehouses) et product_stock existantes.

BEGIN;

-- 1. Table de liaison : un plat est à la carte d'une boutique.
CREATE TABLE IF NOT EXISTS product_warehouses (
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  available BOOLEAN NOT NULL DEFAULT TRUE,   -- rupture ou indisponibilité du jour, dans CE restaurant
  PRIMARY KEY (product_id, warehouse_id)
);
CREATE INDEX IF NOT EXISTS idx_product_warehouses_warehouse ON product_warehouses (warehouse_id);

-- 2. Cohérence : le plat, la boutique et la liaison doivent appartenir au même commerçant.
CREATE OR REPLACE FUNCTION product_warehouses_check_merchant()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM products p
    JOIN warehouses w ON w.id = NEW.warehouse_id
    WHERE p.id = NEW.product_id
      AND p.merchant_id = NEW.merchant_id
      AND w.merchant_id = NEW.merchant_id
  ) THEN
    RAISE EXCEPTION 'Le plat et le restaurant doivent appartenir au même commerçant';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS product_warehouses_check_merchant ON product_warehouses;
CREATE TRIGGER product_warehouses_check_merchant
  BEFORE INSERT OR UPDATE OF product_id, warehouse_id, merchant_id ON product_warehouses
  FOR EACH ROW EXECUTE FUNCTION product_warehouses_check_merchant();

-- 3. Rattrapage : pour les commerçants du secteur restauration, chaque plat déjà présent dans une
-- boutique (product_stock) entre sur la carte de cette boutique. Idempotent.
INSERT INTO product_warehouses (product_id, warehouse_id, merchant_id, available)
SELECT DISTINCT ps.product_id, ps.warehouse_id, ps.merchant_id, p.available
FROM product_stock ps
JOIN products p ON p.id = ps.product_id
JOIN merchants m ON m.id = ps.merchant_id
WHERE m.sector = 'restauration'
ON CONFLICT (product_id, warehouse_id) DO NOTHING;

-- 4. Vérification : nombre de liaisons par restaurant, et plats sans restaurant (doivent être 0 si tout est rattaché).
SELECT w.name AS restaurant, COUNT(pw.product_id) AS plats_a_la_carte
FROM warehouses w
LEFT JOIN product_warehouses pw ON pw.warehouse_id = w.id
JOIN merchants m ON m.id = w.merchant_id AND m.sector = 'restauration'
GROUP BY w.name
ORDER BY w.name;

SELECT COUNT(*) AS plats_sans_restaurant
FROM products p
JOIN merchants m ON m.id = p.merchant_id AND m.sector = 'restauration'
WHERE NOT EXISTS (SELECT 1 FROM product_warehouses pw WHERE pw.product_id = p.id);

-- Tant que la vérification n'est pas validée, gardez ROLLBACK.
-- Pour enregistrer : remplacez ROLLBACK par COMMIT et relancez le bloc.
ROLLBACK;
