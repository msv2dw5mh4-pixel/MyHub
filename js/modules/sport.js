import {
  getAll,
  getOne,
  putOne,
  deleteOne
} from "../core/db.js";

import {
  escapeHtml,
  uid,
  openModal,
  closeModal,
  todayISO
} from "../core/ui.js";

import {
  generateSportPlan,
  adaptSportPlan,
  deleteSportPlan,
  syncSportPlanTasks,
  completeSportPlanFromActivity,
  completeSportPlanFromWorkout,
  performanceGoalState,
  strengthGoalState,
  strengthMultiGoalState,
  formatPerformanceTime,
  formatPerformancePace,
  isSwimmingSport,
  getSportPhaseLabel
} from "../core/sport_planner.js";

import {
  getSportRecords,
  getWeeklyTrainingLoad
} from "../core/sport_insights.js";

import {
  SPORT_CATALOG,
  canonicalSportId,
  sportLabel,
  sportIcon as catalogSportIcon,
  sportSupportsDistance,
  sportDefaultUnit,
  sportSelectOptions,
  goalSportId,
  ensureSportIdentityMigration
} from "../core/sport_catalog.js";

let currentView = "today";
let currentSessionId = null;
let lastContainer = null;
let workoutTimerId = null;

export async function renderSport(container) {
  lastContainer = container;
  container.innerHTML = `<section class="sport-shell" id="sport-shell"></section>`;
  await ensureSportIdentityMigration();
  await syncSportPlanTasks();
  await renderCurrentView();
}

export function requestNewSportActivity(preset = {}) {
  currentView = "today";
  window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "sport" }));
  setTimeout(() => showActivityModal(preset), 120);
}

function tabs(active) {
  return `
    <div class="sport-tabs">
      <button class="sport-tab ${active === "today" ? "active" : ""}" data-sport-view="today">Aujourd'hui</button>
      <button class="sport-tab ${active === "programs" ? "active" : ""}" data-sport-view="programs">Programmes</button>
      <button class="sport-tab ${active === "history" ? "active" : ""}" data-sport-view="history">Historique</button>
      <button class="sport-tab ${active === "progress" ? "active" : ""}" data-sport-view="progress">Progression</button>
      <button class="sport-tab ${active === "records" ? "active" : ""}" data-sport-view="records">Records</button>
    </div>
  `;
}

function bindTabs(shell) {
  shell.querySelectorAll("[data-sport-view]").forEach(btn => {
    btn.addEventListener("click", async () => {
      currentView = btn.dataset.sportView;
      currentSessionId = null;
      await renderCurrentView();
    });
  });
}

async function renderCurrentView() {
  if (!lastContainer) return;

  const shell = lastContainer.querySelector("#sport-shell") || lastContainer;

  if (currentView === "programs") return renderPrograms(shell);
  if (currentView === "history") return renderHistory(shell);
  if (currentView === "progress") return renderProgress(shell);
  if (currentView === "records") return renderRecords(shell);
  if (currentView === "workout") return renderWorkout(shell, currentSessionId);
  if (currentView === "detail") return renderSessionDetail(shell, currentSessionId);

  return renderToday(shell);
}

function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatDate(dateString) {
  if (!dateString) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(`${dateString}T12:00:00`));
}

function formatDateLong(dateString) {
  if (!dateString) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(`${dateString}T12:00:00`));
}

function roundWeight(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function addMonthsISO(dateString, months) {
  const date = new Date(`${dateString || todayISO()}T12:00:00`);
  date.setMonth(date.getMonth() + Number(months || 0));
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0,10);
}

