# FluxLibre

Gestionnaire d'annonces **libre, local et open-source** pour **Leboncoin** et **Vinted**, inspiré des bases de [Flowdino](https://www.flowdino.com/) mais limité à deux plateformes et sans abonnement.

> ⚠️ **Statut : MVP / base de développement.** Les sites changent régulièrement de structure : les sélecteurs des adaptateurs doivent être maintenus. L'option `autoSubmit` est **désactivée par défaut** : l'extension remplit les champs et vous laisse valider.

## Fonctionnalités

- ✅ Base locale SQLite de toutes vos annonces (photos, prix, catégories, adresse)
- ✅ Publication sur Leboncoin + Vinted, adaptation des champs par plateforme
- ✅ Renouvellement : réactiver → supprimer → recréer (mode manuel ou auto)
- ✅ Renouvellement multiple sélectionnable, étalé (délai configurable)
- ✅ Mise à jour depuis Leboncoin (« MàJ ») : texte, prix, photos, catégorie, adresse
- ✅ Suivi de la date de dernier refresh avec code couleur (vert ≤ 4 j, orange ≤ 7 j, rouge > 10 j)
- ✅ Suppression d'une annonce sur les plateformes
- ✅ Génération des titres/descriptions par IA (OpenAI, Anthropic ou Ollama local)
- ✅ Préparation des photos (redimensionnement, webp, suppression EXIF) avec Sharp
- ✅ Interface web locale + popup et options de l'extension

## Architecture

```
apps/backend     Express + SQLite natif (node:sqlite), scheduler, IA, images → :7310
apps/extension   Extension Chrome MV3 : background (poll) + content scripts (DOM)
packages/shared  Types TypeScript communs
```

Les sites n'exposent pas d'API publique de publication. Le backend crée donc des **tâches** (`publish`, `renew`, `pause`, `delete`, `sync`, `enrich`, `refresh`) ; l'extension les récupère, ouvre la page concernée et pilote le formulaire via le DOM. Les données restent sur votre machine (`~/.fluxlibre`).

## Installation

Prérequis : **Node.js ≥ 22.5** (SQLite natif `node:sqlite`) et **pnpm ≥ 9**.

```bash
pnpm install
pnpm dev
```

Le backend démarre sur `http://localhost:7310` (dashboard inclus). L'extension est compilée dans `apps/extension/dist`.

Pour charger l'extension dans Chrome :

1. Ouvrir `chrome://extensions`
2. Activer le **mode développeur**
3. **Charger l'extension non empaquetée** → sélectionner `apps/extension/dist`
4. Cliquer sur l'icône FluxLibre → **Options** → vérifier l'URL du backend

Build de production :

```bash
pnpm build
```

## Utilisation

1. Dans le dashboard, créer une annonce (titre, description, prix, catégorie, photos, adresse).
2. Optionnel : **Générer avec l'IA** après avoir configuré un fournisseur.
3. Cliquer sur **Publier** : le formulaire de dépôt est rempli (titre, catégorie, photos, état « Bon état », description, prix, adresse, livraison) puis validation manuelle ou automatique.
4. **Renouveler** : réactivation, suppression et recréation de l'annonce. Mode manuel (tu valides) ou auto.
5. **MàJ** : rafraîchir les données d'une annonce depuis Leboncoin.
6. La synchro initiale importe les annonces et leurs catégories.

Variables d'environnement utiles :

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `7310` | Port du backend |
| `FLUXLIBRE_DATA_DIR` | `~/.fluxlibre` | Dossier des données et images |
| `FLUXLIBRE_DB` | `~/.fluxlibre/fluxlibre.db` | Fichier SQLite |
| `FLUXLIBRE_AI_KEY` | — | Clé API IA |

## Avertissements

- L'automatisation de sites tiers peut contrevenir à leurs conditions d'utilisation. À utiliser sous votre propre responsabilité, à titre personnel.
- Aucune donnée n'est envoyée à un service tiers, sauf si vous configurez volontairement un fournisseur IA.
- Ne stockez pas de clés API dans un dépôt public.

## Contribution

Fork, issues et PR bienvenus. Garder le code TypeScript, sans dépendance payante, et documenter tout changement de sélecteur.

## Licence

[MIT](LICENSE) © 2026 FluxLibre contributors.
