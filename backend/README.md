# API — Plateforme de gestion commerçants

## Installation

```bash
npm install
cp .env.example .env
# renseigner DATABASE_URL et JWT_SECRET dans .env
```

Exécuter le schéma de base de données (`schema.sql`) sur votre instance PostgreSQL :

```bash
psql "$DATABASE_URL" -f schema.sql
```

Démarrer le serveur :

```bash
npm run dev
```

## Endpoints principaux

| Méthode | Route | Rôles autorisés | Description |
|---|---|---|---|
| POST | `/auth/register` | clé admin requise (en-tête `X-Admin-Key`) | Crée un commerçant + son compte manager |
| POST | `/auth/login` | public | Connexion, retourne un token JWT + le nom du commerce |
| GET | `/products` | tous | Liste du stock avec statut (en_stock/faible/rupture) |
| POST | `/products` | manager, gerant | Créer un produit |
| PATCH | `/products/:id` | manager, gerant | Modifier un produit |
| POST | `/products/:id/stock-movement` | tous | Enregistrer une entrée/sortie de stock |
| DELETE | `/products/:id` | manager | Désactiver un produit |
| GET | `/clients` | tous | Liste des clients |
| POST | `/clients` | tous | Créer une fiche client |
| GET | `/orders` | tous | Liste des commandes récentes |
| POST | `/orders` | tous | Créer une commande (déduit le stock automatiquement) |
| PATCH | `/orders/:id/status` | manager, gerant | Changer le statut d'une commande |
| GET | `/users` | manager, gerant | Liste de l'équipe du commerce |
| POST | `/users` | manager, gerant | Créer un membre (manager→gérant/vendeur/caissier, gérant→vendeur) |
| PATCH | `/users/:id/status` | manager | Activer/désactiver un membre |
| PATCH | `/users/:id/permissions` | manager | Choisir les modules visibles pour un membre |
| GET | `/suppliers` | manager, gerant | Liste des fournisseurs |
| POST | `/suppliers` | manager, gerant | Créer un fournisseur |
| DELETE | `/suppliers/:id` | manager, gerant | Retirer un fournisseur |
| GET | `/purchase-orders` | manager, gerant | Liste des commandes fournisseurs |
| POST | `/purchase-orders` | manager, gerant | Créer une commande fournisseur |
| PATCH | `/purchase-orders/:id/status` | manager, gerant | Changer le statut (envoyée/reçue/annulée) |
| GET | `/purchase-orders/:id/pdf` | manager, gerant | Télécharger le bon de commande en PDF |
| PATCH | `/orders/:id/payment` | manager, caissier | Encaisser une vente (moyen de paiement, montant reçu) |
| GET | `/activity/today` | tous | Activité du jour (équipe entière pour manager/gérant, personnelle pour les autres) |

`/auth/register` est volontairement protégée : seule la personne connaissant
`ADMIN_REGISTRATION_KEY` peut créer un nouveau commerce sur la plateforme.
Les commerçants existants ajoutent ensuite leurs gérants/vendeurs/caissiers
via `/users`, qui ne nécessite pas cette clé.

## Rôles

- **manager** : accès complet
- **gérant** : stock, ventes, clients, fournisseurs, achats, ajout de vendeurs
- **vendeur** : crée des ventes, consulte stock/clients
- **caissier** : encaisse les ventes en attente (moyen de paiement, montant reçu/rendu)

Le manager peut personnaliser, pour chaque gérant/vendeur/caissier, les
modules visibles dans son interface (`/users/:id/permissions`).



Toutes les routes (sauf `/auth/*`) nécessitent l'en-tête :
`Authorization: Bearer <token>`

Le `merchant_id` est extrait du token à chaque requête : un commerçant ne peut
jamais voir ou modifier les données d'un autre.
