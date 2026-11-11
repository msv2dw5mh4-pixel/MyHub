export const APP_VERSION = "V33.4";

export const RELEASE_INFO = {
  version: APP_VERSION,
  date: "11 novembre 2026",
  title: "Mises à jour intégrées à MyHub",
  summary: "MyHub détecte maintenant les nouvelles versions disponibles sur GitHub Pages et peut lancer la mise à jour directement depuis l’application.",
  details: [
    "Ajout d’un fichier version.json lu sans cache pour connaître la dernière version disponible.",
    "Ajout d’un état « Version installée / Dernière version disponible » dans les Réglages.",
    "Ajout d’un bouton « Vérifier les mises à jour ».",
    "Lorsqu’une version plus récente existe, un bouton « Mettre à jour MyHub » apparaît.",
    "Une bannière de mise à jour peut également apparaître automatiquement à l’ouverture de MyHub.",
    "La mise à jour demande au Service Worker de récupérer les nouveaux fichiers, de s’activer puis recharge MyHub avec une URL unique pour contourner le cache iOS.",
    "Aucune donnée IndexedDB n’est supprimée ou réinitialisée par ce mécanisme."
  ]
};
