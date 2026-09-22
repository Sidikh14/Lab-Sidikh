-- Marquage manuel "produit vital" (première nécessité / urgence), toutes
-- sections confondues. Ne modifie aucun comportement d'alerte existant :
-- l'alerte de seuil déjà en place (creerAlerte / product_updated) continue
-- de se déclencher normalement sur quantity_alert_threshold, qui est
-- simplement suggéré plus haut côté frontend quand ce booléen est coché.
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_vital BOOLEAN NOT NULL DEFAULT FALSE;