function dateTimeLocalValue(isoValue) {
  if (!isoValue) return "";
  const date = new Date(isoValue);
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function sessionDurationMinutes(session) {
  const explicit = Number(session?.duration || session?.durationMin || 0);
  if (explicit > 0) return Math.round(explicit);
  if (!session?.startedAt) return 0;
  const end = session.completedAt ? new Date(session.completedAt) : new Date();
  const start = new Date(session.startedAt);
  const diff = (end - start) / 60000;
  return Number.isFinite(diff) && diff > 0 ? Math.round(diff) : 0;
}

function durationClock(minutes) {
  const total = Math.max(0, Math.round(Number(minutes || 0)));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} h ${String(m).padStart(2,"0")}` : `${m} min`;
}

function stopWorkoutTimer() {
  if (workoutTimerId) clearInterval(workoutTimerId);
  workoutTimerId = null;
}

function startWorkoutTimer(session, shell) {
  stopWorkoutTimer();
  const paint = () => {
    const el = shell.querySelector("#sport-live-timer");
    if (el) el.textContent = durationClock(sessionDurationMinutes(session));
  };
  paint();
  workoutTimerId = setInterval(paint, 30000);
}

function exerciseTargetConfig(exercise, data) {
  const name = normalize(exercise?.name || "");
  const single = data.goals.find(goal =>
    goal.active !== false &&
    goal.goalType === "strength" &&
    normalize(goal.exerciseName || "") === name
  );
  if (single) {
    return {
      targetWeight: Number(single.targetWeight || 0),
      targetReps: Math.max(1, Number(single.targetReps || exercise.targetReps || 1)),
      baselineWeight: Number(single.baselineWeight || exercise.startWeight || 0),
      startDate: single.startDate || exercise.goalStartDate || todayISO(),
      deadline: single.deadline || exercise.goalDeadline || addMonthsISO(exercise.goalStartDate || todayISO(), exercise.goalMonths || 6),
      sessionsPerWeek: Math.max(1, Number(single.sessionsPerWeek || single.trainingDays?.length || 1))
    };
  }

  const multiGoal = data.goals.find(goal => goal.active !== false && goal.goalType === "strength_multi");
  const definition = data.strengthGoalExercises.find(row =>
    row.active !== false &&
    normalize(row.exerciseName || "") === name &&
    (!multiGoal || row.goalId === multiGoal.id || data.goals.some(g => g.id === row.goalId && g.active !== false))
  );
  if (definition) {
    const goal = data.goals.find(item => item.id === definition.goalId) || multiGoal;
    return {
      targetWeight: Number(definition.targetWeight || 0),
      targetReps: Math.max(1, Number(definition.targetReps || exercise.targetReps || 1)),
      baselineWeight: Number(definition.baselineWeight || exercise.startWeight || 0),
      startDate: goal?.startDate || exercise.goalStartDate || todayISO(),
      deadline: goal?.deadline || exercise.goalDeadline || addMonthsISO(exercise.goalStartDate || todayISO(), exercise.goalMonths || 6),
      sessionsPerWeek: Math.max(1, Number(goal?.sessionsPerWeek || goal?.trainingDays?.length || 1))
    };
  }

  const start = Number(exercise?.startWeight || 0);
  const target = Number(exercise?.targetWeight || 0) || (start > 0 && Number(exercise?.goalPercent || 0) > 0
    ? start * (1 + Number(exercise.goalPercent) / 100)
    : 0);
  if (!target) return null;
  return {
    targetWeight: target,
    targetReps: Math.max(1, Number(exercise?.targetReps || 1)),
    baselineWeight: start,
    startDate: exercise?.goalStartDate || todayISO(),
    deadline: exercise?.goalDeadline || addMonthsISO(exercise?.goalStartDate || todayISO(), exercise?.goalMonths || 6),
    sessionsPerWeek: 1
  };
}

function latestExercisePerformance(exerciseName, data) {
  const completed = data.sessions
    .filter(session => session.status === "completed")
    .sort((a,b) => String(b.completedAt || b.date || "").localeCompare(String(a.completedAt || a.date || "")));
  const wanted = normalize(exerciseName || "");

  for (const session of completed) {
    const sets = data.sets
      .filter(set => set.sessionId === session.id && normalize(set.exerciseName || "") === wanted && Number(set.reps || 0) > 0)
      .sort((a,b) => Number(b.weight || 0) - Number(a.weight || 0));
    if (!sets.length) continue;
    const maxRpe = Math.max(...sets.map(set => Number(set.rpe || 0)));
    const snapshot = (session.workoutExercises || []).find(item => normalize(item.name || "") === wanted);
    return {
      session,
      set: sets[0],
      weight: Number(sets[0].weight || 0),
      reps: Number(sets[0].reps || 0),
      maxRpe,
      pain: Boolean(snapshot?.pain)
    };
  }
  return null;
}

function latestExerciseSetPattern(exerciseName, data) {
  const completed = data.sessions
    .filter(session => session.status === "completed")
    .sort((a,b) => String(b.completedAt || b.date || "").localeCompare(String(a.completedAt || a.date || "")));
  const wanted = normalize(exerciseName || "");

  for (const session of completed) {
    const sets = data.sets
      .filter(set => set.sessionId === session.id && normalize(set.exerciseName || "") === wanted && Number(set.weight || 0) > 0)
      .sort((a,b) => Number(a.setNumber || 0) - Number(b.setNumber || 0));
    if (sets.length) return sets;
  }
  return [];
}

function suggestedSetWeight(exercise, data, setNumber) {
  const suggestion = exercise.suggestion || suggestedExerciseLoad(exercise, data);
  const pattern = latestExerciseSetPattern(exercise.name, data);
  if (!pattern.length) return suggestion?.weight ?? null;

  const previous = pattern[Math.min(Math.max(0, Number(setNumber || 1) - 1), pattern.length - 1)];
  const previousWeight = Number(previous?.weight || 0);
  if (!previousWeight) return suggestion?.weight ?? null;

  const previousMax = Math.max(...pattern.map(set => Number(set.weight || 0)));
  const suggestedTop = Number(suggestion?.weight || previousMax || 0);
  if (!previousMax || !suggestedTop) return previousWeight;

  // Conserve la structure de la dernière séance (échauffement / séries de travail)
  // tout en appliquant la progression proposée sur la charge haute.
  const ratio = suggestedTop / previousMax;
  return roundToStep(previousWeight * ratio, 0.5);
}

function roundToStep(value, step = 0.5) {
  const safeStep = Math.max(0.1, Number(step || 0.5));
  return Math.round(Number(value || 0) / safeStep) * safeStep;
}

function suggestedExerciseLoad(exercise, data) {
  const last = latestExercisePerformance(exercise.name, data);
  const target = exerciseTargetConfig(exercise, data);
  const fallback = Number(exercise.startWeight || 0);
  const lastWeight = Number(last?.weight || fallback || 0);
  const targetWeight = Number(target?.targetWeight || 0);
  const targetReps = Math.max(1, Number(target?.targetReps || exercise.targetReps || last?.reps || 1));

  if (!lastWeight) {
    return { weight: fallback || null, reps: targetReps, lastWeight: null, lastReps: null, targetWeight, percentIncrease: 0, note: fallback ? "Charge de référence" : "À renseigner" };
  }

  if (!targetWeight || targetWeight <= lastWeight) {
    return { weight: lastWeight, reps: targetReps, lastWeight, lastReps: last?.reps || null, targetWeight, percentIncrease: 0, note: "Charge de la dernière séance" };
  }

  if (last?.pain || Number(last?.maxRpe || 0) >= 9.5) {
    return { weight: lastWeight, reps: targetReps, lastWeight, lastReps: last?.reps || null, targetWeight, percentIncrease: 0, note: last?.pain ? "Maintien conseillé : douleur signalée la dernière fois" : "Maintien conseillé : dernière séance très difficile" };
  }

  const deadline = target?.deadline || todayISO();
  const remainingDays = Math.max(1, daysBetween(todayISO(), deadline));
  const remainingSessions = Math.max(1, Math.ceil((remainingDays / 7) * Math.max(1, Number(target?.sessionsPerWeek || 1))));
  const ratio = targetWeight / lastWeight;
  const requiredRate = ratio > 1 ? Math.pow(ratio, 1 / remainingSessions) - 1 : 0;
  const raw = Math.min(targetWeight, lastWeight * (1 + requiredRate));
  let proposed = roundToStep(raw, 0.5);
  if (proposed < lastWeight) proposed = lastWeight;
  if (proposed > targetWeight) proposed = targetWeight;

  return {
    weight: proposed,
    reps: targetReps,
    lastWeight,
    lastReps: last?.reps || null,
    targetWeight,
    percentIncrease: lastWeight > 0 ? ((proposed - lastWeight) / lastWeight) * 100 : 0,
    note: proposed > lastWeight ? "Progression calculée vers l'objectif" : "Charge maintenue"
  };
}

function workoutExerciseSnapshot(exercise, data, options = {}) {
  const suggestion = suggestedExerciseLoad(exercise, data);
  return {
    id: options.id || exercise.id || uid("session_exercise"),
    sourceExerciseId: exercise.id || null,
    name: exercise.name || options.name || "Exercice",
    targetSets: Math.max(1, Number(exercise.targetSets || options.targetSets || 3)),
    targetReps: Math.max(1, Number(exercise.targetReps || options.targetReps || suggestion.reps || 8)),
    permanentNotes: exercise.notes || "",
    sessionNote: "",
    pain: false,
    painArea: "",
    painIntensity: null,
    painNote: "",
    suggestion,
    addedDuringSession: Boolean(options.addedDuringSession),
    replacedDuringSession: Boolean(options.replacedDuringSession)
  };
}

function sortPrograms(programs) {
  return [...programs].sort((a, b) =>
    (a.order || 0) - (b.order || 0) ||
    String(a.name || "").localeCompare(String(b.name || ""))
  );
}

function sortExercises(exercises) {
  return [...exercises].sort((a, b) =>
    (a.order || 0) - (b.order || 0) ||
    String(a.name || "").localeCompare(String(b.name || ""))
  );
}

function sortSessions(sessions) {
  return [...sessions].sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || "")) ||
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );
}

async function getSportData() {
  const [programs, exercises, sessions, sets, goals, trainingPlans, planSessions, strengthGoalExercises] = await Promise.all([
    getAll("sportPrograms"),
    getAll("sportExercises"),
    getAll("sportSessions"),
    getAll("sportSets"),
    getAll("sportGoals"),
    getAll("sportTrainingPlans"),
    getAll("sportPlanSessions"),
    getAll("sportStrengthGoalExercises")
  ]);

  return {
    programs: sortPrograms(programs.filter(p => p.active !== false)),
    exercises: sortExercises(exercises.filter(e => e.active !== false)),
    sessions: sortSessions(sessions),
    sets,
    goals: goals.filter(g => g.active !== false).sort((a,b) =>
      String(a.deadline || "9999-12-31").localeCompare(String(b.deadline || "9999-12-31"))
    ),
    trainingPlans: trainingPlans.filter(plan => plan.active !== false).sort((a,b) =>
      String(a.deadline || "9999-12-31").localeCompare(String(b.deadline || "9999-12-31"))
    ),
    planSessions: [...planSessions].sort((a,b) => String(a.date || "").localeCompare(String(b.date || ""))),
    strengthGoalExercises: strengthGoalExercises.filter(item => item.active !== false).sort((a,b) => Number(a.order || 0) - Number(b.order || 0))
  };
}

function mondayOf(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  const day = date.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + delta);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function sessionLabel(session) {
  return session.type === "activity"
    ? (session.activityType || "Activité sportive")
    : (session.programName || "Séance");
}

function sessionIcon(session) {
  if (session.type === "workout") return "🏋️";
  const name = normalize(session.activityType);
  if (name.includes("course") || name.includes("running")) return "🏃";
  if (name.includes("foot")) return "⚽";
  if (name.includes("tennis")) return "🎾";
  if (name.includes("natation") || name.includes("nage")) return "🏊";
  if (name.includes("velo") || name.includes("vélo")) return "🚴";
  return "🏅";
}

function completedSessions(sessions) {
  return sessions.filter(s => s.status === "completed");
}

function sessionDuration(session) {
  if (session.duration) return Number(session.duration);

  if (session.startedAt && session.completedAt) {
    const minutes = Math.round(
      (new Date(session.completedAt) - new Date(session.startedAt)) / 60000
    );
    return Math.max(0, minutes);
  }

  return 0;
}

async function getWeekSummary() {
  const sessions = completedSessions(await getAll("sportSessions"));
  const today = todayISO();
  const monday = mondayOf(today);

  const week = sessions.filter(s => s.date >= monday && s.date <= today);
  const latest = sortSessions(sessions)[0] || null;

  return {
    count: week.length,
    structured: week.filter(s => s.type === "workout").length,
    free: week.filter(s => s.type === "activity").length,
    latest
  };
}

async function syncTrackerForSport(date, label) {
  const items = (await getAll("trackerItems")).filter(i => i.active !== false);

  const sportHabit = items.find(item =>
    item.type === "habit" &&
    normalize(item.name).includes("sport")
  );

  if (!sportHabit) return;

  const habitId = `${date}__${sportHabit.id}`;
  const existingHabit = await getOne("trackerEntries", habitId);

  if (!existingHabit || existingHabit.source === "sport" || existingHabit.value !== "yes") {
    const previousValue =
      existingHabit && existingHabit.source !== "sport"
        ? existingHabit.value
        : existingHabit?.previousValue;

    const previousSource =
      existingHabit && existingHabit.source !== "sport"
        ? existingHabit.source || null
        : existingHabit?.previousSource || null;

    await putOne("trackerEntries", {
      id: habitId,
      date,
      itemId: sportHabit.id,
      value: "yes",
      source: "sport",
      previousValue,
      previousSource,
      updatedAt: new Date().toISOString()
    });
  }

  const typeSport = items.find(item =>
    item.categoryId === sportHabit.categoryId &&
    item.type === "text" &&
    normalize(item.name).includes("type de sport")
  );

  if (typeSport) {
    const textId = `${date}__${typeSport.id}`;
    const existingText = await getOne("trackerEntries", textId);

    if (!existingText || existingText.source === "sport") {
      await putOne("trackerEntries", {
        id: textId,
        date,
        itemId: typeSport.id,
        value: label,
        source: "sport",
        updatedAt: new Date().toISOString()
      });
    }
  }
}

async function removeSportTrackerSyncIfNeeded(date) {
  const sessions = completedSessions(await getAll("sportSessions"))
    .filter(s => s.date === date);

  if (sessions.length) {
    const latest = sortSessions(sessions)[0];
    await syncTrackerForSport(date, sessionLabel(latest));
    return;
  }

  const items = (await getAll("trackerItems")).filter(i => i.active !== false);
  const sportHabit = items.find(item =>
    item.type === "habit" &&
    normalize(item.name).includes("sport")
  );

  if (!sportHabit) return;

  const habitId = `${date}__${sportHabit.id}`;
  const habitEntry = await getOne("trackerEntries", habitId);

  if (habitEntry?.source === "sport") {
    if (habitEntry.previousValue !== undefined && habitEntry.previousValue !== null) {
      await putOne("trackerEntries", {
        id: habitId,
        date,
        itemId: sportHabit.id,
        value: habitEntry.previousValue,
        ...(habitEntry.previousSource ? { source: habitEntry.previousSource } : {}),
        updatedAt: new Date().toISOString()
      });
    } else {
      await deleteOne("trackerEntries", habitId);
    }
  }

  const typeSport = items.find(item =>
    item.categoryId === sportHabit.categoryId &&
    item.type === "text" &&
    normalize(item.name).includes("type de sport")
  );

  if (typeSport) {
    const textId = `${date}__${typeSport.id}`;
    const textEntry = await getOne("trackerEntries", textId);

    if (textEntry?.source === "sport") {
      await deleteOne("trackerEntries", textId);
    }
  }
}


const SPORT_METRICS = {
  distance_km: {
    label: "Distance maximale",
    unit: "km",
    direction: "higher"
  },
  distance_m: {
    label: "Distance maximale",
    unit: "m",
    direction: "higher"
  },
  duration_min: {
    label: "Durée d'effort",
    unit: "min",
    direction: "higher"
  },
  speed_kmh: {
    label: "Vitesse moyenne",
    unit: "km/h",
    direction: "higher"
  },
  pace_min_km: {
    label: "Allure moyenne",
    unit: "min/km",
    direction: "lower"
  },
  pace_100m: {
    label: "Allure natation",
    unit: "min/100m",
    direction: "lower"
  },
  sessions_week: {
    label: "Séances par semaine",
    unit: "séances",
    direction: "higher"
  }
};

function sportMatches(session, sportName) {
  const a = normalize(session.activityType || session.programName || "");
  const b = normalize(sportName || "");
  return a && b && (a.includes(b) || b.includes(a));
}

function minutesToPace(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  let min = Math.floor(minutes);
  let sec = Math.round((minutes - min) * 60);
  if (sec === 60) {
    min += 1;
    sec = 0;
  }
  return `${min}:${String(sec).padStart(2,"0")}`;
}

function metricDisplay(metric, value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);

  if (metric === "pace_min_km" || metric === "pace_100m") {
    return `${minutesToPace(number)} ${SPORT_METRICS[metric].unit}`;
  }

  if (metric === "distance_m") {
    return `${Math.round(number).toLocaleString("fr-FR")} m`;
  }

  if (metric === "sessions_week") {
    return `${Math.round(number)} séance${Math.round(number) > 1 ? "s" : ""}`;
  }

  return `${Number.isInteger(number) ? number : number.toFixed(2)} ${SPORT_METRICS[metric]?.unit || ""}`.trim();
}

function activityMetricValue(session, metric) {
  const duration = Number(session.duration || 0);
  const distanceKm = Number(session.distanceKm || 0);
  const distanceM = Number(session.distanceMeters || 0);

  if (metric === "distance_km") return distanceKm > 0 ? distanceKm : null;
  if (metric === "distance_m") return distanceM > 0 ? distanceM : (distanceKm > 0 ? distanceKm * 1000 : null);
  if (metric === "duration_min") return duration > 0 ? duration : null;
  if (metric === "speed_kmh") {
    return duration > 0 && distanceKm > 0 ? distanceKm / (duration / 60) : null;
  }
  if (metric === "pace_min_km") {
    return duration > 0 && distanceKm > 0 ? duration / distanceKm : null;
  }
  if (metric === "pace_100m") {
    const meters = distanceM > 0 ? distanceM : distanceKm * 1000;
    return duration > 0 && meters > 0 ? duration / (meters / 100) : null;
  }

  return null;
}

function goalCurrentValue(goal, sessions) {
  const matching = completedSessions(sessions).filter(s => sportMatches(s, goal.sport));
  const metric = SPORT_METRICS[goal.metric];
  if (!metric) return Number(goal.baseline || 0);

  if (goal.metric === "sessions_week") {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 6);
    const offset = cutoff.getTimezoneOffset();
    const start = new Date(cutoff.getTime() - offset * 60000).toISOString().slice(0,10);
    return matching.filter(s => s.date >= start && s.date <= todayISO()).length;
  }

  const values = matching
    .map(session => activityMetricValue(session, goal.metric))
    .filter(value => Number.isFinite(value));

  if (!values.length) return Number(goal.baseline || 0);

  return metric.direction === "lower"
    ? Math.min(...values)
    : Math.max(...values);
}

function linearExpectedValue(goal) {
  const start = new Date(`${goal.startDate || todayISO()}T12:00:00`);
  const end = new Date(`${goal.deadline || todayISO()}T12:00:00`);
  const now = new Date(`${todayISO()}T12:00:00`);

  const total = Math.max(1, end - start);
  const elapsed = Math.max(0, Math.min(total, now - start));
  const ratio = elapsed / total;

  const baseline = Number(goal.baseline || 0);
  const target = Number(goal.target || 0);

  return baseline + (target - baseline) * ratio;
}

function goalProgressPercent(goal, current) {
  const baseline = Number(goal.baseline || 0);
  const target = Number(goal.target || 0);
  const metric = SPORT_METRICS[goal.metric];

  if (!metric || baseline === target) return 0;

  const raw = metric.direction === "lower"
    ? (baseline - current) / (baseline - target)
    : (current - baseline) / (target - baseline);

  return Math.max(0, Math.min(100, Math.round(raw * 100)));
}

function isGoalOnTrack(goal, current, expected) {
  const metric = SPORT_METRICS[goal.metric];
  if (!metric) return true;

  return metric.direction === "lower"
    ? current <= expected
    : current >= expected;
}

async function renderToday(shell) {
  const data = await getSportData();
  const [summary, trainingLoad] = await Promise.all([
    getWeekSummary(),
    getWeeklyTrainingLoad()
  ]);
  const inProgress = data.sessions.find(s => s.status === "in_progress") || null;
  const recent = completedSessions(data.sessions).slice(0, 3);

  shell.innerHTML = `
    ${tabs("today")}

    <div class="sport-hero">
      <span>Cette semaine</span>
      <strong>${summary.count} activité${summary.count > 1 ? "s" : ""}</strong>
      <small>${summary.structured} séance${summary.structured > 1 ? "s" : ""} structurée${summary.structured > 1 ? "s" : ""} · ${summary.free} activité${summary.free > 1 ? "s" : ""} libre${summary.free > 1 ? "s" : ""}</small>
    </div>

    <section class="sport-load-card ${trainingLoad.warning === "high-rise" ? "warning" : ""}">
      <div class="sport-load-head">
        <div>
          <span>CHARGE HEBDOMADAIRE</span>
          <strong>${Math.round(trainingLoad.current.duration)} min · ${trainingLoad.current.sessions} séance${trainingLoad.current.sessions > 1 ? "s" : ""}</strong>
        </div>
        <b>${trainingLoad.previous.duration ? `${trainingLoad.changes.durationChange > 0 ? "+" : ""}${trainingLoad.changes.durationChange} %` : "Nouveau"}</b>
      </div>
      <div class="sport-load-grid">
        <div><span>🏃 Course</span><strong>${trainingLoad.current.runningKm.toFixed(1)} km</strong></div>
        <div><span>🏊 Natation</span><strong>${Math.round(trainingLoad.current.swimmingMeters).toLocaleString("fr-FR")} m</strong></div>
        <div><span>🏋️ Volume muscu</span><strong>${Math.round(trainingLoad.current.strengthVolume).toLocaleString("fr-FR")} kg</strong></div>
      </div>
      ${trainingLoad.warning === "high-rise" ? `<p>Volume global nettement supérieur à la semaine précédente. La semaine de récupération programmée aidera à absorber la progression.</p>` : ""}
    </section>

    ${
      inProgress
        ? `
          <section class="sport-section">
            <div class="sport-card">
              <strong>Séance en cours</strong>
              <p class="muted" style="margin:5px 0 12px">${escapeHtml(sessionLabel(inProgress))} · ${formatDateLong(inProgress.date)}</p>
              <button class="primary-btn" id="sport-resume-workout">Reprendre la séance</button>
            </div>
          </section>
        `
        : ""
    }

    <div class="sport-actions">
      <button class="sport-action-card" id="sport-start-workout">
        <span>🏋️</span>
        <strong>Démarrer une séance</strong>
        <small>Programme, séries, répétitions, charge et RPE.</small>
      </button>

      <button class="sport-action-card" id="sport-add-activity">
        <span>🏅</span>
        <strong>Activité libre</strong>
        <small>Foot, course, tennis, natation ou autre sport.</small>
      </button>
    </div>

    <div class="sport-sync">
      Une séance ou une activité libre terminée valide automatiquement l'habitude Sport de ton Tracker lorsqu'elle existe.
    </div>

    <section class="sport-section">
      <div class="sport-section-head">
        <div>
          <h2>Dernières activités</h2>
          <p>${summary.latest ? `Dernière : ${escapeHtml(sessionLabel(summary.latest))}` : "Aucune activité enregistrée."}</p>
        </div>
      </div>

      <div class="sport-list">
        ${
          recent.length
            ? recent.map(historyRow).join("")
            : `
              <div class="sport-empty">
                <h3>Aucune activité</h3>
                <p>Commence par créer un programme ou ajoute une activité libre.</p>
              </div>
            `
        }
      </div>
    </section>
  `;

  bindTabs(shell);

  shell.querySelector("#sport-start-workout").addEventListener("click", showStartWorkoutModal);
  shell.querySelector("#sport-add-activity").addEventListener("click", showActivityModal);

  const resume = shell.querySelector("#sport-resume-workout");
  if (resume) {
    resume.addEventListener("click", async () => {
      currentSessionId = inProgress.id;
      currentView = "workout";
      await renderCurrentView();
    });
  }

  bindHistoryRows(shell);
}

function historyRow(session) {
  const duration = sessionDuration(session);

  return `
    <article class="sport-history-row" data-sport-session="${session.id}">
      <div class="sport-history-icon">${sessionIcon(session)}</div>
      <div class="sport-history-main">
        <strong>${escapeHtml(sessionLabel(session))}</strong>
        <small>${session.type === "workout" ? "Séance structurée" : "Activité libre"}${duration ? ` · ${duration} min` : ""}</small>
      </div>
      <div class="sport-history-date">${formatDate(session.date)}</div>
    </article>
  `;
}

function bindHistoryRows(parent) {
  parent.querySelectorAll("[data-sport-session]").forEach(row => {
    row.addEventListener("click", async () => {
      currentSessionId = row.dataset.sportSession;
      currentView = "detail";
      await renderCurrentView();
    });
  });
}

async function showStartWorkoutModal() {
  const data = await getSportData();

  if (!data.programs.length) {
    if (confirm("Tu n'as encore aucun programme. Créer ton premier programme maintenant ?")) {
      currentView = "programs";
      await renderCurrentView();
      showProgramModal();
    }
    return;
  }

  openModal(`
    <div class="modal-head">
      <div>
        <p class="eyebrow">SPORT · SÉANCE EN DIRECT</p>
        <h2>Démarrer une séance</h2>
      </div>
      <button class="icon-btn" id="sport-start-close">×</button>
    </div>

    <form class="form-grid" id="sport-start-form">
      <div class="field">
        <label>Programme de départ</label>
        <select name="programId">
          ${data.programs.map(program => `<option value="${program.id}">${escapeHtml(program.name)}</option>`).join("")}
        </select>
        <small class="muted">Le programme sert de base. Tu pourras ajouter, supprimer ou remplacer des exercices pendant la séance sans modifier le programme d'origine.</small>
      </div>
      <div class="field"><label>Date</label><input type="date" name="date" value="${todayISO()}" required></div>
      <div class="actions"><button type="button" class="ghost-btn" id="sport-start-cancel">Annuler</button><button class="primary-btn" type="submit">Démarrer la séance</button></div>
    </form>
  `);

  document.querySelector("#sport-start-close").addEventListener("click", closeModal);
  document.querySelector("#sport-start-cancel").addEventListener("click", closeModal);

  document.querySelector("#sport-start-form").addEventListener("submit", async event => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const programId = String(fd.get("programId"));
    const program = data.programs.find(p => p.id === programId);
    const exercises = data.exercises.filter(e => e.programId === programId);
    if (!program) return;
    if (!exercises.length) return alert("Ce programme ne contient encore aucun exercice.");

    const existing = data.sessions.find(s => s.status === "in_progress");
    if (existing) return alert("Une séance est déjà en cours. Termine-la ou abandonne-la avant d'en démarrer une nouvelle.");

    const workoutExercises = exercises.map(exercise => workoutExerciseSnapshot(exercise, data));
    const now = new Date().toISOString();
    const session = {
      id: uid("sport_session"),
      type: "workout",
      status: "in_progress",
      date: String(fd.get("date") || todayISO()),
      programId: program.id,
      programName: program.name,
      workoutExercises,
      startedAt: now,
      completedAt: null,
      duration: null,
      durationMin: null,
      createdAt: now
    };

    await putOne("sportSessions", session);

    for (const item of workoutExercises) {
      const targetSets = Math.max(1, Number(item.targetSets || 1));
      for (let setNumber = 1; setNumber <= targetSets; setNumber++) {
        await putOne("sportSets", {
          id: uid("sport_set"),
          sessionId: session.id,
          exerciseId: item.id,
          exerciseName: item.name,
          setNumber,
          reps: null,
          weight: suggestedSetWeight(item, data, setNumber),
          rpe: null,
          suggestedWeight: suggestedSetWeight(item, data, setNumber),
          createdAt: now
        });
      }
    }

    closeModal();
    currentSessionId = session.id;
    currentView = "workout";
    await renderCurrentView();
  });
}

async function persistWorkoutExercise(sessionId, exerciseId, patch) {
  const session = await getOne("sportSessions", sessionId);
  if (!session) return null;
  const items = [...(session.workoutExercises || [])];
  const index = items.findIndex(item => item.id === exerciseId);
  if (index < 0) return null;
  items[index] = { ...items[index], ...patch };
  const saved = { ...session, workoutExercises: items, updatedAt: new Date().toISOString() };
  await putOne("sportSessions", saved);
  return saved;
}

async function addSetsForWorkoutExercise(session, item, data, setsCount = null) {
  const suggestion = item.suggestion || suggestedExerciseLoad(item, data);
  const targetSets = Math.max(1, Number(setsCount || item.targetSets || 1));
  for (let setNumber = 1; setNumber <= targetSets; setNumber++) {
    await putOne("sportSets", {
      id: uid("sport_set"),
      sessionId: session.id,
      exerciseId: item.id,
      exerciseName: item.name,
      setNumber,
      reps: null,
      weight: suggestedSetWeight(item, data, setNumber),
      rpe: null,
      suggestedWeight: suggestedSetWeight(item, data, setNumber),
      createdAt: new Date().toISOString()
    });
  }
}

async function showWorkoutExercisePicker(session, mode = "add", replaceId = null) {
  const data = await getSportData();
  const unique = [];
  const seen = new Set();
  for (const exercise of data.exercises) {
    const key = normalize(exercise.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(exercise);
  }

  openModal(`
    <div class="modal-head"><div><p class="eyebrow">SÉANCE EN DIRECT</p><h2>${mode === "replace" ? "Remplacer l'exercice" : "Ajouter un exercice"}</h2></div><button class="icon-btn" id="sport-flex-close">×</button></div>
    <form class="form-grid" id="sport-flex-form">
      <div class="field">
        <label>Exercice existant</label>
        <select name="existingId"><option value="">— Saisie libre —</option>${unique.map(ex => `<option value="${ex.id}">${escapeHtml(ex.name)}</option>`).join("")}</select>
      </div>
      <div class="field"><label>Ou nom libre</label><input name="customName" maxlength="100" placeholder="Ex : Élévations latérales"></div>
      <div class="row"><div class="field"><label>Séries</label><input type="number" name="targetSets" min="1" max="20" value="3"></div><div class="field"><label>Reps cibles</label><input type="number" name="targetReps" min="1" max="100" value="10"></div></div>
      <div class="actions"><button type="button" class="ghost-btn" id="sport-flex-cancel">Annuler</button><button class="primary-btn" type="submit">${mode === "replace" ? "Remplacer" : "Ajouter"}</button></div>
    </form>
  `);
  document.querySelector("#sport-flex-close").onclick = closeModal;
  document.querySelector("#sport-flex-cancel").onclick = closeModal;
  document.querySelector("#sport-flex-form").onsubmit = async event => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const existing = data.exercises.find(ex => ex.id === String(fd.get("existingId") || ""));
    const customName = String(fd.get("customName") || "").trim();
    if (!existing && !customName) return alert("Choisis un exercice existant ou saisis un nom.");

    const base = existing || {
      id: null,
      name: customName,
      targetSets: Math.max(1, Number(fd.get("targetSets") || 3)),
      targetReps: Math.max(1, Number(fd.get("targetReps") || 10)),
      startWeight: 0,
      notes: ""
    };
    const item = workoutExerciseSnapshot(base, data, {
      id: existing?.id || uid("session_exercise"),
      addedDuringSession: mode === "add",
      replacedDuringSession: mode === "replace"
    });
    if (!existing) {
      item.targetSets = Math.max(1, Number(fd.get("targetSets") || 3));
      item.targetReps = Math.max(1, Number(fd.get("targetReps") || 10));
    }

    const fresh = await getOne("sportSessions", session.id);
    let items = [...(fresh.workoutExercises || [])];
    if (mode === "replace") {
      const old = items.find(row => row.id === replaceId);
      const oldSets = (await getAll("sportSets")).filter(set => set.sessionId === session.id && set.exerciseId === replaceId);
      for (const set of oldSets) await deleteOne("sportSets", set.id);
      items = items.filter(row => row.id !== replaceId);
      item.replacedExerciseName = old?.name || "";
    }
    if (items.some(row => row.id === item.id)) item.id = uid("session_exercise");
    items.push(item);
    await putOne("sportSessions", { ...fresh, workoutExercises: items, updatedAt: new Date().toISOString() });
    await addSetsForWorkoutExercise(session, item, data);
    closeModal();
    await renderWorkout(lastContainer.querySelector("#sport-shell") || lastContainer, session.id);
  };
}

async function showCorrectWorkoutTimeModal(session) {
  const completed = session.status === "completed";
  openModal(`
    <div class="modal-head"><div><p class="eyebrow">TEMPS DE SÉANCE</p><h2>Corriger l'heure</h2></div><button class="icon-btn" id="sport-time-close">×</button></div>
    <form class="form-grid" id="sport-time-form">
      <div class="field"><label>Début</label><input type="datetime-local" name="startedAt" value="${dateTimeLocalValue(session.startedAt)}" required></div>
      ${completed ? `<div class="field"><label>Fin</label><input type="datetime-local" name="completedAt" value="${dateTimeLocalValue(session.completedAt)}" required></div>` : `<small class="muted">La séance est encore en cours : seule l'heure de départ est corrigée.</small>`}
      <div class="actions"><button type="button" class="ghost-btn" id="sport-time-cancel">Annuler</button><button class="primary-btn" type="submit">Enregistrer</button></div>
    </form>
  `);
  document.querySelector("#sport-time-close").onclick = closeModal;
  document.querySelector("#sport-time-cancel").onclick = closeModal;
  document.querySelector("#sport-time-form").onsubmit = async event => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const startedAt = new Date(String(fd.get("startedAt"))).toISOString();
    const completedAt = completed ? new Date(String(fd.get("completedAt"))).toISOString() : null;
    if (completed && new Date(completedAt) <= new Date(startedAt)) return alert("L'heure de fin doit être postérieure à l'heure de début.");
    const duration = completed ? Math.max(1, Math.round((new Date(completedAt) - new Date(startedAt)) / 60000)) : null;
    await putOne("sportSessions", { ...session, startedAt, ...(completed ? { completedAt, duration, durationMin: duration } : {}), updatedAt: new Date().toISOString() });
    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrentView();
  };
}

async function renderWorkout(shell, sessionId) {
  const data = await getSportData();
  let session = data.sessions.find(s => s.id === sessionId);

  if (!session || session.status !== "in_progress") {
    stopWorkoutTimer();
    currentView = "today";
    currentSessionId = null;
    await renderCurrentView();
    return;
  }

  let workoutExercises = session.workoutExercises;
  if (!Array.isArray(workoutExercises) || !workoutExercises.length) {
    workoutExercises = data.exercises.filter(e => e.programId === session.programId).map(exercise => workoutExerciseSnapshot(exercise, data));
    session = { ...session, workoutExercises };
    await putOne("sportSessions", session);
  }

  const sessionSets = data.sets.filter(s => s.sessionId === session.id);

  shell.innerHTML = `
    <button class="stock-back" id="sport-workout-back">‹ Sport</button>

    <div class="sport-workout-top sport-live-head">
      <span class="eyebrow" style="color:#c7ced8">SÉANCE EN COURS</span>
      <h2>${escapeHtml(session.programName || "Séance")}</h2>
      <p>${formatDateLong(session.date)}</p>
      <div class="sport-live-summary">
        <div><span>Exercices</span><strong>${workoutExercises.length}</strong></div>
        <div><span>Séries</span><strong>${sessionSets.length}</strong></div>
        <div class="sport-live-timer"><span>Durée</span><strong id="sport-live-timer">${durationClock(sessionDurationMinutes(session))}</strong></div>
      </div>
      <button class="sport-time-edit" id="sport-correct-time">Corriger l'heure</button>
    </div>

    <div class="sport-live-toolbar">
      <div>
        <strong>Exercices de la séance</strong>
        <small>Tu peux adapter cette séance sans modifier le programme d'origine.</small>
      </div>
      <button class="primary-btn" id="sport-add-exercise-live">+ Ajouter un exercice</button>
    </div>

    <div>
      ${workoutExercises.map((exercise, exerciseIndex) => {
        const sets = sessionSets.filter(s => s.exerciseId === exercise.id).sort((a,b) => Number(a.setNumber || 0) - Number(b.setNumber || 0));
        const suggestion = exercise.suggestion || suggestedExerciseLoad(exercise, data);
        return `
          <section class="sport-workout-exercise" data-workout-exercise="${exercise.id}">
            <div class="sport-live-exercise-head">
              <div class="sport-live-exercise-title">
                <span class="sport-exercise-index">${exerciseIndex + 1}</span>
                <div>
                  <h3>${escapeHtml(exercise.name)}</h3>
                  <span class="sport-target">${exercise.targetSets || "—"} série${Number(exercise.targetSets) > 1 ? "s" : ""} × ${exercise.targetReps || "—"} reps</span>
                </div>
              </div>
              <div class="sport-live-exercise-actions">
                <div class="sport-order-actions">
                  <button class="sport-icon-action" data-move-exercise="up" data-exercise-id="${exercise.id}" aria-label="Monter l'exercice">↑</button>
                  <button class="sport-icon-action" data-move-exercise="down" data-exercise-id="${exercise.id}" aria-label="Descendre l'exercice">↓</button>
                </div>
                <button class="sport-secondary-action" data-replace-exercise="${exercise.id}">Remplacer</button>
                <button class="sport-danger-action" data-remove-exercise="${exercise.id}">Supprimer</button>
              </div>
            </div>

            ${suggestion?.weight ? `<div class="sport-load-suggestion"><strong>Charge suggérée : ${roundWeight(suggestion.weight)} kg</strong><small>${suggestion.lastWeight ? `Dernière : ${roundWeight(suggestion.lastWeight)} kg${suggestion.lastReps ? ` × ${suggestion.lastReps}` : ""}` : suggestion.note}${suggestion.percentIncrease > 0 ? ` · +${suggestion.percentIncrease.toFixed(1)} %` : ""}${suggestion.targetWeight ? ` · cible ${roundWeight(suggestion.targetWeight)} kg` : ""}</small></div>` : ""}
            ${exercise.permanentNotes ? `<div class="sport-permanent-note"><strong>Consigne permanente</strong><span>${escapeHtml(exercise.permanentNotes)}</span></div>` : ""}

            <div class="sport-sets">
              <div class="sport-set-head"><span>#</span><span>Charge</span><span>Reps</span><span>RPE</span><span></span></div>
              ${sets.map(set => `
                <div class="sport-set-row" data-set-row="${set.id}">
                  <span>${set.setNumber}</span>
                  <input data-set-field="weight" inputmode="decimal" type="number" min="0" step="0.5" value="${set.weight ?? ""}" placeholder="0">
                  <input data-set-field="reps" inputmode="numeric" type="number" min="0" step="1" value="${set.reps ?? ""}" placeholder="${exercise.targetReps || 0}">
                  <input data-set-field="rpe" inputmode="decimal" type="number" min="0" max="10" step="0.5" value="${set.rpe ?? ""}" placeholder="—">
                  <button class="sport-remove-set" data-remove-set="${set.id}" aria-label="Supprimer la série">×</button>
                </div>`).join("")}
            </div>
            <button class="sport-add-set" data-add-set="${exercise.id}">+ Ajouter une série</button>

            <div class="sport-exercise-feedback">
              <div class="sport-live-notes">
                <label>Note de séance</label>
                <textarea data-exercise-note="${exercise.id}" placeholder="Sensation, réglage, technique…">${escapeHtml(exercise.sessionNote || "")}</textarea>
              </div>
              <label class="sport-pain-toggle"><input type="checkbox" data-pain-toggle="${exercise.id}" ${exercise.pain ? "checked" : ""}><span><strong>Douleur pendant l'exercice</strong><small>Active uniquement si une douleur est apparue.</small></span></label>
            </div>
            <div class="sport-pain-details ${exercise.pain ? "" : "hidden"}" data-pain-details="${exercise.id}">
              <div class="row"><div class="field"><label>Zone</label><input data-pain-area="${exercise.id}" value="${escapeHtml(exercise.painArea || "")}" placeholder="Ex : épaule droite"></div><div class="field"><label>Intensité /10</label><input type="number" min="1" max="10" step="1" data-pain-intensity="${exercise.id}" value="${exercise.painIntensity ?? ""}"></div></div>
              <div class="field"><label>Note douleur</label><input data-pain-note="${exercise.id}" value="${escapeHtml(exercise.painNote || "")}" placeholder="Quand apparaît-elle ?"></div>
            </div>
          </section>`;
      }).join("")}
    </div>

    <div class="sport-workout-actions"><button class="primary-btn" id="sport-finish-workout">Terminer la séance</button><button class="danger-btn" id="sport-cancel-workout">Abandonner la séance</button></div>
  `;

  startWorkoutTimer(session, shell);

  shell.querySelector("#sport-workout-back").onclick = async () => { stopWorkoutTimer(); currentView = "today"; await renderCurrentView(); };
  shell.querySelector("#sport-correct-time").onclick = () => showCorrectWorkoutTimeModal(session);
  shell.querySelector("#sport-add-exercise-live").onclick = () => showWorkoutExercisePicker(session, "add");

  shell.querySelectorAll("[data-set-row]").forEach(row => row.querySelectorAll("[data-set-field]").forEach(input => input.addEventListener("change", async () => {
    const set = await getOne("sportSets", row.dataset.setRow); if (!set) return;
    const value = input.value === "" ? null : Number(input.value);
    await putOne("sportSets", { ...set, [input.dataset.setField]: value, updatedAt: new Date().toISOString() });
  })));

  shell.querySelectorAll("[data-remove-set]").forEach(btn => btn.onclick = async () => { await deleteOne("sportSets", btn.dataset.removeSet); await renderWorkout(shell, session.id); });
  shell.querySelectorAll("[data-add-set]").forEach(btn => btn.onclick = async () => {
    const exerciseId = btn.dataset.addSet;
    const exercise = workoutExercises.find(e => e.id === exerciseId);
    const existingSets = (await getAll("sportSets")).filter(s => s.sessionId === session.id && s.exerciseId === exerciseId);
    const nextNumber = existingSets.length ? Math.max(...existingSets.map(s => Number(s.setNumber || 0))) + 1 : 1;
    const dataNow = await getSportData();
    await putOne("sportSets", { id: uid("sport_set"), sessionId: session.id, exerciseId, exerciseName: exercise?.name || "Exercice", setNumber: nextNumber, reps: null, weight: suggestedSetWeight(exercise, dataNow, nextNumber), rpe: null, createdAt: new Date().toISOString() });
    await renderWorkout(shell, session.id);
  });

  shell.querySelectorAll("[data-move-exercise]").forEach(btn => btn.onclick = async () => {
    const fresh = await getOne("sportSessions", session.id);
    const items = [...(fresh?.workoutExercises || [])];
    const index = items.findIndex(item => item.id === btn.dataset.exerciseId);
    if (index < 0) return;
    const targetIndex = btn.dataset.moveExercise === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    [items[index], items[targetIndex]] = [items[targetIndex], items[index]];
    await putOne("sportSessions", { ...fresh, workoutExercises: items, updatedAt: new Date().toISOString() });
    await renderWorkout(shell, session.id);
  });

  shell.querySelectorAll("[data-remove-exercise]").forEach(btn => btn.onclick = async () => {
    const item = workoutExercises.find(ex => ex.id === btn.dataset.removeExercise);
    if (!item || !confirm(`Retirer « ${item.name} » de cette séance ? Le programme d'origine ne sera pas modifié.`)) return;
    const fresh = await getOne("sportSessions", session.id);
    const sets = (await getAll("sportSets")).filter(set => set.sessionId === session.id && set.exerciseId === item.id);
    for (const set of sets) await deleteOne("sportSets", set.id);
    await putOne("sportSessions", { ...fresh, workoutExercises: (fresh.workoutExercises || []).filter(ex => ex.id !== item.id), updatedAt: new Date().toISOString() });
    await renderWorkout(shell, session.id);
  });
  shell.querySelectorAll("[data-replace-exercise]").forEach(btn => btn.onclick = () => showWorkoutExercisePicker(session, "replace", btn.dataset.replaceExercise));

  shell.querySelectorAll("[data-exercise-note]").forEach(input => input.addEventListener("change", () => persistWorkoutExercise(session.id, input.dataset.exerciseNote, { sessionNote: input.value.trim() })));
  shell.querySelectorAll("[data-pain-toggle]").forEach(input => input.addEventListener("change", async () => {
    await persistWorkoutExercise(session.id, input.dataset.painToggle, { pain: input.checked });
    const details = shell.querySelector(`[data-pain-details="${input.dataset.painToggle}"]`); if (details) details.classList.toggle("hidden", !input.checked);
  }));
  shell.querySelectorAll("[data-pain-area]").forEach(input => input.addEventListener("change", () => persistWorkoutExercise(session.id, input.dataset.painArea, { painArea: input.value.trim() })));
  shell.querySelectorAll("[data-pain-intensity]").forEach(input => input.addEventListener("change", () => persistWorkoutExercise(session.id, input.dataset.painIntensity, { painIntensity: input.value ? Number(input.value) : null })));
  shell.querySelectorAll("[data-pain-note]").forEach(input => input.addEventListener("change", () => persistWorkoutExercise(session.id, input.dataset.painNote, { painNote: input.value.trim() })));

  shell.querySelector("#sport-finish-workout").onclick = async () => {
    const setsNow = (await getAll("sportSets")).filter(s => s.sessionId === session.id);
    const completedSets = setsNow.filter(s => Number(s.reps || 0) > 0);
    if (!completedSets.length && !confirm("Aucune série n'est validée avec des répétitions. Terminer quand même la séance ?")) return;
    const fresh = await getOne("sportSessions", session.id);
    const completedAt = new Date().toISOString();
    const duration = Math.max(1, Math.round((new Date(completedAt) - new Date(fresh.startedAt)) / 60000));
    const completed = { ...fresh, status: "completed", completedAt, duration, durationMin: duration, updatedAt: completedAt };
    await putOne("sportSessions", completed);
    await syncTrackerForSport(completed.date, completed.programName || "Musculation");
    await completeSportPlanFromWorkout(completed);
    stopWorkoutTimer();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    currentView = "detail"; currentSessionId = completed.id; await renderCurrentView();
  };

  shell.querySelector("#sport-cancel-workout").onclick = async () => {
    if (!confirm("Abandonner cette séance ? Les séries enregistrées seront supprimées.")) return;
    const setsNow = (await getAll("sportSets")).filter(s => s.sessionId === session.id);
    for (const set of setsNow) await deleteOne("sportSets", set.id);
    await deleteOne("sportSessions", session.id);
    stopWorkoutTimer(); currentSessionId = null; currentView = "today"; await renderCurrentView();
  };
}

