-- Migration 026 : ajoute à l'enum alert_type toutes les valeurs utilisées
-- par le système d'alertes non-bloquant (vente/stock/annulation), en plus
-- de prix_modifie déjà prévu par la migration 025.
-- Idempotent (IF NOT EXISTS) : peut être rejouée sans risque, y compris si
-- 025_alert_type_prix_modifie.sql a déjà été exécutée.
-- À exécuter dans la console SQL Neon, comme les migrations précédentes.

ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'prix_modifie';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'rupture_stock';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'seuil_stock';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'nouvelle_vente';
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'commande_annulee';