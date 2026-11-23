# FluxLibre

Gestionnaire d'annonces **libre, local et open-source** pour **Leboncoin** et **Vinted**, inspiré des bases de [Flowdino](https://www.flowdino.com/) (centralisation, publication multi-plateformes, renouvellement, IA) mais limité à deux plateformes et sans abonnement.

> ⚠️ **Statut : MVP / base de développement.** Les sites changent régulièrement de structure : les sélecteurs des adaptateurs doivent être maintenus. L'option `autoSubmit` est **désactivée par défaut** : l'extension remplit les champs et vous laisse valider.

## Fonctionnalités

- ✅ Base locale SQLite de toutes vos annonces (photos, prix, catégories)
- ✅ Publication sur Leboncoin + Vinted en une action, adaptation des champs par plateforme
- ✅ Renouvellement automatique des annonces expirées (planificateur horaire)
- ✅ Suppression d'une annonce sur les deux plateformes
- ✅ Génération des titres/descriptions par IA (OpenAI, Anthropic ou Ollama local)
- ✅ Préparation des photos (redimensionnement, webp, suppression EXIF) avec Sharp
- ✅ File de tâches persistante entre le backend et l'extension
- ✅ Interface web locale + popup et options de l'extension

## Architecture

```
apps/backend     Express + SQLite natif (node:sqlite), scheduler, IA, images → :7310
apps/extension   Extension Chrome MV3 : background (poll) + content scripts (DOM)
packages/shared  Types TypeScript communs
```

Les sites n'exposent pas d'API publique de publication. Le backend crée donc des **tâches** (`publish`, `renew`, `delete`, `sync`) ; l'extension les récupère, ouvre la page concernée et pilote le formulaire via le DOM. Les données restent sur votre machine (`~/.fluxlibre`).

## Installation

Prérequis : **Node.js ≥ 22.5** (SQLite natif `node:sqlite`, aucune compilation requise) et **pnpm ≥ 9**.

```bash
pnpm install
pnpm dev
```

Le backend démarre sur `http://localhost:7310` (dashboard inclus). L'extension est compilée en continu dans `apps/extension/dist`.

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

1. Dans le dashboard, créer une annonce (titre, description, prix, catégorie, photos).
2. Optionnel : **Générer avec l'IA** après avoir configuré un fournisseur dans l'onglet Configuration.
3. Cliquer sur **Publier** : deux tâches sont créées, une par plateforme.
4. Garder Chrome ouvert : l'extension exécute les tâches et remplit les formulaires. Valider manuellement si `autoSubmit` est désactivé.
5. Le renouvellement est vérifié toutes les heures ( configurable, 30 jours par défaut ).

Variables d'environnement utiles :

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `7310` | Port du backend |
| `FLUXLIBRE_DATA_DIR` | `~/.fluxlibre` | Dossier des données et images |
| `FLUXLIBRE_DB` | `~/.fluxlibre/fluxlibre.db` | Fichier SQLite |
| `FLUXLIBRE_AI_KEY` | — | Clé API IA (sinon stockée via `/api/config`) |

## Ajuster les sélecteurs

Les sélecteurs sont centralisés dans `apps/extension/src/content/base.ts` (`SELECTORS`). Si un champ n'est plus trouvé, l'extension renvoie une erreur explicite avec le nom du champ manquant. Il suffit alors de mettre à jour la liste de sélecteurs correspondante et de recharger l'extension.

## Avertissements

- L'automatisation de sites tiers peut contrevenir à leurs conditions d'utilisation. À utiliser sous votre propre responsabilité, à titre personnel.
- Aucune donnée n'est envoyée à un service tiers, sauf si vous configurez volontairement un fournisseur IA.
- Ne stockez pas de clés API dans un dépôt public.

## Contribution

Fork, issues et PR bienvenus. Garder le code TypeScript, sans dépendance payante, et documenter tout changement de sélecteur.

## Licence

[MIT](LICENSE) © 2026 FluxLibre contributors.
