import { getOne, putOne } from "./db.js";

const MODULES_SETTING_KEY = "modules.activation.v1";

export const moduleGroups = [
  { id: "organiser", name: "Organiser", description: "Ce qui structure tes journées et tes projets." },
  { id: "quotidien", name: "Quotidien", description: "Les outils que tu utilises régulièrement." },
  { id: "progression", name: "Progression", description: "Sport, apprentissage et idées à faire avancer." },
  { id: "travail", name: "Travail", description: "Outils professionnels indépendants du reste de MyHub." },
  { id: "biens", name: "Finances & biens", description: "Argent, matériel, documents et locations." },
  { id: "analyse", name: "Analyse", description: "Prendre du recul sur l'ensemble de MyHub." }
];

export const modules = [
  { id: "tasks", name: "Tâches", icon: "✓", route: "tasks", group: "organiser", order: 10, core: true, defaultActive: true, description: "Actions concrètes, échéances, priorités et liens avec le reste de MyHub." },
  { id: "planning", name: "Planning", icon: "📅", route: "planning", group: "organiser", order: 20, defaultActive: false, description: "Agenda quotidien, semaine, mois et événements personnels." },
  { id: "notifications", name: "Rappel MyHub", icon: "🔔", route: "notifications", group: "organiser", order: 25, defaultActive: false, description: "Choisir les jours et l’heure du rappel MyHub." },
  { id: "objectives", name: "Objectifs", icon: "🎯", route: "objectives", group: "organiser", order: 30, defaultActive: false, description: "Objectifs, prochaines actions, jalons, échéances et progression." },
  { id: "projects", name: "Projets", icon: "🏠", route: "projects", group: "organiser", order: 40, defaultActive: false, description: "Gros projets regroupant tâches, budget, planning et documents." },

  { id: "tracker", name: "Tracker", icon: "✅", route: "tracker", group: "quotidien", order: 10, core: true, defaultActive: true, description: "Habitudes intelligentes, jours actifs, seuils et suivi quotidien." },
  { id: "meals", name: "Repas", icon: "🍽️", route: "meals", group: "quotidien", order: 20, defaultActive: false, description: "Bibliothèque de repas modifiables, favoris et planning de la semaine." },
  { id: "shopping", name: "Courses", icon: "🛒", route: "shopping", group: "quotidien", order: 30, defaultActive: false, description: "Liste de courses manuelle ou générée depuis les repas planifiés." },
  { id: "people", name: "Personnes", icon: "👥", route: "people", group: "quotidien", order: 40, defaultActive: false, description: "Personnes, groupes, relations, anniversaires, événements et notes." },
  { id: "living", name: "Aquariums & Plantes", icon: "🌿", route: "living", group: "quotidien", order: 50, defaultActive: false, description: "Aquariums, populations, plantes, arrosages et soins récurrents." },

  { id: "sport", name: "Sport", icon: "🏋️", route: "sport", group: "progression", order: 10, core: true, defaultActive: true, description: "Objectifs multisport, programmes, activités et records." },
  { id: "learning", name: "Apprentissage", icon: "🧠", route: "learning", group: "progression", order: 20, defaultActive: false, description: "Compétences, formations, sessions et progression mesurable." },
  { id: "ideas", name: "Idées", icon: "💡", route: "ideas", group: "progression", order: 30, defaultActive: false, description: "Inbox rapide pour capturer puis transformer une idée en action." },

  { id: "timeclock", name: "Badgeuse", icon: "🕘", route: "timeclock", group: "travail", order: 10, core: true, defaultActive: true, description: "Arrivée, pauses, reprise et départ avec cumul quotidien, hebdomadaire et mensuel." },

  { id: "budget", name: "Budget", icon: "💰", route: "budget", group: "biens", order: 10, defaultActive: false, description: "Revenus, dépenses, épargne et suivi mensuel." },
  { id: "stock", name: "Stock", icon: "📦", route: "stock", group: "biens", order: 20, defaultActive: false, description: "Objets, achat, vente, marge et statistiques." },
  { id: "maintenance", name: "Entretien", icon: "🔧", route: "maintenance", group: "biens", order: 30, defaultActive: false, description: "Biens, entretien, achat, garantie et tâches liées." },
  { id: "rental", name: "Location", icon: "🛢️", route: "rental", group: "biens", order: 40, defaultActive: false, description: "Tonneaux en location, planning, locataires, cautions et bilan annuel." },
  { id: "documents", name: "Documents", icon: "📂", route: "documents", group: "biens", order: 50, defaultActive: false, description: "Documents importants, échéances et rappels de renouvellement." },

  { id: "stats", name: "Stats globales", icon: "📊", route: "stats", group: "analyse", order: 10, defaultActive: false, description: "Bilan semaine, mois et année en croisant les données MyHub." }
];

const ALWAYS_AVAILABLE_ROUTES = new Set(["dashboard", "modules", "settings", "search"]);

export function getModule(id) {
  return modules.find(module => module.id === id);
}

export function getModuleByRoute(route) {
  return modules.find(module => module.route === route);
}

export function getDefaultActiveModuleIds() {
  return modules.filter(module => module.defaultActive || module.core).map(module => module.id);
}

export async function getModuleActivationState() {
  const saved = await getOne("settings", MODULES_SETTING_KEY).catch(() => null);
  const savedIds = Array.isArray(saved?.value?.activeIds) ? saved.value.activeIds : null;
  const validIds = new Set(modules.map(module => module.id));

  const activeIds = new Set(
    (savedIds || getDefaultActiveModuleIds()).filter(id => validIds.has(id))
  );

  // Le noyau ne peut jamais être désactivé.
  modules.filter(module => module.core).forEach(module => activeIds.add(module.id));

  return {
    activeIds: [...activeIds],
    initialized: Boolean(savedIds),
    updatedAt: saved?.updatedAt || null
  };
}

async function persistActiveIds(activeIds) {
  const validIds = new Set(modules.map(module => module.id));
  const next = new Set(activeIds.filter(id => validIds.has(id)));
  modules.filter(module => module.core).forEach(module => next.add(module.id));

  const value = { activeIds: [...next] };
  await putOne("settings", {
    key: MODULES_SETTING_KEY,
    value,
    updatedAt: new Date().toISOString()
  });

  window.dispatchEvent(new CustomEvent("myhub:modules-changed", { detail: value }));
  return value.activeIds;
}

export async function setModuleActive(id, active) {
  const module = getModule(id);
  if (!module) throw new Error("Module inconnu.");
  if (module.core && !active) return (await getModuleActivationState()).activeIds;

  const state = await getModuleActivationState();
  const next = new Set(state.activeIds);
  if (active) next.add(id);
  else next.delete(id);
  return persistActiveIds([...next]);
}

export async function isModuleActive(id) {
  const state = await getModuleActivationState();
  return state.activeIds.includes(id);
}

export async function isRouteActive(route) {
  if (ALWAYS_AVAILABLE_ROUTES.has(route)) return true;
  const module = getModuleByRoute(route);
  if (!module) return true;
  return isModuleActive(module.id);
}

export async function getActiveModules() {
  const state = await getModuleActivationState();
  const active = new Set(state.activeIds);
  return modules.filter(module => active.has(module.id));
}
