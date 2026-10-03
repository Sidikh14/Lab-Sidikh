-- TVA déductible sur achats. tva_amount est INCLUS dans total_cost (montant payé TTC),
-- rattachée au premier mouvement d'un achat multi-articles comme total_cost.
-- À exécuter AVANT de déployer accounting_routes.js (la synchro des achats lit cette colonne).
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS tva_amount NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (tva_amount >= 0);

-- Compensation de TVA enregistrée avec un paiement de TVA (TVA déductible imputée).
ALTER TABLE accounting_state_payments ADD COLUMN IF NOT EXISTS offset_amount NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (offset_amount >= 0);
