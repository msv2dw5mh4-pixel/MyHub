import { getAll } from "./db.js";
import { todayISO } from "./ui.js";

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

function mondayOf(dateString) {
  const d = localDate(dateString);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return iso(d);
}

function normalize(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function isRun(session) {
  const s = normalize(session.activityType || session.programName || "");
  return s.includes("course") || s.includes("running") || s.includes("run");
}

function isSwim(session) {
  const s = normalize(session.activityType || session.programName || "");
  return s.includes("natation") || s.includes("nage") || s.includes("swim");
}

function e1rm(weight, reps) {
  const w = Number(weight || 0);
  const r = Math.max(1, Number(reps || 1));
  return w > 0 ? w * (1 + r / 30) : 0;
}

function durationLabel(minutes) {
  const totalSeconds = Math.max(0, Math.round(Number(minutes || 0) * 60));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${m}:${String(s).padStart(2,"0")}`;
}

function activityRecord(sessions, targetKm, predicate) {
  const tolerance = Math.max(0.15, targetKm * 0.08);
  const rows = sessions
    .filter(session => session.status === "completed" && session.type === "activity" && predicate(session))
    .filter(session => Number(session.distanceKm || 0) >= targetKm - tolerance && Number(session.distanceKm || 0) <= targetKm + tolerance)
    .filter(session => Number(session.duration || 0) > 0)
    .map(session => {
      const distanceKm = Number(session.distanceKm || 0);
      const projectedMinutes = distanceKm > 0 ? Number(session.duration) * (targetKm / distanceKm) : Number(session.duration);
      return { session, projectedMinutes };
    })
    .sort((a,b) => a.projectedMinutes - b.projectedMinutes);

  return rows[0] || null;
}

export async function getSportRecords() {
  const [sessions, exercises, sets] = await Promise.all([
    getAll("sportSessions"),
    getAll("sportExercises"),
    getAll("sportSets")
  ]);

  const runDistances = [1, 5, 10, 21.0975];
  const swimDistances = [0.1, 0.4, 1, 1.5, 2, 4];

  const running = runDistances.map(km => {
    const record = activityRecord(sessions, km, isRun);
    return record ? {
      key: `run_${km}`,
      sport: "Course à pied",
      distanceLabel: km === 21.0975 ? "Semi-marathon" : `${String(km).replace(".", ",")} km`,
      minutes: record.projectedMinutes,
      valueLabel: durationLabel(record.projectedMinutes),
      date: record.session.date,
      sessionId: record.session.id
    } : null;
  }).filter(Boolean);

  const swimming = swimDistances.map(km => {
    const record = activityRecord(sessions, km, isSwim);
    return record ? {
      key: `swim_${km}`,
      sport: "Natation",
      distanceLabel: `${Math.round(km * 1000).toLocaleString("fr-FR")} m`,
      minutes: record.projectedMinutes,
      valueLabel: durationLabel(record.projectedMinutes),
      date: record.session.date,
      sessionId: record.session.id
    } : null;
  }).filter(Boolean);

  const completedSessions = sessions.filter(session => session.status === "completed");
  const completedIds = new Set(completedSessions.map(session => session.id));
  const sessionMap = new Map(completedSessions.map(session => [session.id, session]));
  const exerciseMap = new Map(exercises.map(exercise => [exercise.id, exercise]));
  const byExercise = new Map();

  sets
    .filter(set => completedIds.has(set.sessionId) && Number(set.weight || 0) > 0 && Number(set.reps || 0) > 0)
    .forEach(set => {
      const exercise = exerciseMap.get(set.exerciseId);
      // Les exercices ajoutés/remplacés pendant une séance n'existent pas forcément
      // dans sportExercises : exerciseName devient donc la référence de secours.
      const displayName = exercise?.name || set.exerciseName || "Exercice";
      const key = normalize(displayName);
      if (!key) return;
      const session = sessionMap.get(set.sessionId);
      const datedSet = { ...set, recordDate: session?.date || "", completedAt: session?.completedAt || "" };
      const current = byExercise.get(key) || {
        name: displayName,
        maxWeight: null,
        bestE1rm: null,
        bestReps: null,
        chronological: []
      };

      current.chronological.push(datedSet);
      if (!current.maxWeight || Number(datedSet.weight) > Number(current.maxWeight.weight) ||
          (Number(datedSet.weight) === Number(current.maxWeight.weight) && Number(datedSet.reps) > Number(current.maxWeight.reps))) {
        current.maxWeight = datedSet;
      }
      const score = e1rm(datedSet.weight, datedSet.reps);
      if (!current.bestE1rm || score > current.bestE1rm.score) current.bestE1rm = { set: datedSet, score };
      if (!current.bestReps || Number(datedSet.reps) > Number(current.bestReps.reps)) current.bestReps = datedSet;
      byExercise.set(key, current);
    });

  const strength = [...byExercise.values()]
    .map(row => {
      const ordered = [...row.chronological].sort((a,b) =>
        String(a.recordDate || "").localeCompare(String(b.recordDate || "")) ||
        String(a.completedAt || "").localeCompare(String(b.completedAt || ""))
      );
      let runningBest = -Infinity;
      const history = [];
      for (const set of ordered) {
        const score = e1rm(set.weight, set.reps);
        if (score > runningBest + 0.0001) {
          runningBest = score;
          history.push({
            date: set.recordDate,
            sessionId: set.sessionId,
            weight: Number(set.weight || 0),
            reps: Number(set.reps || 0),
            e1rm: score
          });
        }
      }

      return {
        name: row.name,
        maxWeight: Number(row.maxWeight?.weight || 0),
        maxWeightReps: Number(row.maxWeight?.reps || 0),
        maxWeightDate: row.maxWeight?.recordDate || "",
        maxWeightSessionId: row.maxWeight?.sessionId || "",
        bestE1rm: Number(row.bestE1rm?.score || 0),
        bestSetWeight: Number(row.bestE1rm?.set?.weight || 0),
        bestSetReps: Number(row.bestE1rm?.set?.reps || 0),
        bestSetDate: row.bestE1rm?.set?.recordDate || "",
        bestSetSessionId: row.bestE1rm?.set?.sessionId || "",
        bestReps: Number(row.bestReps?.reps || 0),
        bestRepsWeight: Number(row.bestReps?.weight || 0),
        bestRepsDate: row.bestReps?.recordDate || "",
        history
      };
    })
    .sort((a,b) => a.name.localeCompare(b.name, "fr"));

  return { running, swimming, strength };
}

function weekStats(sessions, sets, startDate) {
  const endDate = addDays(startDate, 6);
  const rows = sessions.filter(session => session.status === "completed" && session.date >= startDate && session.date <= endDate);
  const ids = new Set(rows.map(row => row.id));
  const workoutSets = sets.filter(set => ids.has(set.sessionId));

  const duration = rows.reduce((sum, row) => {
    const explicit = Number(row.duration || row.durationMin || 0);
    if (explicit > 0) return sum + explicit;
    if (row.startedAt && row.completedAt) {
      const diff = (new Date(row.completedAt) - new Date(row.startedAt)) / 60000;
      return sum + Math.max(0, diff);
    }
    return sum;
  }, 0);
  const runningKm = rows.filter(isRun).reduce((sum, row) => sum + Number(row.distanceKm || 0), 0);
  const swimmingMeters = rows.filter(isSwim).reduce((sum, row) => sum + Number(row.distanceMeters || 0), 0);
  const strengthVolume = workoutSets.reduce((sum, set) => sum + Number(set.weight || 0) * Number(set.reps || 0), 0);

  return {
    startDate,
    endDate,
    sessions: rows.length,
    duration,
    runningKm,
    swimmingMeters,
    strengthVolume,
    strengthSets: workoutSets.length
  };
}

export async function getWeeklyTrainingLoad(referenceDate = todayISO()) {
  const [sessions, sets] = await Promise.all([
    getAll("sportSessions"),
    getAll("sportSets")
  ]);

  const currentStart = mondayOf(referenceDate);
  const previousStart = addDays(currentStart, -7);
  const current = weekStats(sessions, sets, currentStart);
  const previous = weekStats(sessions, sets, previousStart);

  const compare = (now, before) => before > 0 ? Math.round(((now - before) / before) * 100) : (now > 0 ? 100 : 0);
  const durationChange = compare(current.duration, previous.duration);
  const sessionChange = compare(current.sessions, previous.sessions);
  const runningChange = compare(current.runningKm, previous.runningKm);
  const swimChange = compare(current.swimmingMeters, previous.swimmingMeters);
  const strengthChange = compare(current.strengthVolume, previous.strengthVolume);

  let warning = "stable";
  if (previous.duration > 0 && durationChange >= 30) warning = "high-rise";
  if (previous.duration > 0 && durationChange <= -35) warning = "low";

  return {
    current,
    previous,
    changes: { durationChange, sessionChange, runningChange, swimChange, strengthChange },
    warning
  };
}
