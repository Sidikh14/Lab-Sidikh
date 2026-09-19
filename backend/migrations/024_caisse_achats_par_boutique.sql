-- =========================================================
-- Migration 022 — Caisse et achats fournisseurs par boutique
-- =========================================================
-- Suite de la migration 021 (multi-dépôts) : la caisse (clôtures, sorties,
-- entrées manuelles, relevés) et les commandes fournisseurs deviennent
-- propres à chaque boutique, avec la même isolation stricte que le stock
-- et les ventes (un employé assigné ne voit que SA boutique, le manager
-- choisit explicitement à chaque fois).
-- =========================================================

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;
ALTER TABLE credit_payments ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;
ALTER TABLE cash_expenses ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;

-- Une clôture par boutique et par moyen de paiement (au lieu d'une seule
-- pour tout le commerce) : chaque boutique clôture sa propre caisse.
-- Le nom exact de la contrainte UNIQUE d'origine (merchant_id,
-- closing_date, payment_method) n'est pas connu avec certitude selon la
-- migration qui l'a créée : on la retrouve dynamiquement par ses colonnes
-- plutôt que de deviner son nom, pour ne pas faire échouer la migration.
ALTER TABLE cash_closings ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;

DO $$
DECLARE
    v_constraint_name TEXT;
BEGIN
    -- Si la migration a déjà tourné en partie (échec précédent après ce
    -- point), la nouvelle contrainte peut déjà exister : ne rien faire.
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'cash_closings_unique_par_boutique'
    ) THEN
        RETURN;
    END IF;

    SELECT con.conname INTO v_constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'cash_closings'
      AND con.contype = 'u'
      AND (
        SELECT array_agg(attname::text ORDER BY attname)
        FROM unnest(con.conkey) AS colnum
        JOIN pg_attribute ON pg_attribute.attrelid = con.conrelid AND pg_attribute.attnum = colnum
      ) = ARRAY['closing_date', 'merchant_id', 'payment_method']::text[]
    LIMIT 1;

    IF v_constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE cash_closings DROP CONSTRAINT %I', v_constraint_name);
    END IF;

    ALTER TABLE cash_closings ADD CONSTRAINT cash_closings_unique_par_boutique
      UNIQUE (merchant_id, closing_date, payment_method, warehouse_id);
END $$;

-- ---------------------------------------------------------
-- Backfill — rattache tout l'historique existant à la "Boutique
-- principale" créée par la migration 021 pour chaque commerçant.
-- ---------------------------------------------------------
DO $$
DECLARE
    m RECORD;
    v_warehouse_id UUID;
BEGIN
    FOR m IN SELECT id FROM merchants LOOP
        SELECT id INTO v_warehouse_id FROM warehouses
        WHERE merchant_id = m.id AND name = 'Boutique principale'
        LIMIT 1;

        IF v_warehouse_id IS NOT NULL THEN
            UPDATE purchase_orders SET warehouse_id = v_warehouse_id WHERE merchant_id = m.id;
            UPDATE credit_payments SET warehouse_id = v_warehouse_id WHERE merchant_id = m.id;
            UPDATE supplier_payments SET warehouse_id = v_warehouse_id WHERE merchant_id = m.id;
            UPDATE cash_expenses SET warehouse_id = v_warehouse_id WHERE merchant_id = m.id;
            UPDATE cash_closings SET warehouse_id = v_warehouse_id WHERE merchant_id = m.id;
        END IF;
    END LOOP;
END $$;
