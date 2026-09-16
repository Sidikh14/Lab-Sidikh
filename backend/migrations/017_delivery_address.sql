-- Migration 016 : adresse de livraison sur les commandes
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;
