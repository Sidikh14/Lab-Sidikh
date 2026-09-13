-- Migration 011 : clôture de caisse quotidienne
--
-- Pour pouvoir calculer combien il y a réellement en caisse par moyen de
-- paiement (espèces, Wave, Orange Money, chèque, virement), il faut que
-- CHAQUE mouvement d'argent connaisse son moyen de paiement précis — ce qui
-- manquait sur les règlements de créance client, les règlements de dette
-- fournisseur, et les achats de stock au comptant (on savait juste "comptant",
-- pas avec quel moyen). On ajoute ces colonnes, puis les tables pour les
-- sorties de caisse manuelles et les clôtures quotidiennes.

ALTER TABLE credit_payments ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'especes'
  CHECK (payment_method IN ('especes', 'wave', 'orange_money', 'cheque', 'virement'));
ALTER TABLE credit_payments ALTER COLUMN payment_method DROP DEFAULT;

ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'especes'
  CHECK (payment_method IN ('especes', 'wave', 'orange_money', 'cheque', 'virement'));
ALTER TABLE supplier_payments ALTER COLUMN payment_method DROP DEFAULT;

-- Moyen de caisse utilisé pour un achat de stock "au comptant" (distinct de
-- stock_movements.payment_method qui vaut juste 'comptant' ou 'a_credit').
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS cash_method TEXT
  CHECK (cash_method IN ('especes', 'wave', 'orange_money', 'cheque', 'virement'));

-- Sorties de caisse manuelles : toute dépense qui n'est ni un achat de stock
-- ni un règlement fournisseur (loyer, transport, imprévu, etc.).
CREATE TABLE IF NOT EXISTS cash_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  user_id UUID REFERENCES users(id),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('especes', 'wave', 'orange_money', 'cheque', 'virement')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_expenses_merchant_date ON cash_expenses(merchant_id, expense_date);

-- Clôtures quotidiennes : un enregistrement par jour et par moyen de
-- paiement. theoretical_balance = mouvements du jour uniquement (calculé au
-- moment de la clôture) ; actual_balance = compté physiquement par
-- l'utilisateur ; difference = actual - theoretical.
CREATE TABLE IF NOT EXISTS cash_closings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  closing_date DATE NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('especes', 'wave', 'orange_money', 'cheque', 'virement')),
  theoretical_balance NUMERIC(12,2) NOT NULL,
  actual_balance NUMERIC(12,2) NOT NULL,
  difference NUMERIC(12,2) NOT NULL,
  notes TEXT,
  closed_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, closing_date, payment_method)
);
