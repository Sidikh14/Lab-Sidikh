-- Migration 046 : cycles de zakat (hawl lunaire, ~354 jours).
-- Un seul cycle actif (closed_at IS NULL) par commerçant à la fois. Quand
-- 354 jours se sont écoulés depuis cycle_start, le cycle actif est figé
-- (closed_at + montants de l'instant) et un nouveau cycle démarre à 0.

CREATE TABLE IF NOT EXISTS zakat_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  cycle_start DATE NOT NULL,
  closed_at TIMESTAMPTZ,

  valeur_stock NUMERIC(14,2),
  creances_clients NUMERIC(14,2),
  dettes_fournisseurs NUMERIC(14,2),
  base NUMERIC(14,2),
  montant NUMERIC(14,2),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un seul cycle ouvert à la fois par commerçant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_zakat_cycles_actif
  ON zakat_cycles(merchant_id)
  WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_zakat_cycles_merchant
  ON zakat_cycles(merchant_id, closed_at DESC);
