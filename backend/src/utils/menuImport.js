// Import d'une carte de restaurant (catégories, plats, options) à partir d'un objet JSON.
// Le JSON est produit à partir du PDF du menu. Tous les prix sont TTC (aucun affichage de TVA sur la carte).
// La fonction ne gère PAS la transaction : l'appelant fait BEGIN / COMMIT / ROLLBACK.
const crypto = require('crypto');

const STATIONS = ['cuisine', 'bar'];
const SERVICES = ['entree', 'plat', 'dessert', 'boisson'];
const MODES = ['unique', 'multiple'];
const MAX_TEXTE = 500;
const MAX_NOM = 150;

function texte(valeur, max, nomChamp, erreurs) {
  if (valeur === undefined || valeur === null || valeur === '') return null;
  if (typeof valeur !== 'string' || valeur.length > max) {
    erreurs.push(`${nomChamp} : texte invalide (${max} caractères maximum)`);
    return null;
  }
  return valeur.trim();
}

function prixTTC(valeur, nomChamp, erreurs) {
  const n = Number(valeur);
  if (!Number.isFinite(n) || n < 0) {
    erreurs.push(`${nomChamp} : prix TTC invalide`);
    return 0;
  }
  return Math.round(n); // francs entiers
}

// Vérifie le JSON avant toute écriture. Renvoie { ok, erreurs, menu }.
function validerMenu(menu) {
  const erreurs = [];
  if (!menu || !Array.isArray(menu.categories) || menu.categories.length === 0) {
    return { ok: false, erreurs: ['Le menu doit contenir au moins une catégorie.'] };
  }
  const categories = menu.categories.map((cat, i) => {
    const nomCat = texte(cat.name, MAX_NOM, `Catégorie ${i + 1} : nom`, erreurs);
    if (!nomCat) erreurs.push(`Catégorie ${i + 1} : nom requis`);
    const items = Array.isArray(cat.items) ? cat.items : [];
    return {
      name: nomCat,
      items: items.map((it, j) => {
        const label = `${nomCat || `Catégorie ${i + 1}`} / plat ${j + 1}`;
        const nom = texte(it.name, MAX_NOM, `${label} : nom`, erreurs);
        if (!nom) erreurs.push(`${label} : nom requis`);
        const station = it.station || 'cuisine';
        if (!STATIONS.includes(station)) erreurs.push(`${label} : station invalide (${STATIONS.join(', ')})`);
        const service = it.course || 'plat';
        if (!SERVICES.includes(service)) erreurs.push(`${label} : service invalide (${SERVICES.join(', ')})`);
        const options = (Array.isArray(it.options) ? it.options : []).map((g) => {
          const mode = g.mode || 'unique';
          if (!MODES.includes(mode)) erreurs.push(`${label} : mode d'option invalide`);
          return {
            name: texte(g.name, MAX_NOM, `${label} : groupe d'options`, erreurs) || 'Options',
            mode,
            required: g.required === true,
            min: Number.isInteger(g.min) && g.min >= 0 ? g.min : 0,
            max: Number.isInteger(g.max) && g.max >= 1 ? g.max : 1,
            choices: (Array.isArray(g.choices) ? g.choices : []).map((c) => ({
              name: texte(c.name, MAX_NOM, `${label} : option`, erreurs) || '',
              priceDelta: Math.round(Number(c.priceDelta || 0)),
            })),
          };
        });
        return {
          name: nom,
          description: texte(it.description, MAX_TEXTE, `${label} : description`, erreurs),
          ingredients: texte(it.ingredients, MAX_TEXTE, `${label} : ingrédients`, erreurs),
          price: prixTTC(it.price, `${label}`, erreurs),
          station,
          course: service,
          prepMinutes: Number.isInteger(it.prepMinutes) && it.prepMinutes >= 0 ? it.prepMinutes : null,
          allergens: Array.isArray(it.allergens) ? it.allergens.map(String).slice(0, 30) : [],
          regimes: Array.isArray(it.regimes) ? it.regimes.map(String).slice(0, 30) : [],
          options,
        };
      }),
    };
  });
  return { ok: erreurs.length === 0, erreurs, menu: { categories } };
}

