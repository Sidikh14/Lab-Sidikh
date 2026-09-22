-- Ajoute la TVA par produit : certains produits (ex. médicaments au
-- Sénégal) sont exonérés de TVA, d'autres non. TRUE par défaut pour
-- préserver le comportement actuel (TVA 18% appliquée partout ailleurs).
ALTER TABLE products ADD COLUMN IF NOT EXISTS tva_applicable BOOLEAN NOT NULL DEFAULT TRUE;

-- Empêche deux catégories du même nom pour un même commerçant.
-- La table categories existe déjà (utilisée par products.category_id) ;
-- on n'y touche pas au-delà de cet index.
CREATE UNIQUE INDEX IF NOT EXISTS categories_merchant_name_unique
  ON categories (merchant_id, name);
