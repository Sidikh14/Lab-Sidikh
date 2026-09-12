-- Migration 007 : prix personnalisé et vente en rupture de stock autorisée
-- Réservés au manager (voir orders_routes.js : POST /orders, PUT /orders/:id).

-- Garde le prix normal du produit quand le manager applique un prix
-- personnalisé, pour traçabilité et futurs rapports de marges.
ALTER TABLE order_items ADD COLUMN original_unit_price NUMERIC(12,2);

-- Marque une commande où au moins un article a été vendu en rupture de
-- stock autorisée par le manager, pour la traçabilité.
ALTER TABLE orders ADD COLUMN stock_override BOOLEAN NOT NULL DEFAULT false;
