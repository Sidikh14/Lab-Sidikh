-- Migration 012 : échéance des ventes à crédit
--
-- credit_due_date : échéance fixée automatiquement à 30 jours après la
-- vente, posée uniquement sur les commandes payées à crédit. Affichée sur
-- le relevé de compte envoyé manuellement au client (pas d'envoi
-- automatique programmé).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS credit_due_date DATE;
