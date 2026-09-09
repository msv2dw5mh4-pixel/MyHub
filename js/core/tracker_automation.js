import { getAll, getOne, putOne } from "./db.js";

function localDate(date) {
  return new Date(`${date}T12:00:00`);
}

function dateOnly(value) {
  return value ? String(value).slice(0,10) : "";
}

function compare(value, comparator, threshold) {
  const n = Number(value);
  const t = Number(threshold);
  if (!Number.isFinite(n) || !Number.isFinite(t)) return false;
  if (comparator === "lte") return n <= t;
  if (comparator === "gt") return n > t;
  if (comparator === "lt") return n < t;
  if (comparator === "eq") return n === t;
  return n >= t;
}

export function trackerAutomationLabel(metric) {
  return ({
    sport_minutes: "Sport · minutes réalisées",
    sport_sessions: "Sport · nombre de séances",
    learning_minutes: "Apprentissage · minutes réalisées",
    tasks_completed: "Tâches · nombre terminées",
    tasks_due_completion_pct: "Tâches · % des échéances du jour terminées"
  })[metric] || "Automatique";
}

export async function getTrackerAutomationValue(item, date) {
  const metric = item?.automationMetric;
  if (!metric) return null;

  if (metric.startsWith("sport_")) {
    const sessions = (await getAll("sportSessions"))
      .filter(session => session.status === "completed" && session.date === date);

    if (metric === "sport_minutes") {
      return sessions.reduce((sum, session) => sum + Number(session.duration || session.durationMin || 0), 0);
    }
    if (metric === "sport_sessions") return sessions.length;
  }

  if (metric === "learning_minutes") {
    return (await getAll("learningSessions"))
      .filter(session => session.date === date)
      .reduce((sum, session) => sum + Number(session.minutes || 0), 0);
  }

  if (metric.startsWith("tasks_")) {
    const tasks = await getAll("tasks");

    if (metric === "tasks_completed") {
      return tasks.filter(task => task.done && dateOnly(task.completedAt) === date).length;
    }

    if (metric === "tasks_due_completion_pct") {
      const due = tasks.filter(task => task.dueDate === date);
      const done = due.filter(task => task.done).length;
      return due.length ? Math.round((done / due.length) * 100) : 0;
    }
  }

  return null;
}

export async function syncTrackerAutomations(date, items = null) {
  const trackerItems = items || (await getAll("trackerItems")).filter(item => item.active !== false);

  for (const item of trackerItems.filter(item => item.automationMetric)) {
    const rawValue = await getTrackerAutomationValue(item, date);
    if (rawValue === null) continue;

    const id = `${date}__${item.id}`;
    const previous = await getOne("trackerEntries", id);

    let value = rawValue;
    if (item.type === "habit") {
      value = compare(rawValue, item.comparator || "gte", Number(item.threshold ?? 1)) ? "yes" : "no";
    }

    await putOne("trackerEntries", {
      id,
      date,
      itemId: item.id,
      value,
      autoValue: rawValue,
      source: "tracker-auto",
      previousValue: previous?.source === "tracker-auto" ? previous.previousValue : previous?.value,
      updatedAt: new Date().toISOString()
    });
  }
}

export function trackerItemScheduled(item, date) {
  const days = Array.isArray(item.activeDays) && item.activeDays.length
    ? item.activeDays.map(Number)
    : [0,1,2,3,4,5,6];

  return days.includes(localDate(date).getDay());
}

export function trackerThresholdResult(item, value) {
  if (!item?.thresholdEnabled) return null;
  if (value === "" || value === null || value === undefined) return null;
  return compare(value, item.comparator || "gte", item.threshold);
}
