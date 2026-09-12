-- Migration 008 : ventes à crédit et créances clients
--
-- 1. Ajoute 'a_credit' à l'enum du moyen de paiement, quel que soit son nom
--    réel (on l'a appris à nos dépens avec order_status : il ne faut jamais
--    supposer qu'une colonne de statut/type est du texte libre). Le bloc
--    DO ci-dessous détecte automatiquement le type réel de la colonne
--    orders.payment_method et n'agit que si c'est bien un ENUM.
--
-- 2. Crée la table credit_payments : chaque règlement (partiel ou total)
--    qu'un client fait sur sa créance.
--
-- Le montant de la créance d'un client n'est PAS stocké en colonne : il se
-- calcule à la volée (somme des ventes à crédit non soldées moins les
-- règlements déjà enregistrés), pour éviter tout risque de désynchronisation.

DO $$
DECLARE
  nom_type text;
BEGIN
  SELECT udt_name INTO nom_type
  FROM information_schema.columns
  WHERE table_name = 'orders' AND column_name = 'payment_method';

  IF nom_type IS NOT NULL AND nom_type NOT IN ('text', 'varchar', 'bpchar') THEN
    EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', nom_type, 'a_credit');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS credit_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  client_id UUID NOT NULL REFERENCES clients(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  recorded_by UUID REFERENCES users(id),
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_payments_client ON credit_payments(client_id);
