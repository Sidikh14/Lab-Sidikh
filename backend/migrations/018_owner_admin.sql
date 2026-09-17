-- Migration 017 : compte propriétaire (owner) + limite de comptes par
-- commerçant. Permet au propriétaire de la plateforme (vous seul) de créer
-- des commerçants, ajuster combien de comptes un manager peut créer, et
-- bloquer/supprimer n'importe quel commerçant ou utilisateur.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS max_team_members INTEGER NOT NULL DEFAULT 3;

-- Le compte owner n'est rattaché à aucun commerçant.
ALTER TABLE users
  ALTER COLUMN merchant_id DROP NOT NULL;

-- IMPORTANT : si la colonne "role" a une contrainte CHECK limitant les
-- valeurs autorisées, elle doit être étendue pour accepter 'owner', sinon
-- la création du compte propriétaire échouera. Vérifiez d'abord avec :
--
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'users'::regclass AND contype = 'c';
--
-- Si une contrainte de ce type existe (souvent nommée users_role_check),
-- adaptez-la ainsi (remplacez le nom si différent) :
--
--   ALTER TABLE users DROP CONSTRAINT users_role_check;
--   ALTER TABLE users ADD CONSTRAINT users_role_check
--     CHECK (role IN ('owner', 'manager', 'gerant', 'vendeur', 'caissier'));
