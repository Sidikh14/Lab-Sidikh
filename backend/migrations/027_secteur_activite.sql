-- migration_023_secteur_activite.sql (RÉVISÉE)
-- Correction : merchants.sector existe déjà (texte libre, optionnel,
-- rempli dès /auth/register) — on ne crée PAS de nouvelle colonne,
-- on convertit celle qui existe en ENUM strict.
-- Optionnel avant d'exécuter : `SELECT DISTINCT sector FROM merchants;`
-- pour voir ce qu'il y a déjà en base. La migration gère de toute façon
-- toute valeur inattendue en la ramenant à 'grossiste' (voir CASE ci-dessous).

CREATE TYPE business_sector AS ENUM ('grossiste', 'pharmacie', 'electromenager', 'textile');

ALTER TABLE merchants
  ALTER COLUMN sector TYPE business_sector
  USING (
    CASE lower(trim(sector))
      WHEN 'grossiste' THEN 'grossiste'
      WHEN 'pharmacie' THEN 'pharmacie'
      WHEN 'electromenager' THEN 'electromenager'
      WHEN 'électroménager' THEN 'electromenager'
      WHEN 'textile' THEN 'textile'
      ELSE 'grossiste'
    END
  )::business_sector;

ALTER TABLE merchants ALTER COLUMN sector SET DEFAULT 'grossiste';
ALTER TABLE merchants ALTER COLUMN sector SET NOT NULL;

-- Champs opérationnels spécifiques au secteur, sur les produits.
-- JSONB plutôt que des colonnes dédiées par secteur : évite une migration
-- à chaque nouveau secteur ou nouveau champ. Contenu attendu, rempli par
-- StockPage.jsx selon SECTEURS[sector].champsProduitSup :
--   pharmacie      -> { "datePeremption": "2027-03-01", "numeroLot": "L2024-118" }
--   electromenager -> { "garantieMois": 12, "numeroSerie": "SN-88213" }
--   textile        -> { "couleur": "Bleu marine", "metrage": 4.5 }
ALTER TABLE products
  ADD COLUMN attributes JSONB NOT NULL DEFAULT '{}';

-- Pour ajouter un secteur plus tard (rappel, comme pour les autres ENUM) :
-- ALTER TYPE business_sector ADD VALUE 'nouveau_secteur';
