-- Migration 076 : nouvelles notifications (écart de caisse, retours, transferts, règlements, lots périmés,
-- échéances fiscales) + destinataires par alerte (chacun ne voit que ses alertes).
-- Idempotente : peut être relancée sans risque. Adapter le numéro si 076 est déjà pris.
-- Exécuter les ALTER TYPE un par un si la console refuse de les enchaîner.

ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'ecart_caisse';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'retour_a_valider';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'retour_traite';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'transfert_recu';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'reglement_recu';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'lot_peremption';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'echeance_fiscale';
-- Types déjà utilisés par le code : ajoutés au cas où une migration précédente les aurait oubliés.
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'demande_credit';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'reliquat_cree';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'reliquat_disponible';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'commande_renvoyee_vendeur';

-- Qui peut voir l'alerte : des rôles ou des personnes précises. NULL = ancienne alerte (manager et gérant).
ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS destinataires_roles TEXT[],
  ADD COLUMN IF NOT EXISTS destinataires_users UUID[];
