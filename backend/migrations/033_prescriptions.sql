BEGIN;

ALTER TABLE products ADD COLUMN IF NOT EXISTS requires_prescription BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  warehouse_id UUID REFERENCES warehouses(id),
  patient_name TEXT NOT NULL,
  doctor_name TEXT,
  prescription_date DATE NOT NULL,
  insurer_name TEXT,
  insurer_member_number TEXT,
  coverage_rate NUMERIC,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS prescription_id UUID REFERENCES prescriptions(id);

COMMIT;
