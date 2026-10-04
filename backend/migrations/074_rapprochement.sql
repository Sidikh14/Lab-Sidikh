-- Rapprochement : comparaison du solde réel (relevé banque, application Wave ou
-- Orange Money, caisse comptée) au solde calculé par la comptabilité à la même date.
-- Aucune écriture comptable n'est générée : la table ne sert qu'à garder l'historique.
CREATE TABLE IF NOT EXISTS accounting_reconciliations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  account_code  VARCHAR(10) NOT NULL,          -- 571 caisse, 5211 Wave, 5212 Orange Money, 521 banque
  rec_date      DATE NOT NULL,                 -- date du solde réel
  real_balance  NUMERIC(18,2) NOT NULL,        -- solde réel saisi
  book_balance  NUMERIC(18,2) NOT NULL,        -- solde comptable à cette date, figé à l'enregistrement
  note          TEXT,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_acc_reconciliations_merchant
  ON accounting_reconciliations (merchant_id, rec_date DESC, created_at DESC);
