export const modules = [
  { id: "stats", name: "Stats globales", icon: "📊", route: "stats", enabled: true, description: "Bilan semaine, mois et année en croisant toutes les données MyHub." },
  { id: "planning", name: "Planning", icon: "📅", route: "planning", enabled: true, description: "Agenda quotidien, semaine, mois et événements personnels." },
  { id: "maintenance", name: "Entretien", icon: "🔧", route: "maintenance", enabled: true, description: "Mes biens, entretien, achat, garantie, tâches liées, documents et passage en vente." },
  { id: "living", name: "Aquariums & Plantes", icon: "🌿", route: "living", enabled: true, description: "Aquariums, populations, naissances, comptages, plantes, arrosages et soins récurrents." },
  { id: "documents", name: "Documents", icon: "📂", route: "documents", enabled: true, description: "Documents importants, échéances et rappels de renouvellement." },
  { id: "budget", name: "Budget", icon: "💰", route: "budget", enabled: true, description: "Revenus, dépenses, épargne et suivi mensuel." },
  { id: "projects", name: "Projets", icon: "🏠", route: "projects", enabled: true, description: "Gros projets regroupant tâches, budget, planning et documents." },
  { id: "learning", name: "Apprentissage", icon: "🧠", route: "learning", enabled: true, description: "Compétences, formations, sessions et progression mesurable." },
  { id: "people", name: "Personnes", icon: "👥", route: "people", enabled: true, description: "Personnes, groupes personnalisés, relations, anniversaires, événements et notes recherchables." },
  { id: "ideas", name: "Idées", icon: "💡", route: "ideas", enabled: true, description: "Inbox rapide pour capturer puis transformer une idée en action." },
  { id: "tasks", name: "Tâches", icon: "✓", route: "tasks", enabled: true, description: "To-do list, échéances et rappels." },
  { id: "stock", name: "Stock", icon: "📦", route: "stock", enabled: true, description: "Objets, achat, vente, marge et statistiques." },
  { id: "tracker", name: "Tracker", icon: "✅", route: "tracker", enabled: true, description: "Habitudes intelligentes, jours actifs, seuils, automatisations, heatmap et score Essentiel." },
  { id: "sport", name: "Sport", icon: "🏋️", route: "sport", enabled: true, description: "Objectifs multisport, programmes adaptatifs, jours personnalisés, récupération, tests et records." },
  { id: "objectives", name: "Objectifs", icon: "🎯", route: "objectives", enabled: true, description: "Objectifs, jalons, échéances et progression." }
];

export function getModule(id) {
  return modules.find(m => m.id === id);
}