async function showActivityModal(preset = {}) {
  const goals = (await getAll("sportGoals"))
    .filter(goal => goal.active !== false && goal.goalType === "performance")
    .sort((a,b) => String(a.deadline || "9999-12-31").localeCompare(String(b.deadline || "9999-12-31")));

  const presetGoalId = preset.goalId || preset.sportGoalId || "";
  const presetGoal = goals.find(goal => goal.id === presetGoalId);
  const initialSportId = canonicalSportId(
    preset.sportId ||
    preset.activityType ||
    presetGoal?.sportId ||
    presetGoal?.sport ||
    "running"
  );

  openModal(`
    <div class="modal-head">
      <div>
        <p class="eyebrow">SPORT</p>
        <h2>Activité libre</h2>
      </div>
      <button class="icon-btn" id="sport-activity-close">×</button>
    </div>

    <form class="form-grid" id="sport-activity-form">
      <div class="field">
        <label>Sport</label>
        <select id="sport-activity-sport" name="sportId" required>
          ${sportSelectOptions(initialSportId)}
        </select>
        <small class="muted">Le sport choisi relie automatiquement l'activité aux Records, Objectifs, Programmes et au Tracker.</small>
      </div>

      ${
        goals.length
          ? `
            <div class="field">
              <label>Objectif lié</label>
              <select name="goalId" id="sport-activity-goal">
                <option value="">Détection automatique / aucun</option>
                ${goals.map(goal => `
                  <option
                    value="${goal.id}"
                    data-sport-id="${goalSportId(goal)}"
                    ${goal.id === presetGoalId ? "selected" : ""}
                  >
                    ${catalogSportIcon(goalSportId(goal))} ${escapeHtml(goal.name || goal.sport)}
                  </option>
                `).join("")}
              </select>
              <small class="muted">Si une séance du programme est prévue à ±3 jours, MyHub peut la valider automatiquement.</small>
            </div>
          `
          : ""
      }

      <div class="row">
        <div class="field">
          <label>Date</label>
          <input type="date" name="date" value="${preset.date || todayISO()}" required>
        </div>

        <div class="field">
          <label>Durée (min)</label>
          <input type="number" name="duration" min="0" step="0.1" value="${preset.duration ?? ""}" placeholder="Ex : 45">
        </div>
      </div>

      <div class="sport-activity-metrics" id="sport-distance-fields">
        <div class="field">
          <label>Distance</label>
          <input type="number" name="distance" min="0" step="0.01" value="${preset.distance ?? ""}" placeholder="Ex : 10">
        </div>

        <div class="field">
          <label>Unité</label>
          <select name="distanceUnit" id="sport-distance-unit">
            <option value="km" ${(preset.distanceUnit || "km") === "km" ? "selected" : ""}>Kilomètres</option>
            <option value="m" ${preset.distanceUnit === "m" ? "selected" : ""}>Mètres</option>
          </select>
        </div>
      </div>

      <div class="field">
        <label>Notes</label>
        <textarea name="notes" placeholder="Sensations, parcours, technique, conditions...">${escapeHtml(preset.notes || "")}</textarea>
      </div>

      <div class="actions">
        <button type="button" class="ghost-btn" id="sport-activity-cancel">Annuler</button>
        <button class="primary-btn" type="submit">Enregistrer</button>
      </div>
    </form>
  `);

  const sportSelect = document.querySelector("#sport-activity-sport");
  const goalSelect = document.querySelector("#sport-activity-goal");
  const distanceFields = document.querySelector("#sport-distance-fields");
  const unitSelect = document.querySelector("#sport-distance-unit");

  function refreshSportFields({ setDefaultUnit = false } = {}) {
    const sportId = canonicalSportId(sportSelect?.value || "");
    if (distanceFields) {
      distanceFields.style.display = sportSupportsDistance(sportId) ? "grid" : "none";
    }
    if (unitSelect && setDefaultUnit) unitSelect.value = sportDefaultUnit(sportId);

    if (goalSelect) {
      [...goalSelect.options].forEach(option => {
        if (!option.value) {
          option.hidden = false;
          return;
        }
        option.hidden = option.dataset.sportId !== sportId;
      });

      if (goalSelect.value) {
        const selected = goalSelect.options[goalSelect.selectedIndex];
        if (selected?.dataset.sportId !== sportId) goalSelect.value = "";
      }
    }
  }

  refreshSportFields();

  sportSelect?.addEventListener("change", () => refreshSportFields({ setDefaultUnit: true }));

  goalSelect?.addEventListener("change", () => {
    const goal = goals.find(item => item.id === goalSelect.value);
    if (!goal) return;
    sportSelect.value = goalSportId(goal);
    if (unitSelect && goal.targetDistanceUnit) unitSelect.value = goal.targetDistanceUnit;
    refreshSportFields();
  });

  document.querySelector("#sport-activity-close").addEventListener("click", closeModal);
  document.querySelector("#sport-activity-cancel").addEventListener("click", closeModal);

  document.querySelector("#sport-activity-form").addEventListener("submit", async event => {
    event.preventDefault();

    const fd = new FormData(event.target);
    const sportId = canonicalSportId(fd.get("sportId") || "other");
    const activityType = sportLabel(sportId);
    const distance = Number(fd.get("distance") || 0);
    const distanceUnit = String(fd.get("distanceUnit") || sportDefaultUnit(sportId));
    const goalId = String(fd.get("goalId") || "") || null;

    const distanceKm = distance > 0
      ? (distanceUnit === "m" ? distance / 1000 : distance)
      : 0;

    const distanceMeters = distance > 0
      ? (distanceUnit === "m" ? distance : distance * 1000)
      : 0;

    const session = {
      id: uid("sport_session"),
      type: "activity",
      status: "completed",
      date: String(fd.get("date") || todayISO()),
      sportId,
      activityType,
      duration: Number(fd.get("duration") || 0),
      distance: sportSupportsDistance(sportId) ? distance : 0,
      distanceUnit,
      distanceKm: sportSupportsDistance(sportId) ? distanceKm : 0,
      distanceMeters: sportSupportsDistance(sportId) ? distanceMeters : 0,
      sportGoalId: goalId,
      notes: String(fd.get("notes") || "").trim(),
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    };

    await putOne("sportSessions", session);
    await syncTrackerForSport(session.date, activityType);
    await completeSportPlanFromActivity(session, goalId);

    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));

    currentSessionId = session.id;
    currentView = "detail";
    await renderCurrentView();
  });
}

