-- 076_permissions_comptable.sql
-- Les pages de finance (comptabilite, fiscalite, paie) deviennent des permissions par membre, stockées dans
-- users.visible_modules. Un comptable dont les permissions avaient déjà été personnalisées (tableau non vide ou
-- vide) n'avait aucune clé de finance : on lui ajoute les trois pour qu'il garde l'accès actuel. Le manager peut
-- ensuite décocher les pages voulues dans Équipe > Permissions.
-- À exécuter une seule fois.

UPDATE users
SET visible_modules = (
  SELECT ARRAY(SELECT DISTINCT m FROM unnest(COALESCE(visible_modules, '{}'::text[]) || ARRAY['comptabilite', 'fiscalite', 'paie']) AS m)
)
WHERE visible_modules IS NOT NULL
  AND (role::text = 'comptable' OR 'comptable' = ANY (COALESCE(roles, ARRAY[]::text[])));
