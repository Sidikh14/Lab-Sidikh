-- Migration 018 : entrées de caisse manuelles (symétrique des sorties)
-- Réutilise la table cash_expenses existante avec une colonne movement_type,
-- plutôt qu'une nouvelle table, pour garder tout l'historique caisse au
-- même endroit (relevé, PDF, calcul du théorique).

ALTER TABLE cash_expenses
  ADD COLUMN movement_type TEXT NOT NULL DEFAULT 'sortie'
  CHECK (movement_type IN ('sortie', 'entree'));

-- Toutes les lignes déjà existantes sont des sorties (comportement inchangé
-- pour l'historique) : le DEFAULT ci-dessus s'en charge automatiquement.
