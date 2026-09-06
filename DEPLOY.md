# Déploiement sur Render

Ce dépôt contient un Blueprint (`render.yaml`) qui provisionne automatiquement
3 ressources : la base PostgreSQL, l'API backend et le frontend statique.

## 1. Pousser le projet sur GitHub

Render déploie à partir d'un dépôt Git. Poussez ce dossier (`backend/`,
`frontend/`, `render.yaml`) sur un dépôt GitHub.

## 2. Créer le Blueprint sur Render

1. Dans le tableau de bord Render : **New → Blueprint**
2. Connectez le dépôt GitHub contenant ce projet
3. Render détecte `render.yaml` et propose de créer les 3 ressources :
   - `commercants-db` (PostgreSQL)
   - `commercants-api` (service web Node)
   - `commercants-frontend` (site statique)
4. Cliquez sur **Apply**

`JWT_SECRET` et `ADMIN_REGISTRATION_KEY` sont générés automatiquement par
Render, vous n'avez rien à saisir. Retenez la valeur d'`ADMIN_REGISTRATION_KEY`
(onglet Environment du service backend) : c'est la clé à saisir sur la page
`/inscription` pour créer un nouveau commerce — sans elle, personne d'autre
ne peut en créer.

## 3. Initialiser le schéma de la base de données

Le Blueprint crée la base mais n'exécute pas `schema.sql` automatiquement.
Une fois `commercants-db` disponible :

1. Ouvrez la base sur le tableau de bord Render → onglet **Connect**
2. Copiez l'**External Database URL**
3. Depuis votre machine :

```bash
psql "URL_EXTERNE_COPIÉE" -f backend/schema.sql
```

### Données de démonstration (facultatif)

Pour tester rapidement sans tout ressaisir à la main, un jeu de données
de démonstration est disponible (1 commerce, 3 comptes — un par rôle —,
3 produits, 1 client, 1 commande) :

```bash
cd backend
DATABASE_URL="URL_EXTERNE_COPIÉE" NODE_ENV=production npm run seed
```

Le script affiche les emails et le mot de passe des 3 comptes créés à la fin
de son exécution.

## 4. Vérifier les URLs entre les deux services

Render attribue une URL du type `https://commercants-api-XXXX.onrender.com`
(un suffixe est ajouté si le nom est déjà pris). Si les URLs générées
diffèrent des valeurs par défaut dans `render.yaml` :

- Ouvrez **commercants-api → Environment** et corrigez `CORS_ORIGIN` avec
  l'URL réelle du frontend
- Ouvrez **commercants-frontend → Environment** et corrigez `VITE_API_URL`
  avec l'URL réelle de l'API, puis relancez un déploiement manuel du
  frontend (cette variable est lue au moment du build, pas à l'exécution)

## 5. Tester

Ouvrez l'URL du frontend, allez sur `/inscription`, saisissez la clé
`ADMIN_REGISTRATION_KEY` (copiée depuis l'Environment du backend) et créez
votre premier commerce. Si la connexion à l'API échoue, vérifiez dans les
logs de `commercants-api` que la base de données répond et que
`CORS_ORIGIN` correspond bien à l'URL du frontend.

## À savoir sur le plan gratuit Render

- Les services web gratuits se mettent en veille après une période
  d'inactivité ; la première requête qui les réveille peut prendre
  quelques dizaines de secondes.
- Les conditions du plan gratuit (durée de rétention de la base incluse)
  évoluent parfois — vérifiez les conditions actuelles sur
  https://render.com/pricing avant de vous engager en production.
