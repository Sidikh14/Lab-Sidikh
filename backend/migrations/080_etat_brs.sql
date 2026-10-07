-- 076 : autorise le type de paiement « brs » dans accounting_state_payments.
-- À exécuter seule (pas dans le même lot que d'autres instructions), comme la ligne ALTER TYPE de la 073.
-- Sans effet si la colonne `kind` n'a ni type énuméré ni contrainte CHECK.
DO $$
DECLARE
  v_udt text;
  v_type text;
  r record;
  v_recree boolean := false;
BEGIN
  SELECT data_type, udt_name INTO v_type, v_udt
  FROM information_schema.columns
  WHERE table_schema = current_schema() AND table_name = 'accounting_state_payments' AND column_name = 'kind';

  IF v_type = 'USER-DEFINED' THEN
    EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', v_udt, 'brs');
  END IF;

  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'accounting_state_payments'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%kind%' AND pg_get_constraintdef(oid) NOT ILIKE '%brs%'
  LOOP
    EXECUTE format('ALTER TABLE accounting_state_payments DROP CONSTRAINT %I', r.conname);
    v_recree := true;
  END LOOP;

  IF v_recree THEN
    ALTER TABLE accounting_state_payments
      ADD CONSTRAINT accounting_state_payments_kind_check
      CHECK (kind IN ('tva', 'retenues', 'css', 'ipres', 'cfce', 'is', 'brs'));
  END IF;
END $$;
