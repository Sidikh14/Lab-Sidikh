-- Migration 018 : Réductions commerciales (remise / rabais / ristourne / escompte)

ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_type TEXT
  CHECK (discount_type IN ('remise','rabais','ristourne','escompte'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_mode TEXT
  CHECK (discount_mode IN ('pourcentage','montant'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_value NUMERIC(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) DEFAULT 0;
