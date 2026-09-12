import { getAll, putOne } from "./db.js";

export const SPORT_CATALOG = [
  { id: "running", label: "Course à pied", icon: "🏃", distance: true, defaultUnit: "km", aliases: ["course a pied","course","running","run","jogging","jog"] },
  { id: "walking", label: "Marche", icon: "🚶", distance: true, defaultUnit: "km", aliases: ["marche","walking","walk"] },
  { id: "hiking", label: "Randonnée", icon: "🥾", distance: true, defaultUnit: "km", aliases: ["randonnee","randonnée","hiking","trek","trekking"] },
  { id: "cycling", label: "Vélo", icon: "🚴", distance: true, defaultUnit: "km", aliases: ["velo","vélo","cyclisme","cycling","bike","biking","vtt"] },
  { id: "swimming", label: "Natation", icon: "🏊", distance: true, defaultUnit: "m", aliases: ["natation","nage","swimming","swim"] },
  { id: "strength", label: "Musculation", icon: "🏋️", distance: false, aliases: ["musculation","muscu","strength","bodybuilding","full body"] },
  { id: "tennis", label: "Tennis", icon: "🎾", distance: false, aliases: ["tennis"] },
  { id: "padel", label: "Padel", icon: "🎾", distance: false, aliases: ["padel"] },
  { id: "football", label: "Football", icon: "⚽", distance: false, aliases: ["football","foot","soccer"] },
  { id: "rugby", label: "Rugby", icon: "🏉", distance: false, aliases: ["rugby"] },
  { id: "basketball", label: "Basketball", icon: "🏀", distance: false, aliases: ["basket","basketball"] },
  { id: "handball", label: "Handball", icon: "🤾", distance: false, aliases: ["handball"] },
  { id: "badminton", label: "Badminton", icon: "🏸", distance: false, aliases: ["badminton"] },
  { id: "squash", label: "Squash", icon: "🎾", distance: false, aliases: ["squash"] },
  { id: "roller", label: "Roller", icon: "🛼", distance: true, defaultUnit: "km", aliases: ["roller","rollers","inline skating","patin"] },
  { id: "skiing", label: "Ski", icon: "⛷️", distance: true, defaultUnit: "km", aliases: ["ski","ski alpin","skiing"] },
  { id: "snowboarding", label: "Snowboard", icon: "🏂", distance: true, defaultUnit: "km", aliases: ["snowboard","snowboarding"] },
  { id: "climbing", label: "Escalade", icon: "🧗", distance: false, aliases: ["escalade","climbing"] },
  { id: "crossfit", label: "CrossFit", icon: "🏋️", distance: false, aliases: ["crossfit","cross fit"] },
  { id: "hiit", label: "HIIT", icon: "⚡", distance: false, aliases: ["hiit","circuit training","circuit"] },
  { id: "yoga", label: "Yoga", icon: "🧘", distance: false, aliases: ["yoga"] },
  { id: "pilates", label: "Pilates", icon: "🧘", distance: false, aliases: ["pilates"] },
  { id: "rowing", label: "Rameur", icon: "🚣", distance: true, defaultUnit: "m", aliases: ["rameur","rowing","aviron indoor","aviron"] },
  { id: "elliptical", label: "Elliptique", icon: "🏃", distance: true, defaultUnit: "km", aliases: ["elliptique","elliptical"] },
  { id: "boxing", label: "Boxe", icon: "🥊", distance: false, aliases: ["boxe","boxing"] },
  { id: "martial_arts", label: "Arts martiaux", icon: "🥋", distance: false, aliases: ["arts martiaux","martial arts","judo","karate","karaté","taekwondo","jiu jitsu","mma"] },
  { id: "golf", label: "Golf", icon: "⛳", distance: false, aliases: ["golf"] },
  { id: "other", label: "Autre sport", icon: "🏅", distance: false, aliases: ["autre","autre sport","sport"] }
];

function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const BY_ID = new Map(SPORT_CATALOG.map(sport => [sport.id, sport]));

