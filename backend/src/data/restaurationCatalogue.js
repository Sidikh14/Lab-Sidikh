// Catalogue de démarrage du secteur restauration : catégories de carte et catégories d'économat (ingrédients).
// Appliqué uniquement à la création d'un nouveau commerce restauration (auth.routes.js, /register).
const CATEGORIES_RESTAURATION = [
  // Carte
  'Entrées',
  'Plats',
  'Grillades',
  'Poissons',
  'Accompagnements',
  'Desserts',
  'Boissons chaudes',
  'Boissons fraîches',
  'Bières',
  'Vins',
  'Cocktails',
  // Économat (ingrédients)
  'Économat · Viandes',
  'Économat · Poissons',
  'Économat · Légumes',
  'Économat · Épicerie',
  'Économat · Boissons',
];

module.exports = { CATEGORIES_RESTAURATION };