function generatedProgramsHtml(data) {
  if (!data.trainingPlans.length) return "";

  const goalMap = new Map(data.goals.map(goal => [goal.id, goal]));

  return `
    <section class="sport-section">
      <div class="sport-section-head">
        <div>
          <h2>Programmes générés par objectifs</h2>
          <p>Les séances évoluent automatiquement entre ton niveau de départ et l'échéance.</p>
        </div>
      </div>

      <div class="sport-list">
        ${data.trainingPlans.map(plan => {
          const goal = goalMap.get(plan.goalId);
          const sessions = data.planSessions.filter(session => session.planId === plan.id && !session.skipped);
          const completed = sessions.filter(session => session.completed).length;
          const future = sessions.filter(session => !session.completed && session.date >= todayISO());
          const next = future[0] || null;
          const progress = sessions.length ? Math.round((completed / sessions.length) * 100) : 0;

          return `
            <article class="sport-auto-program">
              <div class="sport-auto-program-head">
                <div>
                  <span class="sport-plan-label">${goal?.goalType === "strength" ? "🏋️ MUSCULATION" : isSwimmingSport(goal?.sport) ? "🏊 NATATION" : "🏃 ENDURANCE"}</span>
                  <h3>${escapeHtml(plan.name)}</h3>
                  <p>${plan.sessionsPerWeek} séance${plan.sessionsPerWeek > 1 ? "s" : ""}/semaine · jusqu'au ${formatDate(plan.deadline)}</p>
                </div>
                <div class="sport-program-actions">
                  <button class="icon-btn" data-adapt-plan="${plan.goalId}" aria-label="Adapter">↻</button>
                  <button class="icon-btn" data-delete-auto-plan="${plan.goalId}" aria-label="Supprimer">×</button>
                </div>
              </div>

              <div class="sport-progress-bar" style="margin-top:12px"><i style="width:${progress}%"></i></div>
              <div class="sport-auto-program-summary">
                <strong>${completed}/${sessions.length} séances réalisées</strong>
                <span>${next ? `Prochaine : ${formatDate(next.date)} · ${escapeHtml(next.title)}` : "Programme terminé"}</span>
              </div>

              ${
                future.length
                  ? `
                    <div class="sport-plan-next-list">
                      ${future.slice(0,6).map(session => `
                        <div class="sport-plan-next">
                          <div>
                            <strong>${formatDate(session.date)} · ${escapeHtml(session.title)}</strong>
                            <small>${escapeHtml(getSportPhaseLabel(session.phase))} · semaine ${session.weekIndex}</small>
                          </div>
                          <span>${session.role === "test" || session.role === "final" ? "🏁" : "✓"}</span>
                        </div>
                      `).join("")}
                    </div>
                  `
                  : ""
              }
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

async function renderPrograms(shell) {
  const data = await getSportData();

  shell.innerHTML = `
    ${tabs("programs")}
    ${generatedProgramsHtml(data)}

    <section class="sport-section">
      <div class="sport-section-head">
        <div>
          <h2>Mes programmes</h2>
          <p>${data.programs.length} programme${data.programs.length > 1 ? "s" : ""} actif${data.programs.length > 1 ? "s" : ""}</p>
        </div>
        <button class="primary-btn" id="sport-add-program">+ Programme</button>
      </div>

      <div class="sport-list">
        ${
          data.programs.length
            ? data.programs.map(program => {
                const exercises = data.exercises.filter(e => e.programId === program.id);

                return `
                  <section class="sport-program">
                    <div class="sport-program-head">
                      <div>
                        <h3>${escapeHtml(program.name)}</h3>
                        <p>${escapeHtml(program.description || `${exercises.length} exercice${exercises.length > 1 ? "s" : ""}`)}</p>
                      </div>

                      <div class="sport-program-actions">
                        <button class="icon-btn" data-edit-program="${program.id}" aria-label="Modifier">✎</button>
                        <button class="icon-btn" data-delete-program="${program.id}" aria-label="Supprimer">×</button>
                      </div>
                    </div>

                    <div class="sport-exercises">
                      ${exercises.map(exercise => `
                        <article class="sport-exercise">
                          <div class="sport-exercise-head">
                            <div>
                              <h3>${escapeHtml(exercise.name)}</h3>
                              <div class="sport-exercise-meta">
                                ${exercise.targetSets || "—"} série${Number(exercise.targetSets) > 1 ? "s" : ""} × ${exercise.targetReps || "—"} reps
                                ${Number(exercise.startWeight || 0) > 0 ? ` · départ ${roundWeight(exercise.startWeight)} kg` : ""}
                              </div>
                              ${
                                Number(exercise.targetWeight || 0) > 0
                                  ? `<span class="sport-goal-badge">Cible ${roundWeight(exercise.targetWeight)} kg × ${exercise.targetReps || "—"}${exercise.goalDeadline ? ` · ${formatDate(exercise.goalDeadline)}` : ""}</span>`
                                  : Number(exercise.goalPercent || 0) > 0 && Number(exercise.goalMonths || 0) > 0
                                    ? `<span class="sport-goal-badge">Ancienne cible +${exercise.goalPercent}% en ${exercise.goalMonths} mois</span>`
                                    : ""
                              }
                            </div>

                            <div class="sport-exercise-actions">
                              <button class="icon-btn" data-edit-exercise="${exercise.id}" aria-label="Modifier">✎</button>
                              <button class="icon-btn" data-delete-exercise="${exercise.id}" aria-label="Supprimer">×</button>
                            </div>
                          </div>
                        </article>
                      `).join("")}

                      <button class="ghost-btn" data-add-exercise="${program.id}">+ Ajouter un exercice</button>
                    </div>
                  </section>
                `;
              }).join("")
            : `
              <div class="sport-empty">
                <h3>Aucun programme</h3>
                <p>Crée un programme pour enregistrer tes séances détaillées.</p>
                <button class="primary-btn" id="sport-empty-program">Créer mon premier programme</button>
              </div>
            `
        }
      </div>
    </section>
  `;

  bindTabs(shell);

  shell.querySelectorAll("[data-adapt-plan]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const goal = data.goals.find(item => item.id === btn.dataset.adaptPlan);
      if (!goal) return;
      if (!confirm("Adapter les séances futures à partir de ton niveau actuel ? Les séances passées et déjà réalisées seront conservées.")) return;
      await adaptSportPlan(goal);
      await renderPrograms(shell);
      window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    });
  });

  shell.querySelectorAll("[data-delete-auto-plan]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const goal = data.goals.find(item => item.id === btn.dataset.deleteAutoPlan);
      if (!goal) return;
      if (!confirm(`Supprimer le programme généré pour "${goal.name || goal.sport}" ? L'objectif sera conservé.`)) return;
      await deleteSportPlan(goal.id);
      await renderPrograms(shell);
      window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    });
  });

  shell.querySelector("#sport-add-program").addEventListener("click", () => showProgramModal());

  const emptyButton = shell.querySelector("#sport-empty-program");
  if (emptyButton) emptyButton.addEventListener("click", () => showProgramModal());

  shell.querySelectorAll("[data-edit-program]").forEach(btn => {
    btn.addEventListener("click", () => showProgramModal(btn.dataset.editProgram));
  });

  shell.querySelectorAll("[data-delete-program]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const program = data.programs.find(p => p.id === btn.dataset.deleteProgram);
      if (!program) return;

      const linkedExercises = data.exercises.filter(e => e.programId === program.id);

      if (!confirm(`Supprimer le programme "${program.name}" et ses ${linkedExercises.length} exercice(s) ? L'historique des anciennes séances sera conservé.`)) {
        return;
      }

      for (const exercise of linkedExercises) {
        await deleteOne("sportExercises", exercise.id);
      }

      await deleteOne("sportPrograms", program.id);
      await renderPrograms(shell);
    });
  });

  shell.querySelectorAll("[data-add-exercise]").forEach(btn => {
    btn.addEventListener("click", () => showExerciseModal(null, btn.dataset.addExercise));
  });

  shell.querySelectorAll("[data-edit-exercise]").forEach(btn => {
    btn.addEventListener("click", () => showExerciseModal(btn.dataset.editExercise));
  });

  shell.querySelectorAll("[data-delete-exercise]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const exercise = data.exercises.find(e => e.id === btn.dataset.deleteExercise);
      if (!exercise) return;

      if (!confirm(`Supprimer "${exercise.name}" du programme ? L'historique déjà enregistré sera conservé.`)) {
        return;
      }

      await deleteOne("sportExercises", exercise.id);
      await renderPrograms(shell);
    });
  });
}

