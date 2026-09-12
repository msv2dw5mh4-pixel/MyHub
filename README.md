# MyHub V30.2 — Correctif recherche Repas

# MyHub V30.1 — Correctif recherche Repas + Plat aléatoire

# MyHub V30 — Sport unifié

# MyHub V29 — Refonte visuelle Repas & Courses

# MyHub V28 — Repas & Courses

MyHub est une PWA locale : l'application est servie comme site statique, tandis que les données personnelles restent dans IndexedDB sur l'appareil.

## V28

### Repas
- bibliothèque initiale de 100 repas modifiables ;
- cuisines italienne, asiatique et classique ;
- nombreux plats à base de poulet, bœuf haché, crevettes et pâtes ;
- recherche et filtres ;
- favoris ;
- modification directe des recettes de la bibliothèque ;
- bouton de réinitialisation pour les 100 recettes d'origine ;
- ajout de nouveaux repas ;
- planning hebdomadaire midi / soir ;
- génération automatique de la liste de courses à partir des repas planifiés.

### Courses
- ajout manuel d'articles ;
- quantités, unités, rayons et notes ;
- regroupement par rayon ;
- cases à cocher ;
- filtres À acheter / Pris / Tout ;
- suppression des articles terminés ;
- liste générée depuis Repas sans supprimer les articles ajoutés manuellement.

### Intégrations
- Dashboard ;
- recherche globale ;
- ajout rapide ;
- sauvegarde/restauration MyHub.

## Données

IndexedDB : version 20.

Nouveaux stores :
- `meals`
- `mealPlans`
- `shoppingItems`

Les données ne sont pas stockées dans le dépôt GitHub.


## V28.1 — Hotfix Tâches

- création de tâche rendue indépendante des modules liés ;
- lecture tolérante des objectifs, projets, biens, personnes, aquariums et plantes ;
- retour visuel pendant l'enregistrement ;
- message d'erreur explicite si IndexedDB refuse l'écriture ;
- meilleure gestion des changements de version IndexedDB ;
- aucun changement de schéma : DB version 20 conservée.
