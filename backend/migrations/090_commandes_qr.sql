-- Étape 2 ter — commande depuis le QR et tableau du caissier.
-- BROUILLON : après 077, 078, 079. Vérifier au préalable les types de order_items.id et users.id.
-- Additive et idempotente.

-- Statut de validation d'une commande passée par QR, séparé du statut de paiement existant (status).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS qr_status TEXT
  CHECK (qr_status IN ('a_valider', 'acceptee', 'refusee'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS qr_decided_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS qr_decided_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Chaque table est rattachée à une boutique (le caissier de cette boutique voit ses commandes).
ALTER TABLE dining_tables ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id);

-- Note client sur une ligne de commande (« sans oignon », etc.).
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS note TEXT;

-- Choix retenus pour une ligne (cuisson, suppléments) : copie figée au moment de la commande.
CREATE TABLE IF NOT EXISTS order_item_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL,
  option_name TEXT NOT NULL,
  price_delta NUMERIC(12, 2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_orders_qr_table ON orders (merchant_id, dining_table_id, qr_status);
