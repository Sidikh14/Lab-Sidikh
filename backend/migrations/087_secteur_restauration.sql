-- Étape 1 (M1) — secteur restauration
-- À EXÉCUTER SEUL, en premier, hors de toute transaction (règle ALTER TYPE).
-- Vérifier d'abord avec la requête de contrôle du dossier (typname business_sector).
ALTER TYPE business_sector ADD VALUE IF NOT EXISTS 'restauration';
