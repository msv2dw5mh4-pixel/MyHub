import {
  getAll,
  getOne,
  putOne,
  deleteOne
} from "./db.js";

import {
  todayISO
} from "./ui.js";

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function dayOfWeek(dateString) {
  return new Date(`${dateString}T12:00:00`).getDay();
}

function maxDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function minDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function objectiveIsActive(objective) {
  const status = objective?.status || "active";
  return status === "active";
}

function actionMatchesDate(action, date) {
  if (!action || action.active === false) return false;
  if (action.startDate && date < action.startDate) return false;
  if (action.endDate && date > action.endDate) return false;

  const skippedDates = Array.isArray(action.skippedDates)
    ? action.skippedDates
    : [];

  if (skippedDates.includes(date)) return false;

  const dow = dayOfWeek(date);
  const frequency = action.frequency || "weekly";

  if (frequency === "daily") return true;

  if (frequency === "weekly") {
    return dow === Number(action.weekday ?? 1);
  }

  if (frequency === "custom") {
    const days = Array.isArray(action.daysOfWeek)
      ? action.daysOfWeek.map(Number)
      : [];
    return days.includes(dow);
  }

  return false;
}

function reminderFor(date, time) {
  if (!date || !time) return "";
  return `${date}T${time}`;
}

function recurringTaskId(actionId, date) {
  return `task_action_${actionId}_${date}`;
}

