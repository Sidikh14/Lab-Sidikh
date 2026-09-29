-- =========================================================
-- Migration 025 — Un gérant peut être affecté à plusieurs lieux
-- =========================================================
-- Décisions :
--  - user_warehouses : lieux (boutiques ET dépôts) auxquels un membre est
--    affecté. Un gérant peut en avoir plusieurs ; les autres rôles un seul.
--  - users.warehouse_id est conservé comme lieu PRINCIPAL (utilisé par les
--    routes qui ne gèrent pas encore le multi-lieux) ; il fait toujours
--    partie des lieux de user_warehouses.
--  - Les affectations existantes sont reprises telles quelles.
-- =========================================================

CREATE TABLE IF NOT EXISTS user_warehouses (
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    warehouse_id  UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_user_warehouses_warehouse ON user_warehouses(warehouse_id);

INSERT INTO user_warehouses (user_id, warehouse_id)
SELECT id, warehouse_id FROM users
WHERE warehouse_id IS NOT NULL AND role <> 'manager'
ON CONFLICT DO NOTHING;
