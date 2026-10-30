# MyHub V33.1 — Version dans les Réglages

Cette mise à jour ajoute une source unique de version (`js/core/version.js`) afin que le numéro affiché dans les Réglages et celui inscrit dans les sauvegardes restent cohérents.

Dernier changement : ajout de l'encart « Version de MyHub », de la date de mise à jour, du résumé du dernier push et d'une fenêtre « Voir les nouveautés ».

# MyHub V33 — Fiabilité & Notifications

Version de consolidation basée sur l’audit de la sauvegarde réelle MyHub.

## Changements
- nouveau module 🔔 Rappel MyHub : activation, heure, jours, tous les jours et bouton de test ;
- socle Service Worker prêt pour un futur Web Push ;
- réparation automatique des dates incohérentes Objectifs / Projets ;
- normalisation des distances Sport et nettoyage de références cassées ;
- détection des séances de musculation restées ouvertes plus de 12 h ;
- tâches récurrentes Objectifs et Sport générées seulement à 7 jours ;
- nouvelle vue Tâches « Automatiques » et séparation des tâches personnelles à venir ;
- actions récurrentes Objectifs avec durée estimée pour alimenter automatiquement les objectifs en heures lorsqu’ils ne sont pas déjà pilotés par Apprentissage ;
- Tracker ouvert par défaut sur ⭐ Essentiel et audit des lignes peu utilisées ;
- Repas ouvre désormais directement la Bibliothèque.

### Notifications iPhone
Le bouton de test utilise une vraie notification système. Le rappel horaire local fonctionne lorsque MyHub reste actif/en arrière-plan. Pour garantir un déclenchement avec l’app complètement fermée, un petit backend Web Push reste nécessaire ; le Service Worker V33 contient déjà les handlers `push` et `notificationclick`.

# MyHub V32 — Organisation, Tâches & Objectifs

Cette version remet de l'ordre dans la page Modules et consolide le lien Objectif → Tâches.

Principaux changements :
- modules regroupés par grandes familles d'usage ;
- vues Tâches simplifiées : À traiter, À venir, Sans date, Liées, Terminées ;
- priorités Haute / Normale / Basse ;
- filtre des tâches par source et par objectif ;
- création d'une tâche directement depuis un objectif ;
- prochaines tâches visibles dans la fiche Objectif ;
- le module Cadeaux reste prévu pour une version ultérieure.

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
