import {
  getAll,
  getOne,
  putOne,
  deleteOne
} from "./db.js";

import {
  uid,
  todayISO
} from "./ui.js";

function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function localDate(dateString) {
  return new Date(`${dateString}T12:00:00`);
}

function iso(date) {
  const d = new Date(date);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0,10);
}

function addDays(dateString, days) {
  const d = localDate(dateString);
  d.setDate(d.getDate() + Number(days || 0));
  return iso(d);
}

function diffDays(a, b) {
  return Math.round((localDate(b) - localDate(a)) / 86400000);
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function distanceToKm(value, unit) {
  const n = Number(value || 0);
  return unit === "m" ? n / 1000 : n;
}

function distanceToMeters(value, unit) {
  const n = Number(value || 0);
  return unit === "m" ? n : n * 1000;
}

function minutesToClock(minutes) {
  const totalSeconds = Math.max(0, Math.round(Number(minutes || 0) * 60));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  }

  return `${m}:${String(s).padStart(2,"0")}`;
}

function paceLabel(minutes, swim = false) {
  return `${minutesToClock(minutes)}${swim ? "/100 m" : "/km"}`;
}

function isSwimSport(sport) {
  const value = normalize(sport);
  return value.includes("natation") || value.includes("nage") || value.includes("swim");
}

function sportIcon(sport, goalType = "performance") {
  if (["strength","strength_multi"].includes(goalType)) return "🏋️";
  return isSwimSport(sport) ? "🏊" : "🏃";
}

function sportMatches(session, sportName) {
  const a = normalize(session.activityType || session.programName || "");
  const b = normalize(sportName || "");
  return a && b && (a.includes(b) || b.includes(a));
}

function phaseForRatio(ratio) {
  if (ratio < 0.30) return "base";
  if (ratio < 0.60) return "development";
  if (ratio < 0.88) return "specific";
  return "taper";
}

function phaseLabel(phase) {
  if (phase === "base") return "Base";
  if (phase === "development") return "Développement";
  if (phase === "specific") return "Spécifique";
  if (phase === "taper") return "Affûtage";
  return "Objectif";
}

function weekdaysForCount(count) {
  const n = Math.max(1, Math.min(5, Number(count || 3)));
  if (n === 1) return [1];
  if (n === 2) return [3, 0];
  if (n === 3) return [1, 4, 0];
  if (n === 4) return [1, 3, 5, 0];
  return [1, 2, 4, 5, 0];
}

function trainingDaysForGoal(goal) {
  const explicit = Array.isArray(goal?.trainingDays)
    ? [...new Set(goal.trainingDays.map(Number).filter(day => day >= 0 && day <= 6))]
    : [];
  return explicit.length ? explicit : weekdaysForCount(goal?.sessionsPerWeek || 3);
}

function roleSequence(count, goalType) {
  const n = Math.max(1, Math.min(5, Number(count || 3)));

  if (["strength", "strength_multi"].includes(goalType)) {
    if (n === 1) return ["heavy"];
    if (n === 2) return ["volume", "heavy"];
    if (n === 3) return ["technique", "volume", "heavy"];
    if (n === 4) return ["technique", "volume", "heavy", "volume"];
    return ["technique", "volume", "heavy", "technique", "volume"];
  }

  if (n === 1) return ["quality"];
  if (n === 2) return ["quality", "long"];
  if (n === 3) return ["easy", "quality", "long"];
  if (n === 4) return ["easy", "quality", "easy", "long"];
  return ["easy", "quality", "recovery", "tempo", "long"];
}

function scheduleDates(startDate, deadline, goal) {
  const allowed = trainingDaysForGoal(goal);
  const rows = [];

  for (let cursor = startDate; cursor <= deadline; cursor = addDays(cursor, 1)) {
    const dow = localDate(cursor).getDay();
    if (allowed.includes(dow)) rows.push(cursor);
  }

  if (!rows.includes(deadline)) rows.push(deadline);
  return [...new Set(rows)].sort();
}

function durationWeeks(startDate, deadline) {
  return Math.max(1, Math.ceil(Math.max(1, diffDays(startDate, deadline) + 1) / 7));
}

function nearestHalf(value) {
  return Math.round(Number(value || 0) * 2) / 2;
}

