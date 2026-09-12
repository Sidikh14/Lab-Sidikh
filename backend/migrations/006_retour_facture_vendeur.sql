-- Migration 006c : ajoute la valeur 'renvoyee_vendeur' à l'enum order_status
--
-- orders.status est un type ENUM Postgres (order_status), pas une simple
-- colonne texte — c'est pour ça que la mise à jour vers 'renvoyee_vendeur'
-- échouait avec "invalid input value for enum order_status".
--
-- Important : cette instruction doit être exécutée seule (pas dans la même
-- transaction qu'une requête qui utilise déjà cette nouvelle valeur). Si tu
-- l'exécutes via l'éditeur SQL Neon comme les migrations précédentes, ça
-- passera tout seul.

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'renvoyee_vendeur';