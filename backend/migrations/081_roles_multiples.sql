-- 077 : plusieurs rôles par personne + rôle « comptable ».
-- users.roles liste tous les rôles ; users.role reste le rôle principal (lu par l'ancien code).
ALTER TABLE users ADD COLUMN IF NOT EXISTS roles text[];

-- Reprise de l'existant : l'ancien « vendeur_caissier » devient vendeur + caissier.
UPDATE users
SET roles = CASE role::text WHEN 'vendeur_caissier' THEN ARRAY['vendeur', 'caissier'] ELSE ARRAY[role::text] END
WHERE roles IS NULL AND role IS NOT NULL;

-- Autorise la valeur « comptable » dans users.role (type énuméré ou contrainte CHECK, s'il y en a).
-- À exécuter seule si votre base utilise un type énuméré (ALTER TYPE ... ADD VALUE).
DO $$
DECLARE
  v_type text;
  v_udt text;
  r record;
  v_recree boolean := false;
  v_liste text;
BEGIN
  SELECT data_type, udt_name INTO v_type, v_udt
  FROM information_schema.columns
  WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'role';

  IF v_type = 'USER-DEFINED' THEN
    EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', v_udt, 'comptable');
  END IF;

  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'users'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%' AND pg_get_constraintdef(oid) NOT ILIKE '%comptable%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%roles%'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', r.conname);
    v_recree := true;
  END LOOP;

  IF v_recree THEN
    -- Valeurs connues + toutes celles déjà présentes en base, pour ne jamais invalider une ligne existante.
    SELECT string_agg(quote_literal(x), ', ') INTO v_liste FROM (
      SELECT unnest(ARRAY['owner', 'manager', 'gerant', 'vendeur', 'caissier', 'vendeur_caissier', 'comptable'])
      UNION SELECT role::text FROM users WHERE role IS NOT NULL
    ) t(x);
    EXECUTE format('ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (%s))', v_liste);
  END IF;
END $$;