function enduranceSession(goal, date, index, totalDates, slotIndex) {
  const targetKm = distanceToKm(goal.targetDistance, goal.targetDistanceUnit);
  const targetMeters = distanceToMeters(goal.targetDistance, goal.targetDistanceUnit);
  const baselineKm = distanceToKm(goal.baselineDistance || goal.targetDistance, goal.baselineDistanceUnit || goal.targetDistanceUnit);
  const baselineTime = Number(goal.baselineTimeMinutes || 0);
  const targetTime = Number(goal.targetTimeMinutes || 0);

  const baselinePaceKm = baselineKm > 0 ? baselineTime / baselineKm : targetTime / Math.max(targetKm, 1);
  const targetPaceKm = targetKm > 0 ? targetTime / targetKm : baselinePaceKm;
  const ratio = totalDates <= 1 ? 1 : clamp(index / (totalDates - 1));
  const phase = date === goal.deadline ? "goal" : phaseForRatio(ratio);
  const phaseProgress = clamp(0.06 + ratio * 0.94);
  const currentPaceKm = baselinePaceKm + (targetPaceKm - baselinePaceKm) * phaseProgress;
  const swim = isSwimSport(goal.sport);
  const roles = roleSequence(goal.sessionsPerWeek, "performance");
  let role = roles[slotIndex % roles.length] || "easy";

  const weekIndex = Math.floor(Math.max(0, diffDays(goal.startDate, date)) / 7) + 1;
  const recoveryEvery = Math.max(4, Number(goal.recoveryEveryWeeks || 5));
  const testEvery = Math.max(4, Number(goal.testEveryWeeks || 6));
  const recoveryWeek = weekIndex % recoveryEvery === 0;
  if (date === goal.deadline) role = "final";
  else if (recoveryWeek) role = "deload";
  else if (weekIndex % testEvery === 0 && ["long","quality","tempo"].includes(role)) role = "test";

  if (swim) {
    const currentPace100 = currentPaceKm / 10;

    if (role === "deload") {
      const meters = Math.max(700, Math.round((targetMeters * (0.25 + 0.12 * ratio)) / 100) * 100);
      return {
        phase, role,
        title: `Semaine légère · ${meters} m`,
        description: `${phaseLabel(phase)} · récupération programmée : volume réduit, technique propre, aucune recherche de record.`,
        targetDistanceMeters: meters,
        targetTimeMinutes: 0
      };
    }

    if (role === "easy" || role === "recovery") {
      const meters = Math.max(800, Math.round((targetMeters * (0.32 + 0.24 * ratio)) / 100) * 100);
      return {
        phase, role,
        title: role === "recovery" ? `Récupération technique · ${meters} m` : `Technique / endurance · ${meters} m`,
        description: `${phaseLabel(phase)} · nage facile, travail technique et régularité. RPE 3–4/10.`,
        targetDistanceMeters: meters,
        targetTimeMinutes: 0
      };
    }

    if (role === "quality") {
      const sets = phase === "base" ? "8 × 100 m"
        : phase === "development" ? "6 × 200 m"
        : phase === "specific" ? "4 × 400 m"
        : "6 × 100 m";
      const pace = Math.max(targetTime / (targetMeters / 100), currentPace100 * 0.98);
      return {
        phase, role,
        title: `${sets} · ${paceLabel(pace, true)}`,
        description: `${phaseLabel(phase)} · récupération courte et nage propre. Allure de travail proche de la trajectoire.`,
        targetDistanceMeters: 0,
        targetTimeMinutes: 0,
        targetPace100: pace
      };
    }

    if (role === "tempo") {
      const meters = Math.max(1000, Math.round((targetMeters * (0.45 + 0.30 * ratio)) / 100) * 100);
      const pace = currentPace100 + 0.05;
      return {
        phase, role,
        title: `Série continue · ${meters} m`,
        description: `${phaseLabel(phase)} · tenir environ ${paceLabel(pace, true)} sans se mettre dans le rouge.`,
        targetDistanceMeters: meters,
        targetPace100: pace
      };
    }

    if (role === "long") {
      const meters = Math.max(1200, Math.round((targetMeters * Math.min(1.05, 0.52 + 0.50 * ratio)) / 100) * 100);
      return {
        phase, role,
        title: `Endurance longue · ${meters} m`,
        description: `${phaseLabel(phase)} · objectif principal : augmenter la distance continue sans dégrader la technique.`,
        targetDistanceMeters: meters
      };
    }

    if (role === "test") {
      const meters = Math.max(1000, Math.round((targetMeters * Math.min(1, 0.55 + 0.45 * ratio)) / 100) * 100);
      const projected = currentPace100 * (meters / 100);
      return {
        phase, role,
        title: `Test progression · ${meters} m en ${minutesToClock(projected)}`,
        description: `${phaseLabel(phase)} · test intermédiaire. Mesure le temps réel et enregistre la séance dans Sport.`,
        targetDistanceMeters: meters,
        targetTimeMinutes: projected,
        targetPace100: currentPace100
      };
    }

    return {
      phase: "goal",
      role: "final",
      title: `Objectif · ${Math.round(targetMeters)} m en ${minutesToClock(targetTime)}`,
      description: `Tentative finale · allure cible ${paceLabel(targetTime / (targetMeters / 100), true)}.`,
      targetDistanceMeters: targetMeters,
      targetTimeMinutes: targetTime,
      targetPace100: targetTime / (targetMeters / 100)
    };
  }

  if (role === "deload") {
    const minutes = Math.round(26 + 10 * ratio);
    return {
      phase, role,
      title: `Semaine légère · ${minutes} min`,
      description: `${phaseLabel(phase)} · récupération programmée : volume réduit et allure facile.`,
      targetTimeMinutes: minutes
    };
  }

  if (role === "easy" || role === "recovery") {
    const minutes = Math.round((role === "recovery" ? 28 : 35) + (role === "recovery" ? 8 : 20) * ratio);
    return {
      phase, role,
      title: `${role === "recovery" ? "Footing récupération" : "Endurance facile"} · ${minutes} min`,
      description: `${phaseLabel(phase)} · allure confortable, RPE 3–4/10. Le but est de construire du volume sans fatigue excessive.`,
      targetTimeMinutes: minutes
    };
  }

  if (role === "quality") {
    const sets = phase === "base" ? "6 × 400 m"
      : phase === "development" ? "5 × 800 m"
      : phase === "specific" ? "4 × 1 km"
      : "4 × 400 m";
    const pace = Math.max(targetPaceKm, currentPaceKm - 0.08);
    return {
      phase, role,
      title: `${sets} · ${paceLabel(pace)}`,
      description: `${phaseLabel(phase)} · récupération contrôlée. Recherche de régularité plutôt que de finir épuisé.`,
      targetPaceKm: pace
    };
  }

  if (role === "tempo") {
    const km = Math.max(3, Math.min(targetKm * 0.8, targetKm * (0.38 + 0.38 * ratio)));
    const pace = Math.max(targetPaceKm, currentPaceKm + 0.12);
    return {
      phase, role,
      title: `Tempo · ${km.toFixed(1)} km à ${paceLabel(pace)}`,
      description: `${phaseLabel(phase)} · effort soutenu mais maîtrisé.`,
      targetDistanceKm: km,
      targetPaceKm: pace,
      targetTimeMinutes: km * pace
    };
  }

  if (role === "long") {
    const km = Math.max(4, targetKm * Math.min(1.15, 0.62 + 0.53 * ratio));
    return {
      phase, role,
      title: `Sortie longue · ${km.toFixed(1)} km`,
      description: `${phaseLabel(phase)} · endurance régulière. Ne cherche pas l'allure cible sur toute la sortie.`,
      targetDistanceKm: km
    };
  }

  if (role === "test") {
    const km = Math.max(Math.min(5, targetKm), targetKm * Math.min(1, 0.55 + 0.45 * ratio));
    const projected = currentPaceKm * km;
    return {
      phase, role,
      title: `Test progression · ${km.toFixed(1)} km en ${minutesToClock(projected)}`,
      description: `${phaseLabel(phase)} · test intermédiaire pour comparer la performance réelle à la trajectoire.`,
      targetDistanceKm: km,
      targetTimeMinutes: projected,
      targetPaceKm: currentPaceKm
    };
  }

  return {
    phase: "goal",
    role: "final",
    title: `Objectif · ${targetKm.toFixed(targetKm % 1 ? 1 : 0)} km en ${minutesToClock(targetTime)}`,
    description: `Tentative finale · allure cible ${paceLabel(targetPaceKm)}.`,
    targetDistanceKm: targetKm,
    targetTimeMinutes: targetTime,
    targetPaceKm
  };
}

