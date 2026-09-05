# Frontend — Carnet (gestion commerçants)

React + Vite, connecté à l'API backend.

## Installation

```bash
npm install
cp .env.example .env
# vérifier VITE_API_URL (par défaut http://localhost:4000)
npm run dev
```

L'application démarre sur http://localhost:5173. Le backend doit tourner en parallèle.

## Écrans

- `/inscription` — création d'un commerçant (crée le compte manager)
- `/connexion` — connexion
- `/` — tableau de bord : ventes du jour, alertes de rupture, commandes récentes
- `/stock` — liste des produits, ajout (manager/gérant), vente rapide (tous rôles)
- `/commandes` — historique des ventes, création d'une vente, changement de statut (manager/gérant)
- `/clients` — fiches clients, création (tous rôles)

## Droits par rôle

L'interface masque automatiquement les actions non autorisées selon le rôle renvoyé
par l'API (`manager`, `gerant`, `vendeur`) — mais la vérification réelle reste faite
côté backend à chaque requête, l'interface n'est qu'un confort d'usage.
