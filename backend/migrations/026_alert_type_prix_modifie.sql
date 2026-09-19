-- Migration 025 : ajoute la valeur 'prix_modifie' à l'enum alert_type
-- (la migration 015_alertes.sql ne prévoyait que vente_elevee,
-- annulation_suspecte, rupture_imminente).
-- À exécuter dans la console SQL Neon, comme les migrations précédentes.

ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'prix_modifie';