function strengthSession(goal, date, index, totalDates, slotIndex) {
  const ratio = totalDates <= 1 ? 1 : clamp(index / (totalDates - 1));
  const phase = date === goal.deadline ? "goal" : phaseForRatio(ratio);
  const roles = roleSequence(goal.sessionsPerWeek, "strength");
  let role = roles[slotIndex % roles.length] || "heavy";
  const weekIndex = Math.floor(Math.max(0, diffDays(goal.startDate, date)) / 7) + 1;
  const recoveryEvery = Math.max(4, Number(goal.recoveryEveryWeeks || 5));
  if (date === goal.deadline) role = "final";
  else if (weekIndex % recoveryEvery === 0) role = "deload";

  const startWeight = Number(goal.baselineWeight || 0);
  const targetWeight = Number(goal.targetWeight || 0);
  const startReps = Math.max(1, Number(goal.baselineReps || 1));
  const targetReps = Math.max(1, Number(goal.targetReps || 1));
  let weight = nearestHalf(startWeight + (targetWeight - startWeight) * clamp(0.08 + ratio * 0.92));
  let reps = Math.max(1, Math.round(startReps + (targetReps - startReps) * ratio));
  let sets = 3;

  if (role === "deload") {
    weight = nearestHalf(weight * 0.72);
    sets = 2;
    reps = Math.max(6, Math.min(10, reps));
  } else if (role === "technique") {
    weight = nearestHalf(weight * 0.82);
    sets = 3;
    reps = Math.max(reps, 8);
  } else if (role === "volume") {
    weight = nearestHalf(weight * 0.92);
    sets = 4;
    reps = Math.max(reps, 6);
  } else if (role === "heavy") {
    sets = 3;
  }

  if (role === "final") {
    weight = targetWeight;
    reps = targetReps;
    sets = 1;
  }

  const title = role === "final"
    ? `Test objectif · ${goal.exerciseName} ${weight} kg × ${reps}`
    : role === "deload"
      ? `Semaine légère · ${goal.exerciseName} ${sets}×${reps} à ${weight} kg`
      : `${goal.exerciseName} · ${sets}×${reps} à ${weight} kg`;

  return {
    phase,
    role,
    title,
    description: role === "deload"
      ? `${phaseLabel(phase)} · récupération programmée : baisse volontaire du volume et de la charge.`
      : `${phaseLabel(phase)} · objectif musculation. Garde 1–3 répétitions en réserve sur les séances de travail.`,
    targetWeight: weight,
    targetReps: reps,
    targetSets: sets
  };
}