async function showProgramModal(programId = null) {
  const programs = await getAll("sportPrograms");
  const program = programs.find(p => p.id === programId);

  openModal(`
    <div class="modal-head">
      <div>
        <p class="eyebrow">SPORT</p>
        <h2>${program ? "Modifier" : "Nouveau"} programme</h2>
      </div>
      <button class="icon-btn" id="sport-program-close">×</button>
    </div>

    <form class="form-grid" id="sport-program-form">
      <div class="field">
        <label>Nom</label>
        <input name="name" required maxlength="80" value="${escapeHtml(program?.name || "")}" placeholder="Ex : Full Body lourd">
      </div>

      <div class="field">
        <label>Description</label>
        <textarea name="description" placeholder="Objectif ou particularités de la séance...">${escapeHtml(program?.description || "")}</textarea>
      </div>

      <div class="actions">
        <button type="button" class="ghost-btn" id="sport-program-cancel">Annuler</button>
        <button class="primary-btn" type="submit">Enregistrer</button>
      </div>
    </form>
  `);

  document.querySelector("#sport-program-close").addEventListener("click", closeModal);
  document.querySelector("#sport-program-cancel").addEventListener("click", closeModal);

  document.querySelector("#sport-program-form").addEventListener("submit", async event => {
    event.preventDefault();

    const fd = new FormData(event.target);

    await putOne("sportPrograms", {
      ...(program || {}),
      id: program?.id || uid("sport_program"),
      name: String(fd.get("name") || "").trim(),
      description: String(fd.get("description") || "").trim(),
      order: program?.order ?? programs.length + 1,
      active: true,
      createdAt: program?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    closeModal();
    await renderCurrentView();
  });
}

async function showExerciseModal(exerciseId = null, presetProgramId = null) {
  const [programs, exercises] = await Promise.all([
    getAll("sportPrograms"),
    getAll("sportExercises")
  ]);

  const activePrograms = sortPrograms(programs.filter(p => p.active !== false));
  const exercise = exercises.find(e => e.id === exerciseId);
  const programId = exercise?.programId || presetProgramId || activePrograms[0]?.id;

  if (!activePrograms.length) {
    alert("Crée d'abord un programme.");
    return;
  }

  openModal(`
    <div class="modal-head">
      <div>
        <p class="eyebrow">EXERCICE</p>
        <h2>${exercise ? "Modifier" : "Nouvel"} exercice</h2>
      </div>
      <button class="icon-btn" id="sport-exercise-close">×</button>
    </div>

    <form class="form-grid" id="sport-exercise-form">
      <div class="field">
        <label>Programme</label>
        <select name="programId">
          ${activePrograms.map(program => `
            <option value="${program.id}" ${program.id === programId ? "selected" : ""}>${escapeHtml(program.name)}</option>
          `).join("")}
        </select>
      </div>

      <div class="field">
        <label>Nom de l'exercice</label>
        <input name="name" required maxlength="100" value="${escapeHtml(exercise?.name || "")}" placeholder="Ex : Développé couché">
      </div>

      <div class="row">
        <div class="field">
          <label>Séries cibles</label>
          <input type="number" name="targetSets" min="1" max="20" step="1" value="${exercise?.targetSets ?? 3}">
        </div>

        <div class="field">
          <label>Reps cibles</label>
          <input type="number" name="targetReps" min="1" max="100" step="1" value="${exercise?.targetReps ?? 10}">
        </div>
      </div>

      <div class="field">
        <label>Charge de référence (kg)</label>
        <input type="number" name="startWeight" min="0" step="0.5" value="${exercise?.startWeight ?? ""}" placeholder="Ex : 60">
      </div>

      <div class="row">
        <div class="field">
          <label>Charge cible (kg)</label>
          <input type="number" name="targetWeight" min="0" step="0.5" value="${exercise?.targetWeight ?? (Number(exercise?.goalPercent || 0) > 0 && Number(exercise?.startWeight || 0) > 0 ? roundToStep(Number(exercise.startWeight) * (1 + Number(exercise.goalPercent) / 100), 0.5) : "")}" placeholder="Ex : 80">
        </div>

        <div class="field">
          <label>Échéance cible</label>
          <input type="date" name="goalDeadline" value="${exercise?.goalDeadline || addMonthsISO(exercise?.goalStartDate || todayISO(), exercise?.goalMonths || 6)}">
        </div>
      </div>

      <div class="field">
        <label>Début de l'objectif</label>
        <input type="date" name="goalStartDate" value="${exercise?.goalStartDate || todayISO()}">
        <small class="muted">MyHub affiche désormais la progression en kg : charge actuelle → charge cible.</small>
      </div>

      <div class="field">
        <label>Notes</label>
        <textarea name="notes" placeholder="Technique, machine, consignes...">${escapeHtml(exercise?.notes || "")}</textarea>
      </div>

      <div class="actions">
        <button type="button" class="ghost-btn" id="sport-exercise-cancel">Annuler</button>
        <button class="primary-btn" type="submit">Enregistrer</button>
      </div>
    </form>
  `);

  document.querySelector("#sport-exercise-close").addEventListener("click", closeModal);
  document.querySelector("#sport-exercise-cancel").addEventListener("click", closeModal);

  document.querySelector("#sport-exercise-form").addEventListener("submit", async event => {
    event.preventDefault();

    const fd = new FormData(event.target);

    await putOne("sportExercises", {
      ...(exercise || {}),
      id: exercise?.id || uid("sport_exercise"),
      programId: String(fd.get("programId")),
      name: String(fd.get("name") || "").trim(),
      targetSets: Math.max(1, Number(fd.get("targetSets") || 1)),
      targetReps: Math.max(1, Number(fd.get("targetReps") || 1)),
      startWeight: Number(fd.get("startWeight") || 0),
      targetWeight: Number(fd.get("targetWeight") || 0),
      goalDeadline: String(fd.get("goalDeadline") || ""),
      goalPercent: 0,
      goalMonths: 0,
      goalStartDate: String(fd.get("goalStartDate") || todayISO()),
      notes: String(fd.get("notes") || "").trim(),
      order: exercise?.order ?? exercises.length + 1,
      active: true,
      createdAt: exercise?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    closeModal();
    await renderCurrentView();
  });
}

async function renderHistory(shell) {
  const data = await getSportData();
  const sessions = completedSessions(data.sessions);

  shell.innerHTML = `
    ${tabs("history")}

    <section class="sport-section">
      <div class="sport-section-head">
        <div>
          <h2>Historique</h2>
          <p>${sessions.length} activité${sessions.length > 1 ? "s" : ""} enregistrée${sessions.length > 1 ? "s" : ""}</p>
        </div>
      </div>

      <div class="sport-list">
        ${
          sessions.length
            ? sessions.map(historyRow).join("")
            : `
              <div class="sport-empty">
                <h3>Aucun historique</h3>
                <p>Tes séances et activités libres apparaîtront ici.</p>
              </div>
            `
        }
      </div>
    </section>
  `;

  bindTabs(shell);
  bindHistoryRows(shell);
}

function e1rmLocal(weight, reps) {
  const w = Number(weight || 0);
  const r = Number(reps || 0);
  return w > 0 && r > 0 ? w * (1 + r / 30) : 0;
}

function newStrengthRecordsForSession(session, data) {
  if (!session || session.type !== "workout" || session.status !== "completed") return new Set();
  const currentSets = data.sets.filter(set => set.sessionId === session.id && Number(set.weight || 0) > 0 && Number(set.reps || 0) > 0);
  const previousSessionIds = new Set(data.sessions.filter(row => row.status === "completed" && row.id !== session.id).map(row => row.id));
  const names = [...new Set(currentSets.map(set => normalize(set.exerciseName || "")).filter(Boolean))];
  const records = new Set();

  for (const name of names) {
    const currentBest = Math.max(...currentSets.filter(set => normalize(set.exerciseName || "") === name).map(set => e1rmLocal(set.weight, set.reps)));
    const previous = data.sets.filter(set => previousSessionIds.has(set.sessionId) && normalize(set.exerciseName || "") === name && Number(set.weight || 0) > 0 && Number(set.reps || 0) > 0);
    const previousBest = previous.length ? Math.max(...previous.map(set => e1rmLocal(set.weight, set.reps))) : 0;
    if (currentBest > previousBest + 0.0001) records.add(name);
  }
  return records;
}

async function renderSessionDetail(shell, sessionId) {
  const data = await getSportData();
  const session = data.sessions.find(s => s.id === sessionId);

  if (!session) {
    currentView = "history";
    currentSessionId = null;
    await renderCurrentView();
    return;
  }

  const sets = data.sets
    .filter(s => s.sessionId === session.id)
    .sort((a,b) =>
      String(a.exerciseName || "").localeCompare(String(b.exerciseName || "")) ||
      Number(a.setNumber || 0) - Number(b.setNumber || 0)
    );

  const exerciseNames = [...new Set(sets.map(s => s.exerciseName).filter(Boolean))];
  const duration = sessionDuration(session);
  const volume = sets.reduce((sum, set) =>
    sum + Number(set.weight || 0) * Number(set.reps || 0), 0
  );
  const newRecords = newStrengthRecordsForSession(session, data);

  shell.innerHTML = `
    <button class="stock-back" id="sport-detail-back">‹ Historique</button>

    <div class="sport-workout-top">
      <span class="eyebrow" style="color:#c7ced8">${session.type === "workout" ? "SÉANCE" : "ACTIVITÉ LIBRE"}</span>
      <h2>${escapeHtml(sessionLabel(session))}</h2>
      <p>${formatDateLong(session.date)}${duration ? ` · ${duration} min` : ""}</p>
      ${session.type === "workout" ? `<button class="ghost-btn compact" id="sport-detail-correct-time">Corriger l'heure</button>` : ""}
    </div>

    ${
      session.type === "workout"
        ? `
          <section class="sport-detail-section">
            <h3>Détail de la séance</h3>

            ${
              exerciseNames.map(name => {
                const exerciseSets = sets.filter(s => s.exerciseName === name);
                const completed = exerciseSets.filter(s =>
                  Number(s.reps || 0) > 0 || Number(s.weight || 0) > 0
                );

                const snapshot = (session.workoutExercises || []).find(item => normalize(item.name || "") === normalize(name));
                return `
                  <div class="sport-detail-exercise">
                    <strong>${escapeHtml(name)}${newRecords.has(normalize(name)) ? ` <span class="sport-new-record">🏆 Nouveau record</span>` : ""}</strong>
                    <small>
                      ${
                        completed.length
                          ? completed.map(s =>
                              `S${s.setNumber}: ${roundWeight(s.weight || 0)} kg × ${s.reps || 0}${s.rpe !== null && s.rpe !== undefined ? ` · RPE ${s.rpe}` : ""}`
                            ).join("<br>")
                          : "Aucune série renseignée"
                      }
                    </small>
                    ${snapshot?.sessionNote ? `<div class="sport-detail-note"><b>Note</b><span>${escapeHtml(snapshot.sessionNote)}</span></div>` : ""}
                    ${snapshot?.pain ? `<div class="sport-detail-pain"><b>Douleur signalée</b><span>${escapeHtml(snapshot.painArea || "Zone non précisée")}${snapshot.painIntensity ? ` · ${Number(snapshot.painIntensity)}/10` : ""}${snapshot.painNote ? ` · ${escapeHtml(snapshot.painNote)}` : ""}</span></div>` : ""}
                  </div>
                `;
              }).join("")
            }
          </section>

          <section class="sport-detail-section">
            <h3>Résumé</h3>
            <div class="stock-detail-row"><span>Volume chargé</span><strong>${Math.round(volume).toLocaleString("fr-FR")} kg</strong></div>
            <div class="stock-detail-row"><span>Séries renseignées</span><strong>${sets.filter(s => Number(s.reps || 0) > 0).length}</strong></div>
          </section>
        `
        : `
          <section class="sport-detail-section">
            <h3>Informations</h3>
            <div class="stock-detail-row"><span>Durée</span><strong>${duration ? `${duration} min` : "Non renseignée"}</strong></div>
            ${
              Number(session.distanceKm || 0) > 0
                ? `<div class="stock-detail-row"><span>Distance</span><strong>${session.distanceUnit === "m" ? `${Math.round(session.distanceMeters)} m` : `${Number(session.distanceKm).toFixed(2)} km`}</strong></div>`
                : ""
            }
            ${
              duration > 0 && Number(session.distanceKm || 0) > 0
                ? `<div class="stock-detail-row"><span>Allure</span><strong>${minutesToPace(duration / Number(session.distanceKm))} min/km</strong></div>
                   <div class="stock-detail-row"><span>Vitesse moyenne</span><strong>${(Number(session.distanceKm) / (duration / 60)).toFixed(2)} km/h</strong></div>`
                : ""
            }
            ${
              duration > 0 && Number(session.distanceMeters || 0) > 0
                ? `<div class="stock-detail-row"><span>Allure /100 m</span><strong>${minutesToPace(duration / (Number(session.distanceMeters) / 100))}</strong></div>`
                : ""
            }
            ${
              session.notes
                ? `<div class="sport-detail-exercise"><strong>Notes</strong><small>${escapeHtml(session.notes)}</small></div>`
                : ""
            }
          </section>
        `
    }

    <button class="danger-btn" id="sport-delete-session" style="margin-top:12px;width:100%">Supprimer cette activité</button>
  `;

  shell.querySelector("#sport-detail-correct-time")?.addEventListener("click", () => showCorrectWorkoutTimeModal(session));

  shell.querySelector("#sport-detail-back").addEventListener("click", async () => {
    currentView = "history";
    currentSessionId = null;
    await renderCurrentView();
  });

  shell.querySelector("#sport-delete-session").addEventListener("click", async () => {
    if (!confirm(`Supprimer "${sessionLabel(session)}" du ${formatDate(session.date)} ?`)) return;

    for (const set of sets) await deleteOne("sportSets", set.id);
    await deleteOne("sportSessions", session.id);
    await removeSportTrackerSyncIfNeeded(session.date);

    window.dispatchEvent(new CustomEvent("myhub:data-changed"));

    currentView = "history";
    currentSessionId = null;
    await renderCurrentView();
  });
}

function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  return Math.max(0, (end - start) / 86400000);
}

async function renderRecords(shell) {
  const records = await getSportRecords();

  shell.innerHTML = `
    ${tabs("records")}

    <section class="sport-section">
      <div class="sport-section-head">
        <div>
          <h2>Records personnels</h2>
          <p>Calculés automatiquement à partir des activités et séries réellement enregistrées.</p>
        </div>
      </div>

      <div class="sport-record-groups">
        <article class="sport-record-group">
          <div class="sport-record-group-head"><span>🏃</span><div><strong>Course à pied</strong><small>Performances enregistrées proches des distances de référence.</small></div></div>
          <div class="sport-record-list">
            ${records.running.length ? records.running.map(record => `
              <div class="sport-record-row">
                <div><strong>${escapeHtml(record.distanceLabel)}</strong><small>${formatDate(record.date)}</small></div>
                <b>${escapeHtml(record.valueLabel)}</b>
              </div>
            `).join("") : `<div class="sport-empty compact"><p>Aucun record course disponible.</p></div>`}
          </div>
        </article>

        <article class="sport-record-group">
          <div class="sport-record-group-head"><span>🏊</span><div><strong>Natation</strong><small>100 m, 400 m, 1 000 m, 1 500 m, 2 000 m et 4 000 m.</small></div></div>
          <div class="sport-record-list">
            ${records.swimming.length ? records.swimming.map(record => `
              <div class="sport-record-row">
                <div><strong>${escapeHtml(record.distanceLabel)}</strong><small>${formatDate(record.date)}</small></div>
                <b>${escapeHtml(record.valueLabel)}</b>
              </div>
            `).join("") : `<div class="sport-empty compact"><p>Aucun record natation disponible.</p></div>`}
          </div>
        </article>

        <article class="sport-record-group">
          <div class="sport-record-group-head"><span>🏋️</span><div><strong>Musculation</strong><small>Meilleure charge et meilleure série estimée par exercice.</small></div></div>
          <div class="sport-record-list">
            ${records.strength.length ? records.strength.map(record => `
              <details class="sport-record-exercise">
                <summary class="sport-record-row strength">
                  <div><strong>${escapeHtml(record.name)}</strong><small>Record : ${formatDate(record.bestSetDate || record.maxWeightDate)}</small></div>
                  <b>${roundWeight(record.bestSetWeight)} kg × ${record.bestSetReps}</b>
                </summary>
                <div class="sport-record-exercise-detail">
                  <div><span>Charge max</span><strong>${roundWeight(record.maxWeight)} kg × ${record.maxWeightReps}</strong><small>${formatDate(record.maxWeightDate)}</small></div>
                  <div><span>Meilleure série</span><strong>${roundWeight(record.bestSetWeight)} kg × ${record.bestSetReps}</strong><small>${formatDate(record.bestSetDate)}</small></div>
                  ${record.history?.length ? `<div class="sport-record-history"><b>Historique des records</b>${[...record.history].reverse().map(item => `<span>${formatDate(item.date)} · ${roundWeight(item.weight)} kg × ${item.reps}</span>`).join("")}</div>` : ""}
                </div>
              </details>
            `).join("") : `<div class="sport-empty compact"><p>Aucun record musculation disponible.</p></div>`}
          </div>
        </article>

        ${records.otherSports?.length ? `
          <article class="sport-record-group">
            <div class="sport-record-group-head"><span>🏅</span><div><strong>Autres sports</strong><small>Repères calculés à partir de toutes tes activités libres reconnues.</small></div></div>
            <div class="sport-record-list">
              ${records.otherSports.map(record => `
                <details class="sport-record-exercise">
                  <summary class="sport-record-row strength">
                    <div>
                      <strong>${escapeHtml(record.icon)} ${escapeHtml(record.sport)}</strong>
                      <small>${record.sessions} séance${record.sessions > 1 ? "s" : ""} enregistrée${record.sessions > 1 ? "s" : ""}</small>
                    </div>
                    <b>${record.longestMinutes ? `${Math.round(record.longestMinutes)} min` : "—"}</b>
                  </summary>
                  <div class="sport-record-exercise-detail">
                    <div><span>Durée max</span><strong>${record.longestMinutes ? `${Math.round(record.longestMinutes)} min` : "—"}</strong><small>${record.longestDate ? formatDate(record.longestDate) : ""}</small></div>
                    ${record.farthestKm > 0 ? `<div><span>Distance max</span><strong>${roundWeight(record.farthestKm)} km</strong><small>${formatDate(record.farthestDate)}</small></div>` : ""}
                    <div><span>Volume total</span><strong>${Math.round(record.totalMinutes)} min</strong><small>${record.sessions} activité${record.sessions > 1 ? "s" : ""}</small></div>
                  </div>
                </details>
              `).join("")}
            </div>
          </article>
        ` : ""}
      </div>
    </section>
  `;

  bindTabs(shell);
}

async function renderProgress(shell) {
  const data = await getSportData();
  const completed = completedSessions(data.sessions);
  const completedIds = new Set(completed.map(s => s.id));

  const goalExercises = data.exercises.filter(exercise =>
    Number(exercise.startWeight || 0) > 0 &&
    Number(exercise.goalPercent || 0) > 0 &&
    Number(exercise.goalMonths || 0) > 0
  );

  const muscleCards = goalExercises.map(exercise => {
    const program = data.programs.find(p => p.id === exercise.programId);

    const exerciseSets = data.sets.filter(set =>
      set.exerciseId === exercise.id &&
      completedIds.has(set.sessionId) &&
      Number(set.weight || 0) > 0
    );

    const start = Number(exercise.startWeight || 0);
    const goalPercent = Number(exercise.goalPercent || 0);
    const months = Math.max(1, Number(exercise.goalMonths || 1));
    const target = start * (1 + goalPercent / 100);
    const best = exerciseSets.length
      ? Math.max(...exerciseSets.map(set => Number(set.weight || 0)))
      : start;

    const durationDays = months * 30.4375;
    const elapsedDays = daysBetween(exercise.goalStartDate || todayISO(), todayISO());
    const elapsedRatio = Math.max(0, Math.min(1, elapsedDays / durationDays));
    const expected = start + (target - start) * elapsedRatio;

    const gain = best - start;
    const goalGain = target - start;
    const progress = goalGain > 0
      ? Math.max(0, Math.min(100, Math.round((gain / goalGain) * 100)))
      : 0;

    const monthly = goalPercent / months;
    const ahead = best + 0.001 >= expected;

    return { exercise, program, start, target, best, expected, progress, monthly, ahead };
  });

  const goalCards = data.goals.map(goal => {
    const plan = data.trainingPlans.find(item => item.goalId === goal.id && item.active !== false);

    if (goal.goalType === "performance") {
      return {
        goal,
        plan,
        type: "performance",
        state: performanceGoalState(goal, data.sessions)
      };
    }

    if (goal.goalType === "strength") {
      return {
        goal,
        plan,
        type: "strength",
        state: strengthGoalState(goal, data.exercises, data.sets, data.sessions)
      };
    }

    if (goal.goalType === "strength_multi") {
      return {
        goal,
        plan,
        type: "strength_multi",
        state: strengthMultiGoalState(goal, data.strengthGoalExercises, data.exercises, data.sets, data.sessions)
      };
    }

    const current = goalCurrentValue(goal, data.sessions);
    const expected = linearExpectedValue(goal);
    return {
      goal,
      plan,
      type: "simple",
      current,
      expected,
      progress: goalProgressPercent(goal, current),
      onTrack: isGoalOnTrack(goal, current, expected)
    };
  });

  function advancedGoalCard(card) {
    const goal = card.goal;

    if (card.type === "performance") {
      const state = card.state;
      const targetDistance = goal.targetDistanceUnit === "m"
        ? `${Math.round(Number(goal.targetDistance || 0))} m`
        : `${Number(goal.targetDistance || 0).toLocaleString("fr-FR")} km`;

      const swim = isSwimmingSport(goal.sport);
      const targetPace = swim
        ? formatPerformancePace(Number(goal.targetTimeMinutes || 0) / Math.max(1, state.targetKm * 10), true)
        : formatPerformancePace(state.targetPaceKm, false);

      return `
        <article class="sport-performance-goal">
          <div class="sport-progress-head">
            <div>
              <span class="sport-plan-label">${swim ? "🏊 PERFORMANCE NATATION" : "🏃 PERFORMANCE COURSE"}</span>
              <h3>${escapeHtml(goal.name || goal.sport)}</h3>
              <p>${escapeHtml(goal.sport)} · ${targetDistance} en ${formatPerformanceTime(goal.targetTimeMinutes)} · cible ${targetPace}</p>
            </div>
            <div class="sport-goal-actions">
              <button class="icon-btn" data-edit-goal="${goal.id}" aria-label="Modifier">✎</button>
              <button class="icon-btn" data-delete-goal="${goal.id}" aria-label="Supprimer">×</button>
            </div>
          </div>

          <div class="sport-progress-bar" style="margin-top:12px"><i style="width:${state.progress}%"></i></div>

          <div class="sport-goal-metrics">
            <div class="sport-goal-metric">
              <span>Référence</span>
              <strong>${formatPerformanceTime(state.baselineTargetTime)}</strong>
            </div>
            <div class="sport-goal-metric">
              <span>Meilleure perf.</span>
              <strong>${formatPerformanceTime(state.currentTime)}</strong>
            </div>
            <div class="sport-goal-metric">
              <span>Cible</span>
              <strong>${formatPerformanceTime(state.targetTime)}</strong>
            </div>
          </div>

          <div class="sport-progress-status ${state.achieved || state.onTrack ? "ahead" : "behind"}" style="margin-top:10px">
            ${
              state.achieved
                ? "🏁 Objectif atteint"
                : state.onTrack
                  ? `✓ Dans le rythme · trajectoire actuelle ${formatPerformanceTime(state.expectedTime)}`
                  : `À rattraper · trajectoire actuelle ${formatPerformanceTime(state.expectedTime)}`
            }
            · échéance ${formatDate(goal.deadline)}
          </div>

          <div class="sport-goal-program-actions">
            ${
              card.plan
                ? `
                  <button class="ghost-btn" data-view-plan="${goal.id}">Voir le programme</button>
                  <button class="ghost-btn" data-adapt-goal="${goal.id}">↻ Adapter les séances futures</button>
                `
                : `<button class="primary-btn" data-generate-goal-plan="${goal.id}">Générer le programme</button>`
            }
          </div>
        </article>
      `;
    }

    if (card.type === "strength_multi") {
      const state = card.state;
      return `
        <article class="sport-performance-goal">
          <div class="sport-progress-head">
            <div>
              <span class="sport-plan-label">🏋️ PROGRAMME MULTI-EXERCICES</span>
              <h3>${escapeHtml(goal.name || "Objectif musculation")}</h3>
              <p>${state.rows.length} exercice${state.rows.length > 1 ? "s" : ""} · ${goal.trainingDays?.length || goal.sessionsPerWeek || 0} séance${(goal.trainingDays?.length || goal.sessionsPerWeek || 0) > 1 ? "s" : ""}/semaine</p>
            </div>
            <div class="sport-goal-actions">
              <button class="icon-btn" data-edit-goal="${goal.id}" aria-label="Modifier">✎</button>
              <button class="icon-btn" data-delete-goal="${goal.id}" aria-label="Supprimer">×</button>
            </div>
          </div>
          <div class="sport-progress-bar" style="margin-top:12px"><i style="width:${state.progress}%"></i></div>
          <div class="sport-multi-progress-list">
            ${state.rows.map(row => {
              const best = row.state.bestSet ? `${roundWeight(row.state.bestSet.weight)} kg × ${Math.round(Number(row.state.bestSet.reps || 0))}` : `${roundWeight(row.definition.baselineWeight)} kg × ${row.definition.baselineReps}`;
              const currentWeight = row.state.bestSet ? Number(row.state.bestSet.weight || 0) : Number(row.definition.baselineWeight || 0);
              const remaining = Math.max(0, Number(row.definition.targetWeight || 0) - currentWeight);
              return `<div class="sport-multi-progress-row"><div><strong>${escapeHtml(row.definition.exerciseName)}</strong><small>${best} → cible ${roundWeight(row.definition.targetWeight)} kg × ${row.definition.targetReps}</small></div><b>${remaining > 0 ? `${roundWeight(remaining)} kg à gagner` : "Cible atteinte"}</b></div>`;
            }).join("")}
          </div>
          <div class="sport-progress-status ${state.achieved || state.onTrack ? "ahead" : "behind"}" style="margin-top:10px">
            ${state.achieved ? "🏁 Tous les objectifs atteints" : state.onTrack ? "✓ Progression globale dans le rythme" : "Certains exercices sont à rattraper"} · échéance ${formatDate(goal.deadline)}
          </div>
          <div class="sport-goal-program-actions">
            ${card.plan ? `<button class="ghost-btn" data-view-plan="${goal.id}">Voir le programme</button><button class="ghost-btn" data-adapt-goal="${goal.id}">↻ Adapter les séances futures</button>` : `<button class="primary-btn" data-generate-goal-plan="${goal.id}">Générer le programme</button>`}
          </div>
        </article>`;
    }

    if (card.type === "strength") {
      const state = card.state;
      const best = state.bestSet
        ? `${roundWeight(state.bestSet.weight)} kg × ${Math.round(Number(state.bestSet.reps || 0))}`
        : `${roundWeight(goal.baselineWeight)} kg × ${Math.round(Number(goal.baselineReps || 1))}`;

      return `
        <article class="sport-performance-goal">
          <div class="sport-progress-head">
            <div>
              <span class="sport-plan-label">🏋️ OBJECTIF FORCE</span>
              <h3>${escapeHtml(goal.name || goal.exerciseName)}</h3>
              <p>${escapeHtml(goal.exerciseName)} · cible ${roundWeight(goal.targetWeight)} kg × ${Math.round(Number(goal.targetReps || 1))}</p>
            </div>
            <div class="sport-goal-actions">
              <button class="icon-btn" data-edit-goal="${goal.id}" aria-label="Modifier">✎</button>
              <button class="icon-btn" data-delete-goal="${goal.id}" aria-label="Supprimer">×</button>
            </div>
          </div>

          <div class="sport-strength-target-line">
            <strong>${state.bestSet ? roundWeight(state.bestSet.weight) : roundWeight(goal.baselineWeight)} kg</strong>
            <span>→</span>
            <strong>${roundWeight(goal.targetWeight)} kg</strong>
            <small>${Math.max(0, Number(goal.targetWeight || 0) - Number(state.bestSet?.weight || goal.baselineWeight || 0)) > 0 ? `${roundWeight(Math.max(0, Number(goal.targetWeight || 0) - Number(state.bestSet?.weight || goal.baselineWeight || 0)))} kg à gagner` : "Cible atteinte"}</small>
          </div>
          <div class="sport-progress-bar sport-progress-secondary"><i style="width:${state.progress}%"></i></div>

          <div class="sport-goal-metrics">
            <div class="sport-goal-metric">
              <span>Référence</span>
              <strong>${roundWeight(goal.baselineWeight)} kg × ${Math.round(Number(goal.baselineReps || 1))}</strong>
            </div>
            <div class="sport-goal-metric">
              <span>Meilleure série</span>
              <strong>${best}</strong>
            </div>
            <div class="sport-goal-metric">
              <span>Cible</span>
              <strong>${roundWeight(goal.targetWeight)} kg × ${Math.round(Number(goal.targetReps || 1))}</strong>
            </div>
          </div>

          <div class="sport-progress-status ${state.achieved || state.onTrack ? "ahead" : "behind"}" style="margin-top:10px">
            ${state.achieved ? "🏁 Objectif atteint" : state.onTrack ? "✓ Dans le rythme ou en avance" : "À rattraper par rapport à la trajectoire"}
            · échéance ${formatDate(goal.deadline)}
          </div>

          <div class="sport-goal-program-actions">
            ${
              card.plan
                ? `
                  <button class="ghost-btn" data-view-plan="${goal.id}">Voir le programme</button>
                  <button class="ghost-btn" data-adapt-goal="${goal.id}">↻ Adapter les séances futures</button>
                `
                : `<button class="primary-btn" data-generate-goal-plan="${goal.id}">Générer le programme</button>`
            }
          </div>
        </article>
      `;
    }

    return `
      <article class="sport-goal-card">
        <div class="sport-progress-head">
          <div>
            <span class="sport-plan-label">OBJECTIF SIMPLE</span>
            <h3>${escapeHtml(goal.name || goal.sport)}</h3>
            <p>${escapeHtml(goal.sport)} · ${SPORT_METRICS[goal.metric]?.label || goal.metric}</p>
          </div>
          <div class="sport-goal-actions">
            <button class="icon-btn" data-edit-goal="${goal.id}" aria-label="Modifier">✎</button>
            <button class="icon-btn" data-delete-goal="${goal.id}" aria-label="Supprimer">×</button>
          </div>
        </div>

        <div class="sport-progress-bar" style="margin-top:12px"><i style="width:${card.progress}%"></i></div>

        <div class="sport-goal-metrics">
          <div class="sport-goal-metric"><span>Départ</span><strong>${metricDisplay(goal.metric, Number(goal.baseline || 0))}</strong></div>
          <div class="sport-goal-metric"><span>Actuel</span><strong>${metricDisplay(goal.metric, card.current)}</strong></div>
          <div class="sport-goal-metric"><span>Cible</span><strong>${metricDisplay(goal.metric, Number(goal.target || 0))}</strong></div>
        </div>

        <div class="sport-progress-status ${card.onTrack ? "ahead" : "behind"}" style="margin-top:10px">
          ${card.onTrack ? "✓ Dans le rythme ou en avance" : "À rattraper"} · jalon actuel ${metricDisplay(goal.metric, card.expected)} · échéance ${formatDate(goal.deadline)}
        </div>
      </article>
    `;
  }

  shell.innerHTML = `
    ${tabs("progress")}

    <section class="sport-section">
      <div class="sport-goal-toolbar">
        <div>
          <h2>Objectifs Sport</h2>
          <p class="muted" style="margin:4px 0 0">Performance distance + temps, force charge + répétitions, ou objectifs simples.</p>
        </div>
        <button class="primary-btn" id="sport-add-goal">+ Objectif</button>
      </div>

      <div class="sport-list">
        ${
          goalCards.length
            ? goalCards.map(advancedGoalCard).join("")
            : `
              <div class="sport-empty">
                <h3>Aucun objectif Sport</h3>
                <p>Crée par exemple 10 km en 45 min, 4 000 m en 1 h 30, ou 80 kg × 8 au développé couché.</p>
              </div>
            `
        }
      </div>
    </section>

    <section class="sport-section">
      <div class="sport-section-head">
        <div>
          <h2>Anciens objectifs musculation par exercice</h2>
          <p>Compatibilité conservée avec les objectifs +% déjà configurés dans tes programmes.</p>
        </div>
      </div>

      <div class="sport-list">
        ${
          muscleCards.length
            ? muscleCards.map(card => `
              <article class="sport-progress-card">
                <div class="sport-progress-head">
                  <div>
                    <strong>${escapeHtml(card.exercise.name)}</strong>
                    <small>${escapeHtml(card.program?.name || "Programme")} · objectif +${card.exercise.goalPercent}% en ${card.exercise.goalMonths} mois</small>
                  </div>
                  <div class="sport-progress-value">${roundWeight(card.best)} kg</div>
                </div>

                <div class="sport-progress-bar">
                  <i style="width:${card.progress}%"></i>
                </div>

                <div class="sport-progress-grid">
                  <div class="sport-progress-stat"><span>Départ</span><strong>${roundWeight(card.start)} kg</strong></div>
                  <div class="sport-progress-stat"><span>Jalon actuel</span><strong>${roundWeight(card.expected)} kg</strong></div>
                  <div class="sport-progress-stat"><span>Cible finale</span><strong>${roundWeight(card.target)} kg</strong></div>
                </div>

                <div class="sport-progress-status ${card.ahead ? "ahead" : "behind"}">
                  ${card.ahead ? "✓ Dans le rythme ou en avance" : "À rattraper par rapport au jalon"} · environ +${card.monthly.toFixed(1)} % / mois
                </div>
              </article>
            `).join("")
            : `
              <div class="sport-empty">
                <h3>Aucun ancien objectif +%</h3>
                <p>Tu peux maintenant privilégier le nouveau type « Musculation : charge + répétitions ».</p>
              </div>
            `
        }
      </div>
    </section>
  `;

  bindTabs(shell);

  shell.querySelector("#sport-add-goal").addEventListener("click", () => showSportGoalModal());

  shell.querySelectorAll("[data-edit-goal]").forEach(btn => {
    btn.addEventListener("click", () => showSportGoalModal(btn.dataset.editGoal));
  });

  shell.querySelectorAll("[data-delete-goal]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const goal = data.goals.find(g => g.id === btn.dataset.deleteGoal);
      if (!goal) return;
      if (!confirm(`Supprimer l'objectif "${goal.name || goal.sport || goal.exerciseName}" et son programme généré ?`)) return;
      await deleteSportPlan(goal.id);
      for (const definition of data.strengthGoalExercises.filter(item => item.goalId === goal.id)) {
        await deleteOne("sportStrengthGoalExercises", definition.id);
      }
      await deleteOne("sportGoals", goal.id);
      window.dispatchEvent(new CustomEvent("myhub:data-changed"));
      await renderProgress(shell);
    });
  });

  shell.querySelectorAll("[data-generate-goal-plan]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const goal = data.goals.find(item => item.id === btn.dataset.generateGoalPlan);
      if (!goal) return;
      await generateSportPlan(goal);
      window.dispatchEvent(new CustomEvent("myhub:data-changed"));
      currentView = "programs";
      await renderCurrentView();
    });
  });

  shell.querySelectorAll("[data-adapt-goal]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const goal = data.goals.find(item => item.id === btn.dataset.adaptGoal);
      if (!goal) return;
      if (!confirm("Recalculer les séances futures à partir de ton niveau réellement enregistré aujourd'hui ? Les séances passées sont conservées.")) return;
      await adaptSportPlan(goal);
      window.dispatchEvent(new CustomEvent("myhub:data-changed"));
      await renderProgress(shell);
    });
  });

  shell.querySelectorAll("[data-view-plan]").forEach(btn => {
    btn.addEventListener("click", async () => {
      currentView = "programs";
      await renderCurrentView();
    });
  });
}

