export const moduleGroups = [
  { id: "organiser", name: "Organiser", description: "Ce qui structure tes journées et tes projets." },
  { id: "quotidien", name: "Quotidien", description: "Les outils que tu utilises régulièrement." },
  { id: "progression", name: "Progression", description: "Sport, apprentissage et idées à faire avancer." },
  { id: "biens", name: "Finances & biens", description: "Argent, matériel, documents et locations." },
  { id: "analyse", name: "Analyse", description: "Prendre du recul sur l'ensemble de MyHub." }
];

export const modules = [
  { id: "tasks", name: "Tâches", icon: "✓", route: "tasks", enabled: true, group: "organiser", order: 10, description: "Actions concrètes, échéances, priorités et liens avec le reste de MyHub." },
  { id: "planning", name: "Planning", icon: "📅", route: "planning", enabled: true, group: "organiser", order: 20, description: "Agenda quotidien, semaine, mois et événements personnels." },
  { id: "objectives", name: "Objectifs", icon: "🎯", route: "objectives", enabled: true, group: "organiser", order: 30, description: "Objectifs, prochaines actions, jalons, échéances et progression." },
  { id: "projects", name: "Projets", icon: "🏠", route: "projects", enabled: true, group: "organiser", order: 40, description: "Gros projets regroupant tâches, budget, planning et documents." },

  { id: "tracker", name: "Tracker", icon: "✅", route: "tracker", enabled: true, group: "quotidien", order: 10, description: "Habitudes intelligentes, jours actifs, seuils, automatisations, heatmap et score Essentiel." },
  { id: "meals", name: "Repas", icon: "🍽️", route: "meals", enabled: true, group: "quotidien", order: 20, description: "Bibliothèque de repas modifiables, favoris et planning de la semaine." },
  { id: "shopping", name: "Courses", icon: "🛒", route: "shopping", enabled: true, group: "quotidien", order: 30, description: "Liste de courses manuelle ou générée automatiquement depuis les repas planifiés." },
  { id: "people", name: "Personnes", icon: "👥", route: "people", enabled: true, group: "quotidien", order: 40, description: "Personnes, groupes, relations, anniversaires, événements et notes." },
  { id: "living", name: "Aquariums & Plantes", icon: "🌿", route: "living", enabled: true, group: "quotidien", order: 50, description: "Aquariums, populations, plantes, arrosages et soins récurrents." },

  { id: "sport", name: "Sport", icon: "🏋️", route: "sport", enabled: true, group: "progression", order: 10, description: "Objectifs multisport, programmes adaptatifs, activités et records." },
  { id: "learning", name: "Apprentissage", icon: "🧠", route: "learning", enabled: true, group: "progression", order: 20, description: "Compétences, formations, sessions et progression mesurable." },
  { id: "ideas", name: "Idées", icon: "💡", route: "ideas", enabled: true, group: "progression", order: 30, description: "Inbox rapide pour capturer puis transformer une idée en action." },

  { id: "budget", name: "Budget", icon: "💰", route: "budget", enabled: true, group: "biens", order: 10, description: "Revenus, dépenses, épargne et suivi mensuel." },
  { id: "stock", name: "Stock", icon: "📦", route: "stock", enabled: true, group: "biens", order: 20, description: "Objets, achat, vente, marge et statistiques." },
  { id: "maintenance", name: "Entretien", icon: "🔧", route: "maintenance", enabled: true, group: "biens", order: 30, description: "Mes biens, entretien, achat, garantie, tâches liées et passage en vente." },
  { id: "rental", name: "Location", icon: "🛢️", route: "rental", enabled: true, group: "biens", order: 40, description: "Tonneaux en location, planning, locataires, cautions, photos et bilan annuel." },
  { id: "documents", name: "Documents", icon: "📂", route: "documents", enabled: true, group: "biens", order: 50, description: "Documents importants, échéances et rappels de renouvellement." },

  { id: "stats", name: "Stats globales", icon: "📊", route: "stats", enabled: true, group: "analyse", order: 10, description: "Bilan semaine, mois et année en croisant toutes les données MyHub." }
];

export function getModule(id) {
  return modules.find(m => m.id === id);
}
