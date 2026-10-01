-- Synchronisation automatique : les écritures sont générées à partir des
-- données déjà saisies dans l'application (salaires, charges, puis ventes,
-- achats, stock…). Chaque écriture automatique garde sa source pour pouvoir
-- être mise à jour ou supprimée si l'opération d'origine change.

-- Les identifiants des tables sources peuvent être de types différents.
ALTER TABLE accounting_entries ALTER COLUMN source_id TYPE TEXT USING source_id::text;
ALTER TABLE accounting_entries ADD COLUMN IF NOT EXISTS source_sig TEXT;

-- Une opération source ne peut produire qu'une seule écriture automatique
-- (les écritures manuelles et celles des charges ont leur propre logique).
CREATE UNIQUE INDEX IF NOT EXISTS uq_acc_entries_source
  ON accounting_entries (merchant_id, source_type, source_id)
  WHERE source_id IS NOT NULL AND source_type NOT IN ('manuel', 'charge');

-- Date à partir de laquelle la comptabilité reprend les opérations. Si elle
-- est vide, c'est le 1er janvier de l'année en cours.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS accounting_start_date DATE;