function strengthMultiSession(goal, date, index, totalDates, slotIndex) {
  const ratio = totalDates <= 1 ? 1 : clamp(index / (totalDates - 1));
  const phase = date === goal.deadline ? "goal" : phaseForRatio(ratio);
  const roles = roleSequence(goal.sessionsPerWeek, "strength_multi");
  let role = roles[slotIndex % roles.length] || "heavy";
  const weekIndex = Math.floor(Math.max(0, diffDays(goal.startDate, date)) / 7) + 1;
  const recoveryEvery = Math.max(4, Number(goal.recoveryEveryWeeks || 5));
  if (date === goal.deadline) role = "final";
  else if (weekIndex % recoveryEvery === 0) role = "deload";

  const exerciseTargets = (goal._strengthExercises || []).map(exercise => {
    const startWeight = Number(exercise.baselineWeight || 0);
    const targetWeight = Number(exercise.targetWeight || 0);
    const startReps = Math.max(1, Number(exercise.baselineReps || 1));
    const targetReps = Math.max(1, Number(exercise.targetReps || 1));
    let weight = nearestHalf(startWeight + (targetWeight - startWeight) * clamp(0.08 + ratio * 0.92));
    let reps = Math.max(1, Math.round(startReps + (targetReps - startReps) * ratio));
    let sets = 3;

    if (role === "deload") {
      weight = nearestHalf(weight * 0.72);
      sets = 2;
      reps = Math.max(6, Math.min(10, reps));
    } else if (role === "technique") {
      weight = nearestHalf(weight * 0.82);
      sets = 3;
      reps = Math.max(reps, 8);
    } else if (role === "volume") {
      weight = nearestHalf(weight * 0.90);
      sets = 4;
      reps = Math.max(reps, 8);
    } else if (role === "heavy") {
      sets = 3;
    } else if (role === "final") {
      weight = targetWeight;
      reps = targetReps;
      sets = 1;
    }

    return {
      definitionId: exercise.id,
      exerciseName: exercise.exerciseName,
      targetWeight: weight,
      targetReps: reps,
      targetSets: sets
    };
  });

  const sessionType = role === "final" ? "Test final"
    : role === "deload" ? "Semaine légère"
    : role === "heavy" ? "Full Body lourd"
    : role === "volume" ? "Full Body volume"
    : "Full Body technique";

  const details = exerciseTargets
    .map(item => `${item.exerciseName}: ${item.targetSets}×${item.targetReps} à ${item.targetWeight} kg`)
    .join(" · ");

  return {
    phase,
    role,
    title: `${sessionType} · ${exerciseTargets.length} exercice${exerciseTargets.length > 1 ? "s" : ""}`,
    description: `${phaseLabel(phase)} · ${details}`,
    exerciseTargets
  };
}

function buildPlanSession(goal, date, index, totalDates, slotIndex, planId) {
  const content = goal.goalType === "strength_multi"
    ? strengthMultiSession(goal, date, index, totalDates, slotIndex)
    : goal.goalType === "strength"
      ? strengthSession(goal, date, index, totalDates, slotIndex)
      : enduranceSession(goal, date, index, totalDates, slotIndex);

  return {
    id: uid("sport_plan_session"),
    planId,
    goalId: goal.id,
    goalType: goal.goalType,
    sport: goal.sport || (["strength","strength_multi"].includes(goal.goalType) ? "Musculation" : ""),
    exerciseName: goal.exerciseName || "",
    date,
    weekIndex: Math.floor(Math.max(0, diffDays(goal.startDate, date)) / 7) + 1,
    phase: content.phase,
    role: content.role,
    title: content.title,
    description: content.description,
    targetDistanceKm: Number(content.targetDistanceKm || 0),
    targetDistanceMeters: Number(content.targetDistanceMeters || 0),
    targetTimeMinutes: Number(content.targetTimeMinutes || 0),
    targetPaceKm: Number(content.targetPaceKm || 0),
    targetPace100: Number(content.targetPace100 || 0),
    targetWeight: Number(content.targetWeight || 0),
    targetReps: Number(content.targetReps || 0),
    targetSets: Number(content.targetSets || 0),
    exerciseTargets: Array.isArray(content.exerciseTargets) ? content.exerciseTargets : [],
    completed: false,
    skipped: false,
    createdAt: new Date().toISOString()
  };
}

function taskIdForPlanSession(sessionId) {
  return `task_sport_plan_${sessionId}`;
}