async function showSportGoalModal(goalId = null) {
  const [goals, allDefinitions] = await Promise.all([
    getAll("sportGoals"),
    getAll("sportStrengthGoalExercises")
  ]);
  const goal = goals.find(g => g.id === goalId);
  const goalType = goal?.goalType || "performance";
  const definitions = allDefinitions
    .filter(item => item.goalId === goalId && item.active !== false)
    .sort((a,b) => Number(a.order || 0) - Number(b.order || 0));

  const defaultDeadline = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 6);
    const offset = d.getTimezoneOffset();
    return new Date(d.getTime() - offset * 60000).toISOString().slice(0,10);
  })();

  const dayNames = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
  const defaultDays = goal?.trainingDays?.length
    ? goal.trainingDays.map(Number)
    : goalType === "performance"
      ? [1]
      : [3,0];

  const strengthRow = (row = {}, index = 0) => `
    <div class="sport-multi-exercise-row" data-strength-row="${index}">
      <div class="field grow">
        <label>Exercice</label>
        <input name="multiExerciseName" value="${escapeHtml(row.exerciseName || "")}" placeholder="Ex : Développé couché">
      </div>
      <div class="sport-multi-values">
        <div><span>Départ kg</span><input type="number" name="multiBaselineWeight" min="0" step="0.5" value="${row.baselineWeight ?? ""}"></div>
        <div><span>Reps</span><input type="number" name="multiBaselineReps" min="1" step="1" value="${row.baselineReps ?? 8}"></div>
        <div><span>Cible kg</span><input type="number" name="multiTargetWeight" min="0" step="0.5" value="${row.targetWeight ?? ""}"></div>
        <div><span>Reps</span><input type="number" name="multiTargetReps" min="1" step="1" value="${row.targetReps ?? 8}"></div>
      </div>
      <button type="button" class="icon-btn sport-remove-strength-row" aria-label="Supprimer">×</button>
    </div>
  `;

  openModal(`
    <div class="modal-head">
      <div><p class="eyebrow">OBJECTIF SPORT</p><h2>${goal ? "Modifier" : "Nouvel"} objectif</h2></div>
      <button class="icon-btn" id="sport-goal-close">×</button>
    </div>

    <form class="form-grid" id="sport-goal-form">
      <div class="field">
        <label>Type d'objectif</label>
        <select name="goalType" id="sport-goal-type">
          <option value="performance" ${goalType === "performance" ? "selected" : ""}>🏁 Performance — distance + temps</option>
          <option value="strength_multi" ${goalType === "strength_multi" ? "selected" : ""}>🏋️ Musculation — programme multi-exercices</option>
          <option value="strength" ${goalType === "strength" ? "selected" : ""}>🏋️ Musculation — exercice unique</option>
          <option value="simple" ${goalType === "simple" ? "selected" : ""}>📈 Objectif simple — une mesure</option>
        </select>
      </div>

      <div class="field"><label>Nom de l'objectif</label><input name="name" maxlength="100" value="${escapeHtml(goal?.name || "")}" placeholder="Ex : 10 km en 45 min / Full Body 6 mois"></div>

      <div id="sport-performance-fields">
        <div class="field"><label>Sport</label><select name="sportId">${sportSelectOptions(goal?.sportId || goal?.sport || "running", { includeOther: false })}</select><small class="muted">Même identité utilisée dans les activités, records et programmes.</small></div>
        <div class="sport-goal-form-block"><strong>Niveau actuel</strong>
          <div class="sport-activity-metrics" style="margin-top:10px"><div class="field"><label>Distance</label><input type="number" name="baselineDistance" min="0" step="0.01" value="${goal?.baselineDistance ?? ""}"></div><div class="field"><label>Unité</label><select name="baselineDistanceUnit"><option value="km" ${(goal?.baselineDistanceUnit || "km") === "km" ? "selected" : ""}>km</option><option value="m" ${goal?.baselineDistanceUnit === "m" ? "selected" : ""}>m</option></select></div></div>
          <div class="field"><label>Temps actuel (min)</label><input type="number" name="baselineTimeMinutes" min="0.1" step="0.01" value="${goal?.baselineTimeMinutes ?? ""}"></div>
        </div>
        <div class="sport-goal-form-block"><strong>Performance cible</strong>
          <div class="sport-activity-metrics" style="margin-top:10px"><div class="field"><label>Distance cible</label><input type="number" name="targetDistance" min="0" step="0.01" value="${goal?.targetDistance ?? ""}"></div><div class="field"><label>Unité</label><select name="targetDistanceUnit"><option value="km" ${(goal?.targetDistanceUnit || "km") === "km" ? "selected" : ""}>km</option><option value="m" ${goal?.targetDistanceUnit === "m" ? "selected" : ""}>m</option></select></div></div>
          <div class="field"><label>Temps cible (min)</label><input type="number" name="targetTimeMinutes" min="0.1" step="0.01" value="${goal?.targetTimeMinutes ?? ""}"></div>
        </div>
      </div>

      <div id="sport-strength-multi-fields">
        <div class="sport-goal-form-block">
          <div class="sport-section-head" style="margin-bottom:10px"><div><strong>Exercices du programme</strong><p>Chaque exercice possède son niveau actuel et sa cible.</p></div><button type="button" class="ghost-btn" id="sport-add-strength-row">+ Exercice</button></div>
          <div id="sport-strength-rows">${(definitions.length ? definitions : [{}]).map(strengthRow).join("")}</div>
        </div>
      </div>

      <div id="sport-strength-fields">
        <div class="field"><label>Exercice</label><input name="exerciseName" maxlength="100" value="${escapeHtml(goal?.exerciseName || "")}" placeholder="Ex : Développé couché"></div>
        <div class="row"><div class="field"><label>Départ kg</label><input type="number" name="baselineWeight" min="0" step="0.5" value="${goal?.baselineWeight ?? ""}"></div><div class="field"><label>Reps départ</label><input type="number" name="baselineReps" min="1" step="1" value="${goal?.baselineReps ?? 8}"></div></div>
        <div class="row"><div class="field"><label>Cible kg</label><input type="number" name="targetWeight" min="0" step="0.5" value="${goal?.targetWeight ?? ""}"></div><div class="field"><label>Reps cibles</label><input type="number" name="targetReps" min="1" step="1" value="${goal?.targetReps ?? 8}"></div></div>
      </div>

      <div id="sport-simple-fields">
        <div class="field"><label>Sport</label><select name="simpleSportId">${sportSelectOptions(goalType === "simple" ? (goal?.sportId || goal?.sport || "running") : "running")}</select></div>
        <div class="field"><label>Mesure</label><select name="metric">${Object.entries(SPORT_METRICS).map(([key, meta]) => `<option value="${key}" ${goal?.metric === key ? "selected" : ""}>${meta.label} (${meta.unit})</option>`).join("")}</select></div>
        <div class="row"><div class="field"><label>Départ</label><input type="number" name="baseline" step="0.01" value="${goal?.baseline ?? ""}"></div><div class="field"><label>Cible</label><input type="number" name="target" step="0.01" value="${goal?.target ?? ""}"></div></div>
      </div>

      <div id="sport-program-fields">
        <div class="field">
          <label>Jours d'entraînement</label>
          <div class="sport-day-picker">${dayNames.map((name, day) => `<label class="sport-day-option"><input type="checkbox" name="trainingDay" value="${day}" ${defaultDays.includes(day) ? "checked" : ""}><span>${name}</span></label>`).join("")}</div>
          <small class="muted">Tu peux modifier ces jours plus tard : seules les séances futures seront recalculées.</small>
        </div>
        <div class="row">
          <div class="field"><label>Semaine légère</label><select name="recoveryEveryWeeks">${[4,5,6].map(n => `<option value="${n}" ${Number(goal?.recoveryEveryWeeks || 5) === n ? "selected" : ""}>Toutes les ${n} semaines</option>`).join("")}</select></div>
          <div class="field" id="sport-test-frequency-field"><label>Test intermédiaire</label><select name="testEveryWeeks">${[4,5,6,8].map(n => `<option value="${n}" ${Number(goal?.testEveryWeeks || 6) === n ? "selected" : ""}>Toutes les ${n} semaines</option>`).join("")}</select></div>
        </div>
      </div>

      <div class="row"><div class="field"><label>Date de départ</label><input type="date" name="startDate" value="${goal?.startDate || todayISO()}" required></div><div class="field"><label>Échéance</label><input type="date" name="deadline" value="${goal?.deadline || defaultDeadline}" required></div></div>
      <div class="field"><label>Notes</label><textarea name="notes">${escapeHtml(goal?.notes || "")}</textarea></div>

      <label class="sport-plan-checkbox" id="sport-generate-plan-wrap"><input type="checkbox" name="generateProgram" ${goalType !== "simple" ? "checked" : ""}><span><strong>Générer / mettre à jour le programme</strong><small>Phases, semaines légères, tests intermédiaires et tâches Planning sont générés automatiquement.</small></span></label>
      <div class="sport-sync" id="sport-goal-mode-note"></div>
      <div class="actions"><button type="button" class="ghost-btn" id="sport-goal-cancel">Annuler</button><button class="primary-btn" type="submit">Enregistrer</button></div>
    </form>
  `);

  const typeSelect = document.querySelector("#sport-goal-type");
  const performanceFields = document.querySelector("#sport-performance-fields");
  const strengthMultiFields = document.querySelector("#sport-strength-multi-fields");
  const strengthFields = document.querySelector("#sport-strength-fields");
  const simpleFields = document.querySelector("#sport-simple-fields");
  const programFields = document.querySelector("#sport-program-fields");
  const testField = document.querySelector("#sport-test-frequency-field");
  const generateWrap = document.querySelector("#sport-generate-plan-wrap");
  const note = document.querySelector("#sport-goal-mode-note");
  const rowsRoot = document.querySelector("#sport-strength-rows");

  function bindRemoveRows() {
    rowsRoot.querySelectorAll(".sport-remove-strength-row").forEach(btn => btn.onclick = () => {
      if (rowsRoot.querySelectorAll("[data-strength-row]").length <= 1) return;
      btn.closest("[data-strength-row]").remove();
    });
  }
  bindRemoveRows();
  document.querySelector("#sport-add-strength-row").addEventListener("click", () => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = strengthRow({}, rowsRoot.children.length);
    rowsRoot.appendChild(wrapper.firstElementChild);
    bindRemoveRows();
  });

  function updateGoalMode() {
    const value = typeSelect.value;
    performanceFields.style.display = value === "performance" ? "block" : "none";
    strengthMultiFields.style.display = value === "strength_multi" ? "block" : "none";
    strengthFields.style.display = value === "strength" ? "block" : "none";
    simpleFields.style.display = value === "simple" ? "block" : "none";
    programFields.style.display = value === "simple" ? "none" : "block";
    generateWrap.style.display = value === "simple" ? "none" : "flex";
    testField.style.display = value === "performance" ? "block" : "none";
    note.textContent = value === "performance"
      ? "Distance + temps sont suivis ensemble. Les tests intermédiaires servent à comparer la trajectoire réelle au programme."
      : value === "strength_multi"
        ? "Une seule séance regroupe plusieurs exercices. La progression globale est la moyenne des exercices."
        : value === "strength"
          ? "Mode mono-exercice conservé pour un objectif très ciblé."
          : "Mode simple historique sans programme automatique.";
  }
  updateGoalMode();
  typeSelect.addEventListener("change", updateGoalMode);

  document.querySelector("#sport-goal-close").addEventListener("click", closeModal);
  document.querySelector("#sport-goal-cancel").addEventListener("click", closeModal);

  document.querySelector("#sport-goal-form").addEventListener("submit", async event => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const type = String(fd.get("goalType") || "simple");
    const startDate = String(fd.get("startDate") || todayISO());
    const deadline = String(fd.get("deadline") || todayISO());
    if (deadline <= startDate) return alert("L'échéance doit être postérieure à la date de départ.");

    const trainingDays = fd.getAll("trainingDay").map(Number);
    if (type !== "simple" && !trainingDays.length) return alert("Choisis au moins un jour d'entraînement.");

    const saved = {
      ...(goal || {}),
      id: goal?.id || uid("sport_goal"),
      goalType: type,
      name: String(fd.get("name") || "").trim(),
      startDate,
      deadline,
      trainingDays,
      sessionsPerWeek: trainingDays.length,
      recoveryEveryWeeks: Math.max(4, Number(fd.get("recoveryEveryWeeks") || 5)),
      testEveryWeeks: Math.max(4, Number(fd.get("testEveryWeeks") || 6)),
      notes: String(fd.get("notes") || "").trim(),
      active: true,
      createdAt: goal?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (type === "performance") {
      saved.sportId = canonicalSportId(fd.get("sportId") || "running");
      saved.sport = sportLabel(saved.sportId);
      saved.baselineDistance = Number(fd.get("baselineDistance") || 0);
      saved.baselineDistanceUnit = String(fd.get("baselineDistanceUnit") || "km");
      saved.baselineTimeMinutes = Number(fd.get("baselineTimeMinutes") || 0);
      saved.targetDistance = Number(fd.get("targetDistance") || 0);
      saved.targetDistanceUnit = String(fd.get("targetDistanceUnit") || "km");
      saved.targetTimeMinutes = Number(fd.get("targetTimeMinutes") || 0);
      if (!saved.sport || saved.baselineDistance <= 0 || saved.baselineTimeMinutes <= 0 || saved.targetDistance <= 0 || saved.targetTimeMinutes <= 0) return alert("Renseigne le sport, les distances et les temps de départ et cible.");
    } else if (type === "strength_multi") {
      saved.sportId = "strength";
      saved.sport = sportLabel("strength");
      const rowElements = [...rowsRoot.querySelectorAll("[data-strength-row]")];
      const definitionsToSave = rowElements.map((row, index) => ({
        id: definitions[index]?.id || uid("sport_strength_goal_exercise"),
        goalId: saved.id,
        exerciseName: String(row.querySelector('[name="multiExerciseName"]').value || "").trim(),
        baselineWeight: Number(row.querySelector('[name="multiBaselineWeight"]').value || 0),
        baselineReps: Math.max(1, Number(row.querySelector('[name="multiBaselineReps"]').value || 1)),
        targetWeight: Number(row.querySelector('[name="multiTargetWeight"]').value || 0),
        targetReps: Math.max(1, Number(row.querySelector('[name="multiTargetReps"]').value || 1)),
        order: index,
        active: true,
        createdAt: definitions[index]?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })).filter(row => row.exerciseName && row.baselineWeight > 0 && row.targetWeight > 0);
      if (!definitionsToSave.length) return alert("Ajoute au moins un exercice complet avec charge de départ et charge cible.");
      for (const old of definitions) if (!definitionsToSave.some(row => row.id === old.id)) await deleteOne("sportStrengthGoalExercises", old.id);
      for (const row of definitionsToSave) await putOne("sportStrengthGoalExercises", row);
    } else if (type === "strength") {
      saved.sportId = "strength";
      saved.sport = sportLabel("strength");
      saved.exerciseName = String(fd.get("exerciseName") || "").trim();
      saved.baselineWeight = Number(fd.get("baselineWeight") || 0);
      saved.baselineReps = Math.max(1, Number(fd.get("baselineReps") || 1));
      saved.targetWeight = Number(fd.get("targetWeight") || 0);
      saved.targetReps = Math.max(1, Number(fd.get("targetReps") || 1));
      if (!saved.exerciseName || saved.baselineWeight <= 0 || saved.targetWeight <= 0) return alert("Renseigne l'exercice et les charges de départ et cible.");
    } else {
      saved.sportId = canonicalSportId(fd.get("simpleSportId") || "other");
      saved.sport = sportLabel(saved.sportId);
      saved.metric = String(fd.get("metric") || "distance_km");
      saved.baseline = Number(fd.get("baseline"));
      saved.target = Number(fd.get("target"));
      if (!saved.sport || !Number.isFinite(saved.baseline) || !Number.isFinite(saved.target)) return alert("Indique le sport et des valeurs valides.");
    }

    await putOne("sportGoals", saved);

    if (type === "simple" && goal && ["performance","strength","strength_multi"].includes(goal.goalType)) await deleteSportPlan(saved.id);
    if (["performance","strength","strength_multi"].includes(type) && fd.get("generateProgram") === "on") {
      await generateSportPlan(saved, { replaceFuture: Boolean(goal), fromDate: startDate < todayISO() ? todayISO() : startDate });
    }

    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrentView();
  });
}

export async function getSportSummary() {
  await syncSportPlanTasks();
  const data = await getSportData();
  const sessions = completedSessions(data.sessions);
  const today = todayISO();
  const monday = mondayOf(today);

  const week = sessions.filter(s => s.date >= monday && s.date <= today);
  const latest = sessions[0] || null;
  const futurePlan = data.planSessions
    .filter(session => !session.completed && !session.skipped && session.date >= today)
    .sort((a,b) => String(a.date).localeCompare(String(b.date)));

  return {
    countWeek: week.length,
    structuredWeek: week.filter(s => s.type === "workout").length,
    freeWeek: week.filter(s => s.type === "activity").length,
    latestLabel: latest ? sessionLabel(latest) : null,
    latestDate: latest?.date || null,
    activeGoals: data.goals.length,
    nextPlannedLabel: futurePlan[0]?.title || null,
    nextPlannedDate: futurePlan[0]?.date || null
  };
}
