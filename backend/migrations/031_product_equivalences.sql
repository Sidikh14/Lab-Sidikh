-- Table de liaison symétrique entre produits équivalents (princeps <-> génériques).
-- Une paire (A, B) suffit à représenter l'équivalence dans les deux sens ;
-- la caisse s'en sert pour proposer une alternative disponible si l'un des
-- deux est en rupture / à activer.
CREATE TABLE IF NOT EXISTS product_equivalences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  product_id_1 UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_id_2 UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_equivalences_distinct CHECK (product_id_1 <> product_id_2)
);

-- Empêche les doublons quel que soit l'ordre des deux produits envoyés
-- (A,B) et (B,A) sont considérés comme la même liaison.
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_equivalences_pair
  ON product_equivalences (merchant_id, LEAST(product_id_1, product_id_2), GREATEST(product_id_1, product_id_2));

CREATE INDEX IF NOT EXISTS idx_product_equivalences_p1 ON product_equivalences (product_id_1);
CREATE INDEX IF NOT EXISTS idx_product_equivalences_p2 ON product_equivalences (product_id_2);
