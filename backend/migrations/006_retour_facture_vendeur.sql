-- Migration 006 (corrigée) : retour de facture au vendeur avant encaissement
--
-- Version précédente : assigned_cashier_id était en INTEGER, ce qui ne
-- correspond pas au type UUID utilisé partout ailleurs dans ce schéma
-- (orders.id, users.id, etc.) — la contrainte de clé étrangère échoue dans
-- ce cas et aucune des 3 colonnes n'est créée.
--
-- Si vous avez déjà exécuté l'ancienne version 006 (celle avec INTEGER) et
-- qu'elle a échoué, cette version peut être exécutée directement : les
-- clauses IF NOT EXISTS/IF EXISTS gèrent les deux cas (rien n'a été créé,
-- ou colonne créée avec le mauvais type).

-- Au cas où l'ancienne version aurait partiellement réussi avec le mauvais type :
ALTER TABLE orders DROP COLUMN IF EXISTS assigned_cashier_id;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS assigned_cashier_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS returned_reason TEXT;