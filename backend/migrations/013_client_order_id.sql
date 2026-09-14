-- Migration 013 — idempotence des commandes créées hors-ligne.
--
-- Sans cette colonne, si la synchro envoie une vente au serveur, que la
-- requête réussit côté serveur mais que la réponse n'arrive jamais au
-- navigateur (coupure au mauvais moment), la vente en attente n'est pas
-- retirée de la file locale et sera réenvoyée au prochain essai → doublon.
--
-- client_order_id = le localId (UUID) généré par le navigateur au moment
-- de la création hors-ligne. UNIQUE + vérification applicative avant
-- insertion => une même vente hors-ligne ne peut jamais être insérée deux
-- fois, même en cas de ré-essai.

ALTER TABLE orders ADD COLUMN client_order_id UUID UNIQUE;

-- NULL pour toutes les ventes existantes (créées en ligne, pas concernées) —
-- comportement par défaut d'un ALTER TABLE ADD COLUMN sans valeur, rien à faire de plus.
