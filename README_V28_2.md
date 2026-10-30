# MyHub V28.2 — Correctif Tâches après restauration

Ce correctif cible le cas reproductible où **Ajouter** ne fait rien après restauration
d'une sauvegarde MyHub V28.

## Principe

Le formulaire Nouvelle tâche s'ouvre désormais **immédiatement**, avant toute lecture
des stores annexes IndexedDB (objectifs, projets, biens, personnes, aquariums, plantes).

Ces données sont chargées ensuite en arrière-plan dans la section « Liens optionnels ».
Une donnée ancienne ou problématique ne peut donc plus bloquer l'ouverture du formulaire.

## Installation

Depuis la racine du dépôt MyHub :

```bash
unzip -o MyHub_V28_2_Tasks_Restore_Fix.zip
python3 install_v28_2.py
git add js/core/task_modal_guard.js js/app.js service-worker.js
git commit -m "MyHub V28.2 - Fix taches apres restauration"
git push origin main
```

Après le déploiement GitHub Pages, fermer puis rouvrir MyHub sur iPhone.
Le cache PWA passe à `myhub-v28-2-tasks-restore-fix`.

Aucune modification de schéma IndexedDB et aucune suppression de données.
