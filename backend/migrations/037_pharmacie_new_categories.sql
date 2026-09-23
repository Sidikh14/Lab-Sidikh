-- Migration 037 : ajoute les nouvelles catégories (Blog Beauté, Parfumerie,
-- Visage, Corps, etc.) aux commerçants du secteur pharmacie déjà inscrits.
-- Les nouveaux comptes les reçoivent automatiquement depuis
-- data/pharmacieCatalogue.js (POST /auth/register) — cette migration ne
-- couvre que les comptes existants. ON CONFLICT DO NOTHING : un commerçant
-- ayant déjà une catégorie de même nom (créée manuellement) n'est pas
-- dupliqué.
BEGIN;

DO $$
DECLARE
  m RECORD;
  cat TEXT;
  nouvelles_categories TEXT[] := ARRAY[
    'Blog Beauté',
    'Atelier De Préparation Produit Cosmétique',
    'Paramédical',
    'Soins intimes & sexualité',
    'Catégorie par défaut',
    'Santé',
    'Visage',
    'Maquillage',
    'Corps',
    'Diagnostic de peau',
    'Parfumerie',
    'Cheveux',
    'Bouche et dents',
    'Maman & Bébé',
    'Parapharmacie'
  ];
BEGIN
  FOR m IN SELECT id FROM merchants WHERE sector = 'pharmacie' LOOP
    FOREACH cat IN ARRAY nouvelles_categories LOOP
      INSERT INTO categories (merchant_id, name)
      VALUES (m.id, cat)
      ON CONFLICT (merchant_id, name) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

COMMIT;
