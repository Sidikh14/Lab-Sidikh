-- Coût d'achat unitaire figé au moment de la vente (base du calcul du bénéfice).
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_cost numeric;

-- Anciennes lignes : on applique le prix d'achat actuel du produit (approximation).
UPDATE order_items oi
SET unit_cost = p.cost_price
FROM products p
WHERE p.id = oi.product_id AND oi.unit_cost IS NULL;