export function canonicalSportId(value = "") {
  if (!value) return "";
  const raw = String(value).trim();
  if (BY_ID.has(raw)) return raw;

  const normalized = normalize(raw);
  for (const sport of SPORT_CATALOG) {
    if (normalize(sport.label) === normalized) return sport.id;
    if ((sport.aliases || []).some(alias => normalize(alias) === normalized)) return sport.id;
  }

  // Compatibilité avec les anciennes saisies plus longues.
  for (const sport of SPORT_CATALOG.filter(item => item.id !== "other")) {
    const candidates = [sport.label, ...(sport.aliases || [])].map(normalize).filter(Boolean);
    if (candidates.some(alias => normalized.includes(alias) || alias.includes(normalized))) return sport.id;
  }

  return "other";
}

export function getSportMeta(value = "") {
  const id = canonicalSportId(value);
  return BY_ID.get(id) || BY_ID.get("other");
}

export function sportLabel(value = "") {
  return getSportMeta(value)?.label || "Autre sport";
}

export function sportIcon(value = "") {
  return getSportMeta(value)?.icon || "🏅";
}

export function sportSupportsDistance(value = "") {
  return Boolean(getSportMeta(value)?.distance);
}

export function sportDefaultUnit(value = "") {
  return getSportMeta(value)?.defaultUnit || "km";
}

export function sessionSportId(session = {}) {
  return canonicalSportId(session.sportId || session.activityType || session.programName || session.sport || "");
}

export function goalSportId(goal = {}) {
  if (["strength","strength_multi"].includes(goal.goalType)) return "strength";
  return canonicalSportId(goal.sportId || goal.sport || "");
}

export function sameSport(a, b) {
  const aId = typeof a === "object" ? sessionSportId(a) : canonicalSportId(a);
  const bId = typeof b === "object" ? goalSportId(b) : canonicalSportId(b);
  return Boolean(aId && bId && aId === bId);
}

export function sportSelectOptions(selected = "", { includeOther = true } = {}) {
  const selectedId = canonicalSportId(selected);
  return SPORT_CATALOG
    .filter(sport => includeOther || sport.id !== "other")
    .map(sport => `<option value="${sport.id}" ${sport.id === selectedId ? "selected" : ""}>${sport.icon} ${sport.label}</option>`)
    .join("");
}

export async function ensureSportIdentityMigration() {
  const [sessions, goals, plans, planSessions] = await Promise.all([
    getAll("sportSessions"),
    getAll("sportGoals"),
    getAll("sportTrainingPlans"),
    getAll("sportPlanSessions")
  ]);

  let changed = 0;

  for (const session of sessions) {
    const id = sessionSportId(session);
    const label = sportLabel(id);
    if (session.sportId !== id || (session.type === "activity" && session.activityType !== label)) {
      await putOne("sportSessions", {
        ...session,
        sportId: id,
        activityType: session.type === "activity" ? label : session.activityType,
        updatedAt: session.updatedAt || new Date().toISOString()
      });
      changed++;
    }
  }

  for (const goal of goals) {
    const id = goalSportId(goal);
    const label = sportLabel(id);
    if (goal.sportId !== id || goal.sport !== label) {
      await putOne("sportGoals", {
        ...goal,
        sportId: id,
        sport: label,
        updatedAt: goal.updatedAt || new Date().toISOString()
      });
      changed++;
    }
  }

  for (const plan of plans) {
    const id = canonicalSportId(plan.sportId || plan.sport || "");
    const label = sportLabel(id);
    if (plan.sportId !== id || plan.sport !== label) {
      await putOne("sportTrainingPlans", { ...plan, sportId: id, sport: label });
      changed++;
    }
  }

  for (const session of planSessions) {
    const id = canonicalSportId(session.sportId || session.sport || "");
    const label = sportLabel(id);
    if (session.sportId !== id || session.sport !== label) {
      await putOne("sportPlanSessions", { ...session, sportId: id, sport: label });
      changed++;
    }
  }

  return changed;
}
