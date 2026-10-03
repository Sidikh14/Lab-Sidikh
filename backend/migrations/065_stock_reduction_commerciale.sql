-- Réduction commerciale obtenue sur un achat (en FCFA HT), rattachée au premier
-- mouvement de l'achat comme total_cost et tva_amount. total_cost reste le net
-- à payer TTC (HT après réduction + TVA).
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
