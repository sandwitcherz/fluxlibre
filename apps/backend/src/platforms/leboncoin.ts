/**
 * Module Leboncoin — toutes les actions spécifiques à Leboncoin.
 *
 * Les routes génériques (tâches, listings, IA) sont dans `routes.ts`.
 * Ce module documente et regroupe les comportements propres à Leboncoin :
 * - formulaire de dépôt en assistant multi-étapes (titre → catégorie → photos
 *   → état « Bon état » → description/prix → adresse → livraison → boost)
 * - prix à réécrire après l'IA du site
 * - modales de suppression (« Autre ») et de feedback (« Neutre »)
 * - badge « Livraison » inconstants
 *
 * L'implémentation DOM est dans `apps/extension/src/content/leboncoin.ts`.
 */
export const PLATFORM = 'leboncoin' as const;