export async function syncRecurringObjectiveTasks(horizonDays = 30) {
  const [objectives, actions, tasks] = await Promise.all([
    getAll("objectives"),
    getAll("objectiveActions"),
    getAll("tasks")
  ]);

  const objectivesById = new Map(objectives.map(o => [o.id, o]));
  const actionsById = new Map(actions.map(a => [a.id, a]));
  const tasksById = new Map(tasks.map(t => [t.id, t]));

  const today = todayISO();
  const horizon = addDays(today, horizonDays);

  for (const action of actions) {
    const objective = objectivesById.get(action.objectiveId);
    if (!action || action.active === false || !objectiveIsActive(objective)) continue;

    const start = maxDate(today, action.startDate || today);
    const objectiveEnd = objective?.targetDate || "";
    const requestedEnd = minDate(action.endDate || objectiveEnd || horizon, objectiveEnd || action.endDate || horizon);
    const end = minDate(requestedEnd || horizon, horizon);

    if (!start || !end || start > end) continue;

    let cursor = start;
    while (cursor <= end) {
      if (actionMatchesDate(action, cursor)) {
        const id = recurringTaskId(action.id, cursor);
        const existing = tasksById.get(id) ||
          tasks.find(t => t.objectiveActionId === action.id && t.occurrenceDate === cursor);

        const desired = {
          id: existing?.id || id,
          title: action.title,
          description: action.description || "",
          folder: action.folder || objective?.category || "Objectifs",
          dueDate: cursor,
          reminderAt: reminderFor(cursor, action.reminderTime),
          done: existing?.done || false,
          completedAt: existing?.completedAt || null,
          objectiveId: action.objectiveId,
          objectiveActionId: action.id,
          occurrenceDate: cursor,
          source: "objective-recurring",
          generated: true,
          createdAt: existing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        await putOne("tasks", desired);
        tasksById.set(desired.id, desired);
      }

      cursor = addDays(cursor, 1);
    }
  }

  // Nettoie uniquement les futures occurrences non terminées devenues invalides.
  const latestTasks = await getAll("tasks");

  for (const task of latestTasks) {
    if (task.source !== "objective-recurring" || !task.objectiveActionId) continue;
    if (task.done) continue;
    if (!task.dueDate || task.dueDate < today) continue;

    const action = actionsById.get(task.objectiveActionId);
    const objective = action ? objectivesById.get(action.objectiveId) : null;

    const valid =
      action &&
      action.active !== false &&
      objectiveIsActive(objective) &&
      actionMatchesDate(action, task.dueDate) &&
      (!objective?.targetDate || task.dueDate <= objective.targetDate) &&
      task.dueDate <= horizon;

    if (!valid) {
      await deleteOne("tasks", task.id);
    }
  }
}

export async function createOrUpdateTaskFromMilestone(milestone, objective) {
  if (!milestone || !objective) return null;

  const tasks = await getAll("tasks");
  const existing = milestone.taskId
    ? tasks.find(t => t.id === milestone.taskId)
    : tasks.find(t => t.milestoneId === milestone.id);

  const task = {
    id: existing?.id || `task_milestone_${milestone.id}`,
    title: milestone.title,
    description: `Jalon de l'objectif : ${objective.title}`,
    folder: objective.category || "Objectifs",
    dueDate: milestone.dueDate || objective.targetDate || "",
    reminderAt: existing?.reminderAt || "",
    done: milestone.done === true,
    completedAt: milestone.done
      ? (existing?.completedAt || milestone.completedAt || new Date().toISOString())
      : null,
    objectiveId: objective.id,
    milestoneId: milestone.id,
    source: "objective-milestone",
    generated: true,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await putOne("tasks", task);

  if (milestone.taskId !== task.id) {
    await putOne("objectiveMilestones", {
      ...milestone,
      taskId: task.id,
      updatedAt: new Date().toISOString()
    });
  }

  return task;
}

export async function syncTaskFromMilestone(milestone) {
  if (!milestone) return null;

  const [objective, tasks] = await Promise.all([
    getOne("objectives", milestone.objectiveId),
    getAll("tasks")
  ]);

  if (!objective) return null;

  const task = milestone.taskId
    ? tasks.find(t => t.id === milestone.taskId)
    : tasks.find(t => t.milestoneId === milestone.id);

  if (!task) return null;

  const updated = {
    ...task,
    title: milestone.title,
    description: `Jalon de l'objectif : ${objective.title}`,
    folder: objective.category || task.folder || "Objectifs",
    dueDate: milestone.dueDate || objective.targetDate || "",
    done: milestone.done === true,
    completedAt: milestone.done
      ? (task.completedAt || milestone.completedAt || new Date().toISOString())
      : null,
    updatedAt: new Date().toISOString()
  };

  await putOne("tasks", updated);
  return updated;
}

export async function syncMilestoneFromTask(task) {
  if (!task?.milestoneId) return null;

  const milestone = await getOne("objectiveMilestones", task.milestoneId);
  if (!milestone) return null;

  const updated = {
    ...milestone,
    done: task.done === true,
    completedAt: task.done
      ? (milestone.completedAt || task.completedAt || new Date().toISOString())
      : null,
    taskId: task.id,
    updatedAt: new Date().toISOString()
  };

  await putOne("objectiveMilestones", updated);
  return updated;
}

export async function unlinkMilestoneTaskReference(task) {
  if (!task?.milestoneId) return;

  const milestone = await getOne("objectiveMilestones", task.milestoneId);
  if (!milestone || milestone.taskId !== task.id) return;

  await putOne("objectiveMilestones", {
    ...milestone,
    taskId: null,
    updatedAt: new Date().toISOString()
  });
}

export async function skipRecurringTaskOccurrence(task) {
  if (!task?.objectiveActionId || !task?.occurrenceDate) return;

  const action = await getOne("objectiveActions", task.objectiveActionId);
  if (!action) return;

  const skippedDates = new Set(
    Array.isArray(action.skippedDates)
      ? action.skippedDates
      : []
  );

  skippedDates.add(task.occurrenceDate);

  await putOne("objectiveActions", {
    ...action,
    skippedDates: [...skippedDates].sort(),
    updatedAt: new Date().toISOString()
  });
}


export async function deleteLinkedTaskForMilestone(milestoneId) {
  const tasks = await getAll("tasks");

  for (const task of tasks.filter(t => t.milestoneId === milestoneId)) {
    await deleteOne("tasks", task.id);
  }
}

export async function deleteFutureTasksForAction(actionId) {
  const today = todayISO();
  const tasks = await getAll("tasks");

  for (const task of tasks.filter(t =>
    t.objectiveActionId === actionId &&
    !t.done &&
    (!t.dueDate || t.dueDate >= today)
  )) {
    await deleteOne("tasks", task.id);
  }
}

export async function deleteFutureObjectiveActionTasks(objectiveId) {
  const today = todayISO();
  const tasks = await getAll("tasks");

  for (const task of tasks.filter(t =>
    t.objectiveId === objectiveId &&
    t.source === "objective-recurring" &&
    !t.done &&
    (!t.dueDate || t.dueDate >= today)
  )) {
    await deleteOne("tasks", task.id);
  }
}

export async function deleteAllObjectiveLinkedTasks(objectiveId) {
  const tasks = await getAll("tasks");

  for (const task of tasks.filter(t => t.objectiveId === objectiveId)) {
    if (task.generated === true) {
      await deleteOne("tasks", task.id);
      continue;
    }

    await putOne("tasks", {
      ...task,
      objectiveId: null,
      updatedAt: new Date().toISOString()
    });
  }
}

function mondayOf(dateString) {
  const d = new Date(`${dateString}T12:00:00`);
  const day = d.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + delta);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

export async function getObjectiveTaskStats(objectiveId) {
  const tasks = (await getAll("tasks")).filter(t => t.objectiveId === objectiveId);
  const today = todayISO();
  const monday = mondayOf(today);
  const sunday = addDays(monday, 6);

  const open = tasks.filter(t => !t.done);
  const week = tasks.filter(t => t.dueDate && t.dueDate >= monday && t.dueDate <= sunday);

  return {
    total: tasks.length,
    open: open.length,
    done: tasks.filter(t => t.done).length,
    dueToday: open.filter(t => t.dueDate === today).length,
    late: open.filter(t => t.dueDate && t.dueDate < today).length,
    weekTotal: week.length,
    weekDone: week.filter(t => t.done).length
  };
}