function taskForSession(planSession, existing = null) {
  return {
    id: existing?.id || taskIdForPlanSession(planSession.id),
    title: `${sportIcon(planSession.sport, planSession.goalType)} ${planSession.title}`,
    description: `${phaseLabel(planSession.phase)} · ${planSession.description}`,
    folder: "Sport",
    dueDate: planSession.date,
    reminderAt: existing?.reminderAt || "",
    done: planSession.completed === true,
    completedAt: planSession.completed
      ? (existing?.completedAt || planSession.completedAt || new Date().toISOString())
      : null,
    source: "sport-plan",
    generated: true,
    sportGoalId: planSession.goalId,
    sportPlanId: planSession.planId,
    sportPlanSessionId: planSession.id,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export async function syncSportPlanTasks() {
  const [plans, sessions, tasks] = await Promise.all([
    getAll("sportTrainingPlans"),
    getAll("sportPlanSessions"),
    getAll("tasks")
  ]);

  const activePlanIds = new Set(plans.filter(plan => plan.active !== false).map(plan => plan.id));
  const sessionsById = new Map(sessions.map(session => [session.id, session]));
  const tasksBySession = new Map(
    tasks
      .filter(task => task.source === "sport-plan" && task.sportPlanSessionId)
      .map(task => [task.sportPlanSessionId, task])
  );

  for (const session of sessions) {
    if (!activePlanIds.has(session.planId)) continue;

    const existing = tasksBySession.get(session.id);

    if (session.skipped) {
      if (existing && !existing.done) await deleteOne("tasks", existing.id);
      continue;
    }

    await putOne("tasks", taskForSession(session, existing));
  }

  for (const task of tasks.filter(task => task.source === "sport-plan")) {
    const session = sessionsById.get(task.sportPlanSessionId);
    if (!session || !activePlanIds.has(session.planId)) {
      if (!task.done) await deleteOne("tasks", task.id);
    }
  }
}

async function removeFuturePlanSessions(planId, fromDate) {
  const [sessions, tasks] = await Promise.all([
    getAll("sportPlanSessions"),
    getAll("tasks")
  ]);

  const toDelete = sessions.filter(session =>
    session.planId === planId &&
    !session.completed &&
    session.date >= fromDate
  );

  const ids = new Set(toDelete.map(session => session.id));

  for (const session of toDelete) {
    await deleteOne("sportPlanSessions", session.id);
  }

  for (const task of tasks) {
    if (task.source === "sport-plan" && ids.has(task.sportPlanSessionId) && !task.done) {
      await deleteOne("tasks", task.id);
    }
  }
}

export async function generateSportPlan(goal, options = {}) {
  if (!goal || !["performance","strength","strength_multi"].includes(goal.goalType)) return null;

  if (goal.goalType === "strength_multi") {
    const definitions = (await getAll("sportStrengthGoalExercises"))
      .filter(item => item.goalId === goal.id && item.active !== false)
      .sort((a,b) => Number(a.order || 0) - Number(b.order || 0));
    goal = { ...goal, _strengthExercises: definitions };
    if (!definitions.length) return null;
  }

  const existingPlans = (await getAll("sportTrainingPlans"))
    .filter(plan => plan.goalId === goal.id && plan.active !== false)
    .sort((a,b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  const fromDate = options.fromDate || goal.startDate || todayISO();
  const startDate = fromDate < todayISO() && options.replaceFuture ? todayISO() : fromDate;
  let plan = existingPlans[0] || null;

  if (!plan) {
    plan = {
      id: uid("sport_plan"),
      goalId: goal.id,
      goalType: goal.goalType,
      sport: goal.sport || "Musculation",
      name: `Programme · ${goal.name || goal.sport || goal.exerciseName || "Objectif"}`,
      startDate: goal.startDate || todayISO(),
      deadline: goal.deadline,
      sessionsPerWeek: Math.max(1, Math.min(7, Number(goal.sessionsPerWeek || trainingDaysForGoal(goal).length || 3))),
      trainingDays: trainingDaysForGoal(goal),
      recoveryEveryWeeks: Math.max(4, Number(goal.recoveryEveryWeeks || 5)),
      testEveryWeeks: Math.max(4, Number(goal.testEveryWeeks || 6)),
      active: true,
      createdAt: new Date().toISOString(),
      generatedAt: new Date().toISOString()
    };
  } else {
    plan = {
      ...plan,
      goalType: goal.goalType,
      sport: goal.sport || plan.sport,
      name: `Programme · ${goal.name || goal.sport || goal.exerciseName || "Objectif"}`,
      deadline: goal.deadline,
      sessionsPerWeek: Math.max(1, Math.min(7, Number(goal.sessionsPerWeek || trainingDaysForGoal(goal).length || 3))),
      trainingDays: trainingDaysForGoal(goal),
      recoveryEveryWeeks: Math.max(4, Number(goal.recoveryEveryWeeks || 5)),
      testEveryWeeks: Math.max(4, Number(goal.testEveryWeeks || 6)),
      active: true,
      adaptedAt: options.replaceFuture ? new Date().toISOString() : plan.adaptedAt,
      updatedAt: new Date().toISOString()
    };
  }

  await putOne("sportTrainingPlans", plan);

  if (options.replaceFuture) {
    await removeFuturePlanSessions(plan.id, startDate);
  } else {
    const existingSessions = (await getAll("sportPlanSessions")).filter(session => session.planId === plan.id);
    if (existingSessions.length) {
      await syncSportPlanTasks();
      return plan;
    }
  }

  const goalForPlan = { ...goal, startDate, trainingDays: plan.trainingDays };
  const dates = scheduleDates(startDate, goal.deadline, goalForPlan);
  const roles = roleSequence(plan.sessionsPerWeek, goal.goalType);
  const allowedDays = trainingDaysForGoal(goalForPlan);

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const day = localDate(date).getDay();
    const weekdayIndex = allowedDays.indexOf(day);
    const slotIndex = weekdayIndex >= 0 ? weekdayIndex : roles.length - 1;
    const session = buildPlanSession(goalForPlan, date, i, dates.length, slotIndex, plan.id);
    await putOne("sportPlanSessions", session);
  }

  await syncSportPlanTasks();
  return plan;
}

export async function deleteSportPlan(goalId) {
  const [plans, sessions, tasks] = await Promise.all([
    getAll("sportTrainingPlans"),
    getAll("sportPlanSessions"),
    getAll("tasks")
  ]);

  const linkedPlans = plans.filter(plan => plan.goalId === goalId);
  const planIds = new Set(linkedPlans.map(plan => plan.id));
  const sessionIds = new Set(sessions.filter(session => planIds.has(session.planId)).map(session => session.id));

  for (const plan of linkedPlans) await deleteOne("sportTrainingPlans", plan.id);
  for (const session of sessions.filter(session => sessionIds.has(session.id))) await deleteOne("sportPlanSessions", session.id);

  for (const task of tasks) {
    if (task.source === "sport-plan" && sessionIds.has(task.sportPlanSessionId) && !task.done) {
      await deleteOne("tasks", task.id);
    }
  }
}

export async function skipSportPlanTask(task) {
  if (!task?.sportPlanSessionId) return;
  const session = await getOne("sportPlanSessions", task.sportPlanSessionId);
  if (!session) return;

  await putOne("sportPlanSessions", {
    ...session,
    skipped: true,
    updatedAt: new Date().toISOString()
  });
}

async function markPlanSessionCompleted(planSession, actual = {}) {
  const updated = {
    ...planSession,
    completed: true,
    skipped: false,
    completedAt: new Date().toISOString(),
    activitySessionId: actual.activitySessionId || planSession.activitySessionId || null,
    actualDistanceKm: Number(actual.distanceKm || 0),
    actualDistanceMeters: Number(actual.distanceMeters || 0),
    actualTimeMinutes: Number(actual.duration || 0),
    actualWeight: Number(actual.weight || 0),
    actualReps: Number(actual.reps || 0),
    updatedAt: new Date().toISOString()
  };

  await putOne("sportPlanSessions", updated);

  const task = await getOne("tasks", taskIdForPlanSession(planSession.id));
  if (task) {
    await putOne("tasks", {
      ...task,
      done: true,
      completedAt: task.completedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  return updated;
}

function nearestPlannedSession(rows, date) {
  return [...rows]
    .map(row => ({ row, delta: Math.abs(diffDays(row.date, date)) }))
    .filter(item => item.delta <= 3)
    .sort((a,b) => a.delta - b.delta || String(a.row.date).localeCompare(String(b.row.date)))[0]?.row || null;
}

export async function completeSportPlanFromActivity(activity, selectedGoalId = null) {
  if (!activity || activity.status !== "completed") return null;

  const [goals, plans, sessions] = await Promise.all([
    getAll("sportGoals"),
    getAll("sportTrainingPlans"),
    getAll("sportPlanSessions")
  ]);

  const activePlanIds = new Set(plans.filter(plan => plan.active !== false).map(plan => plan.id));

  const candidateGoals = goals.filter(goal =>
    goal.active !== false &&
    goal.goalType === "performance" &&
    (!selectedGoalId || goal.id === selectedGoalId) &&
    sportMatches(activity, goal.sport)
  );

  for (const goal of candidateGoals) {
    const planned = sessions.filter(session =>
      session.goalId === goal.id &&
      activePlanIds.has(session.planId) &&
      !session.completed &&
      !session.skipped
    );

    const match = nearestPlannedSession(planned, activity.date);
    if (match) {
      return markPlanSessionCompleted(match, {
        activitySessionId: activity.id,
        distanceKm: activity.distanceKm,
        distanceMeters: activity.distanceMeters,
        duration: activity.duration
      });
    }
  }

  return null;
}

function e1rm(weight, reps) {
  const w = Number(weight || 0);
  const r = Math.max(1, Number(reps || 1));
  return w > 0 ? w * (1 + r / 30) : 0;
}

export async function completeSportPlanFromWorkout(workoutSession) {
  if (!workoutSession || workoutSession.status !== "completed") return [];

  const [goals, plans, planSessions, exercises, sets, strengthDefinitions] = await Promise.all([
    getAll("sportGoals"),
    getAll("sportTrainingPlans"),
    getAll("sportPlanSessions"),
    getAll("sportExercises"),
    getAll("sportSets"),
    getAll("sportStrengthGoalExercises")
  ]);

  const activePlanIds = new Set(plans.filter(plan => plan.active !== false).map(plan => plan.id));
  const sessionSets = sets.filter(set => set.sessionId === workoutSession.id);
  const exerciseById = new Map(exercises.map(exercise => [exercise.id, exercise]));
  const completed = [];

  for (const goal of goals.filter(goal => goal.active !== false && goal.goalType === "strength")) {
    const matchingSets = sessionSets.filter(set => {
      const exercise = exerciseById.get(set.exerciseId);
      return exercise && normalize(exercise.name) === normalize(goal.exerciseName);
    });

    if (!matchingSets.length) continue;

    const best = [...matchingSets].sort((a,b) =>
      e1rm(b.weight, b.reps) - e1rm(a.weight, a.reps)
    )[0];

    const planned = planSessions.filter(session =>
      session.goalId === goal.id &&
      activePlanIds.has(session.planId) &&
      !session.completed &&
      !session.skipped
    );

    const match = nearestPlannedSession(planned, workoutSession.date);
    if (!match) continue;

    completed.push(await markPlanSessionCompleted(match, {
      activitySessionId: workoutSession.id,
      weight: best.weight,
      reps: best.reps
    }));
  }

  for (const goal of goals.filter(goal => goal.active !== false && goal.goalType === "strength_multi")) {
    const definitions = strengthDefinitions.filter(item => item.goalId === goal.id && item.active !== false);
    if (!definitions.length) continue;

    const matchedNames = new Set();
    for (const set of sessionSets) {
      const exercise = exerciseById.get(set.exerciseId);
      if (!exercise) continue;
      if (definitions.some(def => normalize(def.exerciseName) === normalize(exercise.name))) {
        matchedNames.add(normalize(exercise.name));
      }
    }

    const minimumMatches = Math.max(1, Math.ceil(definitions.length * 0.5));
    if (matchedNames.size < minimumMatches) continue;

    const planned = planSessions.filter(session =>
      session.goalId === goal.id &&
      session.goalType === "strength_multi" &&
      activePlanIds.has(session.planId) &&
      !session.completed &&
      !session.skipped
    );

    const match = nearestPlannedSession(planned, workoutSession.date);
    if (!match) continue;

    completed.push(await markPlanSessionCompleted(match, {
      activitySessionId: workoutSession.id
    }));
  }

  return completed;
}

export function performanceGoalState(goal, sessions) {
  const targetKm = distanceToKm(goal.targetDistance, goal.targetDistanceUnit);
  const baselineKm = distanceToKm(goal.baselineDistance || goal.targetDistance, goal.baselineDistanceUnit || goal.targetDistanceUnit);
  const baselineTime = Number(goal.baselineTimeMinutes || 0);
  const targetTime = Number(goal.targetTimeMinutes || 0);
  const baselineTargetTime = baselineKm > 0 ? (baselineTime / baselineKm) * targetKm : baselineTime;

  const matching = sessions
    .filter(session =>
      session.status === "completed" &&
      session.type === "activity" &&
      sportMatches(session, goal.sport) &&
      Number(session.distanceKm || 0) >= targetKm &&
      Number(session.duration || 0) > 0
    )
    .sort((a,b) => Number(a.duration || 0) - Number(b.duration || 0));

  const bestSession = matching[0] || null;
  const currentTime = bestSession ? Math.min(baselineTargetTime || Infinity, Number(bestSession.duration)) : baselineTargetTime;
  const denominator = baselineTargetTime - targetTime;
  const progress = denominator > 0
    ? clamp((baselineTargetTime - currentTime) / denominator, 0, 1) * 100
    : (currentTime <= targetTime ? 100 : 0);

  const total = Math.max(1, diffDays(goal.startDate || todayISO(), goal.deadline || todayISO()));
  const elapsed = clamp(diffDays(goal.startDate || todayISO(), todayISO()) / total);
  const expectedTime = baselineTargetTime + (targetTime - baselineTargetTime) * elapsed;
  const achieved = Boolean(bestSession && Number(bestSession.distanceKm || 0) >= targetKm && Number(bestSession.duration || 0) <= targetTime);

  return {
    targetKm,
    baselineTargetTime,
    targetTime,
    currentTime,
    bestSession,
    progress: Math.round(progress),
    expectedTime,
    onTrack: currentTime <= expectedTime,
    achieved,
    targetPaceKm: targetKm > 0 ? targetTime / targetKm : 0,
    baselinePaceKm: targetKm > 0 ? baselineTargetTime / targetKm : 0
  };
}

export function strengthGoalState(goal, exercises, sets, sessions) {
  const completedIds = new Set(sessions.filter(session => session.status === "completed").map(session => session.id));
  const matchingExerciseIds = new Set(
    exercises
      .filter(exercise => normalize(exercise.name) === normalize(goal.exerciseName))
      .map(exercise => exercise.id)
  );

  const matchingSets = sets
    .filter(set =>
      (matchingExerciseIds.has(set.exerciseId) || normalize(set.exerciseName || "") === normalize(goal.exerciseName || "")) &&
      completedIds.has(set.sessionId) &&
      Number(set.weight || 0) > 0 &&
      Number(set.reps || 0) > 0
    )
    .sort((a,b) => e1rm(b.weight, b.reps) - e1rm(a.weight, a.reps));

  const baselineScore = e1rm(goal.baselineWeight, goal.baselineReps);
  const targetScore = e1rm(goal.targetWeight, goal.targetReps);
  const bestSet = matchingSets[0] || null;
  const currentScore = Math.max(baselineScore, bestSet ? e1rm(bestSet.weight, bestSet.reps) : 0);
  const denominator = targetScore - baselineScore;
  const progress = denominator > 0
    ? clamp((currentScore - baselineScore) / denominator) * 100
    : (currentScore >= targetScore ? 100 : 0);

  const total = Math.max(1, diffDays(goal.startDate || todayISO(), goal.deadline || todayISO()));
  const elapsed = clamp(diffDays(goal.startDate || todayISO(), todayISO()) / total);
  const expectedScore = baselineScore + (targetScore - baselineScore) * elapsed;
  const achieved = Boolean(bestSet &&
    Number(bestSet.weight || 0) >= Number(goal.targetWeight || 0) &&
    Number(bestSet.reps || 0) >= Number(goal.targetReps || 0)
  );

  return {
    baselineScore,
    targetScore,
    currentScore,
    bestSet,
    progress: Math.round(progress),
    expectedScore,
    onTrack: currentScore >= expectedScore,
    achieved
  };
}

export function strengthMultiGoalState(goal, definitions, exercises, sets, sessions) {
  const rows = definitions
    .filter(item => item.goalId === goal.id && item.active !== false)
    .map(definition => {
      const proxy = {
        ...goal,
        exerciseName: definition.exerciseName,
        baselineWeight: definition.baselineWeight,
        baselineReps: definition.baselineReps,
        targetWeight: definition.targetWeight,
        targetReps: definition.targetReps
      };
      const state = strengthGoalState(proxy, exercises, sets, sessions);
      return { definition, state };
    });

  const progress = rows.length
    ? Math.round(rows.reduce((sum, row) => sum + row.state.progress, 0) / rows.length)
    : 0;
  const achieved = rows.length > 0 && rows.every(row => row.state.achieved);
  const onTrack = rows.length === 0 || rows.filter(row => row.state.onTrack).length >= Math.ceil(rows.length / 2);

  return { rows, progress, achieved, onTrack };
}

export async function adaptSportPlan(goal) {
  if (!goal) return null;

  const patched = { ...goal };

  if (goal.goalType === "performance") {
    const sessions = await getAll("sportSessions");
    const state = performanceGoalState(goal, sessions);

    if (state.bestSession && state.currentTime < Number(state.baselineTargetTime || Infinity)) {
      patched.baselineDistance = goal.targetDistance;
      patched.baselineDistanceUnit = goal.targetDistanceUnit;
      patched.baselineTimeMinutes = state.currentTime;
      patched.startDate = todayISO();
    }
  }

  if (goal.goalType === "strength") {
    const [exercises, sets, sessions] = await Promise.all([
      getAll("sportExercises"),
      getAll("sportSets"),
      getAll("sportSessions")
    ]);
    const state = strengthGoalState(goal, exercises, sets, sessions);

    if (state.bestSet) {
      patched.baselineWeight = Number(state.bestSet.weight || goal.baselineWeight || 0);
      patched.baselineReps = Number(state.bestSet.reps || goal.baselineReps || 1);
      patched.startDate = todayISO();
    }
  }

  if (goal.goalType === "strength_multi") {
    const [definitions, exercises, sets, sessions] = await Promise.all([
      getAll("sportStrengthGoalExercises"),
      getAll("sportExercises"),
      getAll("sportSets"),
      getAll("sportSessions")
    ]);
    const state = strengthMultiGoalState(goal, definitions, exercises, sets, sessions);
    for (const row of state.rows) {
      if (!row.state.bestSet) continue;
      await putOne("sportStrengthGoalExercises", {
        ...row.definition,
        baselineWeight: Number(row.state.bestSet.weight || row.definition.baselineWeight || 0),
        baselineReps: Number(row.state.bestSet.reps || row.definition.baselineReps || 1),
        updatedAt: new Date().toISOString()
      });
    }
    patched.startDate = todayISO();
  }

  return generateSportPlan(patched, {
    replaceFuture: true,
    fromDate: todayISO()
  });
}

export function formatPerformanceTime(minutes) {
  return minutesToClock(minutes);
}

export function formatPerformancePace(minutes, swim = false) {
  return paceLabel(minutes, swim);
}

export function getSportPhaseLabel(phase) {
  return phaseLabel(phase);
}

export function isSwimmingSport(sport) {
  return isSwimSport(sport);
}

export function getSportPlanWeeks(plan) {
  return durationWeeks(plan.startDate, plan.deadline);
}
