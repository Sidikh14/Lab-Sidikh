-- Migration 027 : numéro de facture fournisseur sur les entrées de stock
-- Idempotente (IF NOT EXISTS) pour pouvoir être rejouée sans risque.
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS invoice_number TEXT;