// Crée la carte en base. À appeler dans une transaction.
// Chaque plat est rattaché au restaurant (warehouseId) via product_warehouses.
// Un plat dont le nom existe déjà dans la même catégorie n'est pas recréé : il est simplement rattaché
// à ce restaurant s'il ne l'était pas (même plat, même prix, plusieurs restaurants).
async function importerMenu(client, merchantId, menu, warehouseId) {
  if (!warehouseId) throw new Error('warehouseId requis pour importer une carte.');
  const rapport = { categoriesCreees: 0, categoriesExistantes: 0, platsCrees: 0, platsRattaches: 0, platsIgnores: [] };

  for (const cat of menu.categories) {
    const existante = await client.query(
      'SELECT id FROM categories WHERE merchant_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1',
      [merchantId, cat.name]
    );
    let categoryId;
    if (existante.rows.length) {
      categoryId = existante.rows[0].id;
      rapport.categoriesExistantes += 1;
    } else {
      const creee = await client.query(
        'INSERT INTO categories (merchant_id, name) VALUES ($1, $2) RETURNING id',
        [merchantId, cat.name]
      );
      categoryId = creee.rows[0].id;
      rapport.categoriesCreees += 1;
    }

    for (const it of cat.items) {
      const doublon = await client.query(
        'SELECT id FROM products WHERE merchant_id = $1 AND category_id = $2 AND LOWER(name) = LOWER($3) LIMIT 1',
        [merchantId, categoryId, it.name]
      );
      if (doublon.rows.length) {
        const lien = await client.query(
          `INSERT INTO product_warehouses (product_id, warehouse_id, merchant_id)
           VALUES ($1, $2, $3) ON CONFLICT (product_id, warehouse_id) DO NOTHING`,
          [doublon.rows[0].id, warehouseId, merchantId]
        );
        if (lien.rowCount > 0) rapport.platsRattaches += 1;
        else rapport.platsIgnores.push(it.name); // déjà à la carte de ce restaurant
        continue;
      }

      const sku = `PLAT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const attributes = { allergens: it.allergens, regimes: it.regimes };
      const produit = await client.query(
        `INSERT INTO products
           (merchant_id, category_id, name, sku, unit_price, is_active, is_activated,
            is_dish, station, course, prep_minutes, description, ingredients_text,
            attributes, track_stock, available)
         VALUES ($1, $2, $3, $4, $5, TRUE, TRUE, TRUE, $6, $7, $8, $9, $10, $11, FALSE, TRUE)
         RETURNING id`,
        [merchantId, categoryId, it.name, sku, it.price, it.station, it.course,
         it.prepMinutes, it.description, it.ingredients, JSON.stringify(attributes)]
      );
      const productId = produit.rows[0].id;
      rapport.platsCrees += 1;
      await client.query(
        'INSERT INTO product_warehouses (product_id, warehouse_id, merchant_id) VALUES ($1, $2, $3)',
        [productId, warehouseId, merchantId]
      );

      for (const g of it.options) {
        const groupe = await client.query(
          `INSERT INTO product_option_groups (merchant_id, name, selection_mode, required, min_choices, max_choices)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [merchantId, g.name, g.mode, g.required, g.min, g.max]
        );
        const groupeId = groupe.rows[0].id;
        await client.query(
          'INSERT INTO product_group_links (product_id, group_id) VALUES ($1, $2)',
          [productId, groupeId]
        );
        for (const [position, c] of g.choices.entries()) {
          if (!c.name) continue;
          await client.query(
            'INSERT INTO product_options (group_id, name, price_delta, position) VALUES ($1, $2, $3, $4)',
            [groupeId, c.name, c.priceDelta, position]
          );
        }
      }
    }
  }
  return rapport;
}

module.exports = { validerMenu, importerMenu };
