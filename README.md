# MyHub V31 — Location

Nouveau module de gestion des 3 tonneaux en location : planning, réservations, locataires, prix, cautions, photos avant/après, pièce d'identité et tableau de bord annuel.

La base IndexedDB passe en version 21 avec les stores `rentalBarrels` et `rentalBookings`.

# MyHub V30.5 — Correctif records Course à pied

- Les records relisent désormais correctement les anciennes et nouvelles structures de distance.
- Toute activité libre Course à pied terminée peut alimenter les records.
- Ajout de Meilleure allure et Plus longue sortie, calculées sur toutes les courses.
- Les records 1 km, 5 km, 10 km et semi restent des records de distance de référence.
- Les objectifs Course utilisent aussi la distance normalisée.

# MyHub V30.4 — Correctifs Tâches liées

- Modification des tâches existantes via la modale robuste.
- Les tâches terminées restent modifiables.
- Création d'une tâche depuis un bien Entretien corrigée.
- Le bien est prélié automatiquement à la nouvelle tâche.

# MyHub V30.3 — Correctif modification des tâches

- Le bouton Modifier ouvre maintenant la modale robuste utilisée depuis V28.2.
- Les tâches terminées non-système restent modifiables.
- Le bouton Demain reste masqué pour une tâche terminée.

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
