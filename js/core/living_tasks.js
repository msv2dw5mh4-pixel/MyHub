import { getAll, getOne, putOne, deleteOne } from "./db.js";
import { uid, todayISO } from "./ui.js";

function addDays(date, days) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + Number(days || 0));
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0,10);
}

function taskId(plan) {
  return `living-care__${plan.id}__${plan.nextDueDate}`;
}

function entityName(plan, aquariums, plants) {
  if (plan.entityType === "plant") {
    return plants.find(p => p.id === plan.entityId)?.name || "Plante";
  }
  return aquariums.find(a => a.id === plan.entityId)?.name || "Aquarium";
}

export async function syncLivingCareTasks() {
  const [plans, tasks, aquariums, plants] = await Promise.all([
    getAll("livingCarePlans"),
    getAll("tasks"),
    getAll("livingAquariums"),
    getAll("livingPlants")
  ]);

  const taskMap = new Map(tasks.map(task => [task.id, task]));

  for (const plan of plans.filter(p => p.active !== false && p.nextDueDate)) {
    const id = taskId(plan);
    if (taskMap.has(id)) continue;

    const name = entityName(plan, aquariums, plants);

    await putOne("tasks", {
      id,
      title: plan.title || `${plan.entityType === "plant" ? "🌿" : "🐠"} Entretien ${name}`,
      description: plan.notes || "",
      folder: "Aquariums & Plantes",
      dueDate: plan.nextDueDate,
      reminderAt: "",
      livingEntityId: plan.entityId,
      livingEntityType: plan.entityType,
      livingCarePlanId: plan.id,
      source: "living-care",
      done: false,
      createdAt: new Date().toISOString(),
      completedAt: null
    });
  }
}

export async function completeLivingCareTask(task) {
  if (!task?.livingCarePlanId) return;

  const plan = await getOne("livingCarePlans", task.livingCarePlanId);
  if (!plan) return;

  const completionDate = todayISO();

  await putOne("livingCareRecords", {
    id: uid("living_care_record"),
    planId: plan.id,
    entityId: plan.entityId,
    entityType: plan.entityType,
    title: plan.title,
    date: completionDate,
    notes: "",
    createdAt: new Date().toISOString()
  });

  await putOne("tasks", {
    ...task,
    done: true,
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const frequencyDays = Math.max(1, Number(plan.frequencyDays || 1));
  const baseDate = plan.nextDueDate && plan.nextDueDate > completionDate ? plan.nextDueDate : completionDate;

  await putOne("livingCarePlans", {
    ...plan,
    lastCompletedDate: completionDate,
    nextDueDate: addDays(baseDate, frequencyDays),
    updatedAt: new Date().toISOString()
  });

  await syncLivingCareTasks();
}


export async function skipLivingCareTask(task) {
  if (!task?.livingCarePlanId) return;
  const plan = await getOne("livingCarePlans", task.livingCarePlanId);
  if (!plan) return;

  const frequencyDays = Math.max(1, Number(plan.frequencyDays || 1));
  const baseDate = plan.nextDueDate || todayISO();

  await putOne("livingCarePlans", {
    ...plan,
    nextDueDate: addDays(baseDate, frequencyDays),
    updatedAt: new Date().toISOString()
  });
}

export async function deleteLivingCareTasksForPlan(planId) {
  const tasks = await getAll("tasks");
  for (const task of tasks.filter(t => t.livingCarePlanId === planId && !t.done)) {
    await deleteOne("tasks", task.id);
  }
}

export async function getLivingCareSummary() {
  await syncLivingCareTasks();
  const [aquariums, plants, tasks] = await Promise.all([
    getAll("livingAquariums"),
    getAll("livingPlants"),
    getAll("tasks")
  ]);

  const today = todayISO();
  const open = tasks.filter(t => t.source === "living-care" && !t.done);

  return {
    aquariums: aquariums.filter(a => a.active !== false).length,
    plants: plants.filter(p => p.active !== false).length,
    due: open.filter(t => t.dueDate && t.dueDate <= today).length,
    upcoming: open.filter(t => t.dueDate && t.dueDate > today).length
  };
}
