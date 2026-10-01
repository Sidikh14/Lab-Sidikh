-- Module comptabilité (SYSCOHADA). Accès activé commerçant par commerçant par l'owner.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS accounting_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS accounting_accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  code        VARCHAR(12) NOT NULL,
  label       TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, code)
);

CREATE TABLE IF NOT EXISTS accounting_journals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  code        VARCHAR(6) NOT NULL,
  label       TEXT NOT NULL,
  UNIQUE (merchant_id, code)
);

CREATE TABLE IF NOT EXISTS accounting_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  journal_id   UUID NOT NULL REFERENCES accounting_journals(id),
  entry_number BIGINT NOT NULL,
  entry_date   DATE NOT NULL,
  reference    TEXT,
  label        TEXT NOT NULL,
  source_type  TEXT NOT NULL DEFAULT 'manuel',
  source_id    UUID,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, entry_number)
);
CREATE INDEX IF NOT EXISTS idx_acc_entries_date ON accounting_entries (merchant_id, entry_date);

CREATE TABLE IF NOT EXISTS accounting_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    UUID NOT NULL REFERENCES accounting_entries(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  account_id  UUID NOT NULL REFERENCES accounting_accounts(id),
  debit       NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit      NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  label       TEXT,
  CHECK (debit = 0 OR credit = 0)
);
CREATE INDEX IF NOT EXISTS idx_acc_lines_account ON accounting_lines (merchant_id, account_id);
CREATE INDEX IF NOT EXISTS idx_acc_lines_entry ON accounting_lines (entry_id);
