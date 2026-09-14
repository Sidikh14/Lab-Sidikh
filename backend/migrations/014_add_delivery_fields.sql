-- Migration 013 : livraison planifiée à la carte (case à cocher au moment
-- de l'encaissement) + frais de livraison optionnels ajoutés à la facture.
--
-- Avant cette migration, toute commande rattachée à un client enregistré
-- passait automatiquement en statut 'validee' (donc dans "à livrer"), même
-- si aucune livraison n'était prévue. Désormais, c'est needs_delivery qui
-- pilote ce passage, décidé par le caissier à l'encaissement.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS needs_delivery BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(12, 2) NOT NULL DEFAULT 0;
