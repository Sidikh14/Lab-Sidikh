-- Prix d'achat (prix de revient) du produit — nécessaire pour calculer la
-- marge (prix de vente - prix d'achat), absent jusqu'ici : seul le prix de
-- vente (unit_price) était stocké.
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price NUMERIC NOT NULL DEFAULT 0;
