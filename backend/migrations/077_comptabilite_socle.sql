-- Migration 073 — socle de la comptabilité (décisions D1 à D10)
-- À exécuter sur la BRANCHE DE TEST Neon d'abord, en une seule fois.
-- Idempotente : peut être rejouée sans danger (IF NOT EXISTS partout).
-- Aucun CHECK sur source_type (de nouvelles sources apparaissent : perte, acompte…).

-- 1. Perte de stock (D9) : nouveau type de mouvement.
--    À exécuter SEUL, avant le reste (une valeur d'énumération ajoutée ne peut pas
--    être utilisée dans la même transaction).
ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'perte';

-- ===== À partir d'ici : le reste de la migration =====

-- 2. Pièces jointes (D5) : justificatifs rattachés à une charge, une facture, une immobilisation…
--    Stockées en base, 1,5 Mo maximum par pièce (compression faite côté navigateur).
CREATE TABLE IF NOT EXISTS accounting_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,           -- 'charge', 'facture', 'immobilisation', 'achat'…
  source_id   TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 1572864),
  content     BYTEA NOT NULL,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_acc_attachments_source ON accounting_attachments (merchant_id, source_type, source_id);

-- 3. Soldes d'ouverture (D6) : saisis en une fois, puis verrouillés (une ligne par commerçant).
CREATE TABLE IF NOT EXISTS accounting_opening_balances (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  UUID NOT NULL UNIQUE REFERENCES merchants(id) ON DELETE CASCADE,
  opening_date DATE NOT NULL,
  balances     JSONB NOT NULL,         -- trésorerie, créances, dettes, stock, immobilisations, capital
  validated_by UUID REFERENCES users(id),
  validated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. TVA optionnelle (D3) sur les factures de charges et les sorties de caisse.
--    (stock_movements.tva_amount existe déjà pour les achats.)
ALTER TABLE accounting_charge_bills ADD COLUMN IF NOT EXISTS amount_ht NUMERIC(14,2);
ALTER TABLE accounting_charge_bills ADD COLUMN IF NOT EXISTS vat_rate  NUMERIC(5,2);
ALTER TABLE accounting_charge_bills ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE cash_expenses ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

-- 5. Marqueur de période (D2, D10) : 'vente_tardive' ou 'correction' (NULL = écriture normale).
ALTER TABLE accounting_entries ADD COLUMN IF NOT EXISTS period_marker TEXT;

-- 6. Avances sur reliquat (D8) : acompte client (compte 419) tant que le produit n'est pas livré.
ALTER TABLE pending_reservations ADD COLUMN IF NOT EXISTS advance_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

-- 7. Valorisation des mouvements (pertes, ajustements) : coût unitaire au moment du mouvement.
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(14,4);

-- 8. Index pour la synchro et les états sur de gros volumes.
CREATE INDEX IF NOT EXISTS idx_acc_entries_merchant_date ON accounting_entries (merchant_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_orders_merchant_validated ON orders (merchant_id, validated_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_merchant_created ON stock_movements (merchant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cash_expenses_merchant_date ON cash_expenses (merchant_id, expense_date);

-- 9. Contrôle : ce qui doit exister après la migration (attendu : 11 lignes « OK »).
SELECT 'table ' || t AS element, CASE WHEN to_regclass('public.' || t) IS NOT NULL THEN 'OK' ELSE 'MANQUANT' END AS etat
FROM unnest(ARRAY['accounting_attachments', 'accounting_opening_balances']) AS t
UNION ALL
SELECT c.tbl || '.' || c.col,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = c.tbl AND column_name = c.col) THEN 'OK' ELSE 'MANQUANT' END
FROM (VALUES
  ('accounting_charge_bills', 'amount_ht'), ('accounting_charge_bills', 'vat_rate'), ('accounting_charge_bills', 'vat_amount'),
  ('cash_expenses', 'vat_amount'), ('accounting_entries', 'period_marker'),
  ('pending_reservations', 'advance_amount'), ('stock_movements', 'unit_cost')
) AS c(tbl, col)
UNION ALL
SELECT 'enum perte', CASE WHEN EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'stock_movement_type' AND e.enumlabel = 'perte') THEN 'OK' ELSE 'MANQUANT' END
UNION ALL
SELECT 'indexes', CASE WHEN (SELECT COUNT(*) FROM pg_indexes WHERE indexname IN ('idx_acc_entries_merchant_date', 'idx_orders_merchant_validated', 'idx_stock_movements_merchant_created', 'idx_cash_expenses_merchant_date', 'idx_acc_attachments_source')) = 5 THEN 'OK' ELSE 'MANQUANT' END;
