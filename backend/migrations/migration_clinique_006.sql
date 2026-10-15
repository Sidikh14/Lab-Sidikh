-- =====================================================================
-- Migration clinique 006 — étape 6 (pharmacie interne et consommables)
-- À exécuter dans Neon après migration_clinique_005.sql.
-- S'appuie sur les tables de stock existantes : product_stock, product_lots, stock_movements.
-- =====================================================================

-- Chaque sortie de pharmacie interne ou de consommable, lot par lot (FEFO).
-- Une sortie vers un patient porte patient_id ; une sortie de consommable en salle peut n'en avoir aucun.
CREATE TABLE IF NOT EXISTS clinic_dispensations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  product_id uuid NOT NULL REFERENCES products(id),
  lot_id uuid REFERENCES product_lots(id),
  quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
  client_id uuid REFERENCES clients(id),
  document_id uuid REFERENCES clinic_documents(id),
  consultation_id uuid REFERENCES consultations(id),
  motif varchar(200),
  dispensed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clinic_dispensations_client ON clinic_dispensations (merchant_id, client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_clinic_dispensations_product ON clinic_dispensations (merchant_id, product_id, created_at);

-- Les sorties sont tracées : on ne modifie ni ne supprime une dispensation.
CREATE OR REPLACE FUNCTION dispensation_immuable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Une dispensation ne peut être ni modifiée ni supprimée.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dispensation_immuable ON clinic_dispensations;
CREATE TRIGGER trg_dispensation_immuable
  BEFORE UPDATE OR DELETE ON clinic_dispensations
  FOR EACH ROW EXECUTE FUNCTION dispensation_immuable();

-- ---------------------------------------------------------------------
-- Vérifications à lancer AVANT les premiers tests : les routes utilisent ces valeurs.
-- Si la colonne movement_type est un enum, la liste renvoyée donne les valeurs exactes à utiliser.
-- ---------------------------------------------------------------------
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'clinic_dispensations';

SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'stock_movements' AND column_name IN ('movement_type', 'reason', 'quantity');
