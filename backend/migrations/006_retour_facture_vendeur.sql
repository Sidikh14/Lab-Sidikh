-- Migration 006 : retour de facture au vendeur avant encaissement
--
-- Ajoute le nécessaire pour que le caissier puisse renvoyer une commande
-- au vendeur (pour modification ou annulation) avant de l'encaisser, et
-- pour qu'elle revienne ensuite directement au même caissier.
--
-- Le statut 'renvoyee_vendeur' est une simple valeur texte dans la colonne
-- orders.status existante (pas de contrainte CHECK détectée dans le code
-- fourni) : aucune modification de contrainte n'est donc nécessaire ici.
-- Si votre table orders a une contrainte CHECK sur status, ajoutez-la
-- séparément avant d'exécuter cette migration.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS assigned_cashier_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS returned_reason TEXT;
