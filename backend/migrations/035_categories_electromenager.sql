-- Crée les catégories électroménager de départ pour les commerces
-- électroménager déjà inscrits avant ce chantier (les nouveaux commerces
-- les reçoivent automatiquement via auth.routes.js à l'inscription).
--
-- ON CONFLICT DO NOTHING : sans danger à ré-exécuter, ne duplique rien si
-- une catégorie du même nom existe déjà chez un commerçant (index unique
-- categories(merchant_id, name)).

INSERT INTO categories (merchant_id, name)
SELECT m.id, cat.name
FROM merchants m
CROSS JOIN (VALUES
  ('Réfrigérateurs & Congélateurs'),
  ('Climatiseurs'),
  ('Machines à laver'),
  ('Téléviseurs'),
  ('Cuisinières & Fours'),
  ('Micro-ondes'),
  ('Ventilateurs'),
  ('Chauffe-eau'),
  ('Aspirateurs'),
  ('Petit électroménager'),
  ('Audio & Son'),
  ('Téléphones & Tablettes'),
  ('Groupes électrogènes'),
  ('Accessoires & Pièces détachées'),
  ('Autres')
) AS cat(name)
WHERE m.sector = 'electromenager'
ON CONFLICT (merchant_id, name) DO NOTHING;
