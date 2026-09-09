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

function localDate(dateString) {
  return new Date(`${dateString}T12:00:00`);
}

function addMonths(dateString, months) {
  const date = localDate(dateString);
  const originalDay = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + Number(months || 0));
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(originalDay, lastDay));
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0,10);
}

function addDays(dateString, days) {
  const date = localDate(dateString);
  date.setDate(date.getDate() + Number(days || 0));
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0,10);
}

function diffDays(fromDate, toDate) {
  return Math.ceil((localDate(toDate) - localDate(fromDate)) / 86400000);
}

export function maintenanceDueKey(plan) {
  return `${plan.nextDueDate || ""}|${plan.nextDueMeter ?? ""}`;
}

export function maintenancePlanStatus(plan, asset, referenceDate = todayISO()) {
  const warningDays = Math.max(0, Number(plan.warningDays ?? 30));
  const warningMeter = Math.max(0, Number(plan.warningMeter ?? 1000));
  const currentMeter = Number(asset?.currentMeter || 0);

  let dateState = "none";
  let dateRemaining = null;

  if (plan.nextDueDate) {
    dateRemaining = diffDays(referenceDate, plan.nextDueDate);
    if (dateRemaining < 0) dateState = "due";
    else if (dateRemaining <= warningDays) dateState = "soon";
    else dateState = "ok";
  }

  let meterState = "none";
  let meterRemaining = null;

  if (plan.nextDueMeter !== null && plan.nextDueMeter !== undefined && plan.nextDueMeter !== "") {
    meterRemaining = Number(plan.nextDueMeter) - currentMeter;
    if (meterRemaining <= 0) meterState = "due";
    else if (meterRemaining <= warningMeter) meterState = "soon";
    else meterState = "ok";
  }

  const states = [dateState, meterState];
  let state = "none";

  if (states.includes("due")) state = "due";
  else if (states.includes("soon")) state = "soon";
  else if (states.includes("ok")) state = "ok";

  return {
    state,
    dateState,
    meterState,
    dateRemaining,
    meterRemaining,
    currentMeter
  };
}

function taskDescription(plan, asset, status) {
  const parts = [];

  if (plan.nextDueDate) {
    parts.push(`Échéance : ${plan.nextDueDate}`);
  }

  if (plan.nextDueMeter !== null && plan.nextDueMeter !== undefined && plan.nextDueMeter !== "") {
    parts.push(`Seuil : ${Number(plan.nextDueMeter).toLocaleString("fr-FR")} ${asset?.meterUnit || "unités"}`);
  }

  if (status.meterRemaining !== null) {
    parts.push(
      status.meterRemaining <= 0
        ? `Seuil dépassé de ${Math.abs(Math.round(status.meterRemaining)).toLocaleString("fr-FR")} ${asset?.meterUnit || "unités"}`
        : `Reste ${Math.round(status.meterRemaining).toLocaleString("fr-FR")} ${asset?.meterUnit || "unités"}`
    );
  }

  if (status.dateRemaining !== null) {
    parts.push(
      status.dateRemaining < 0
        ? `Échéance dépassée de ${Math.abs(status.dateRemaining)} jour(s)`
        : `Dans ${status.dateRemaining} jour(s)`
    );
  }

  return parts.join(" · ");
}

function taskDueDate(plan, status) {
  const today = todayISO();

  if (status.state === "due") return today;

  if (plan.nextDueDate) return plan.nextDueDate;

  return today;
}

export async function syncMaintenanceTasks() {
  const [assets, plans, tasks] = await Promise.all([
    getAll("maintenanceAssets"),
    getAll("maintenancePlans"),
    getAll("tasks")
  ]);

  const activeAssets = new Map(
    assets.filter(asset => asset.active !== false && !["sold", "retired"].includes(asset.ownershipStatus)).map(asset => [asset.id, asset])
  );

  for (const plan of plans.filter(plan => plan.active !== false)) {
    const asset = activeAssets.get(plan.assetId);
    if (!asset) continue;

    const status = maintenancePlanStatus(plan, asset);
    const dueKey = maintenanceDueKey(plan);
    const linkedOpen = tasks.filter(task =>
      task.source === "maintenance" &&
      task.maintenancePlanId === plan.id &&
      !task.done
    );

    const shouldHaveTask = status.state === "due" || status.state === "soon";

    if (!shouldHaveTask) {
      for (const task of linkedOpen) {
        await deleteOne("tasks", task.id);
      }
      continue;
    }

    if (plan.taskDismissedKey === dueKey) continue;

    const titlePrefix = status.state === "due" ? "🔧 Entretien à faire" : "🔧 Entretien bientôt";
    const title = `${titlePrefix} — ${plan.title} · ${asset.name}`;
    const description = taskDescription(plan, asset, status);
    const dueDate = taskDueDate(plan, status);

    if (linkedOpen.length) {
      const keep = linkedOpen[0];

      await putOne("tasks", {
        ...keep,
        title,
        description,
        folder: "Entretien",
        dueDate,
        maintenanceAssetId: asset.id,
        assetId: asset.id,
        maintenancePlanId: plan.id,
        maintenanceDueKey: dueKey,
        updatedAt: new Date().toISOString()
      });

      for (const duplicate of linkedOpen.slice(1)) {
        await deleteOne("tasks", duplicate.id);
      }
    } else {
      await putOne("tasks", {
        id: uid("task"),
        title,
        description,
        folder: "Entretien",
        dueDate,
        reminderAt: "",
        objectiveId: null,
        source: "maintenance",
        maintenanceAssetId: asset.id,
        assetId: asset.id,
        maintenancePlanId: plan.id,
        maintenanceDueKey: dueKey,
        done: false,
        createdAt: new Date().toISOString(),
        completedAt: null
      });
    }
  }
}

export async function dismissMaintenanceTask(task) {
  if (task?.source !== "maintenance" || !task.maintenancePlanId) return;

  const plan = await getOne("maintenancePlans", task.maintenancePlanId);
  if (!plan) return;

  await putOne("maintenancePlans", {
    ...plan,
    taskDismissedKey: maintenanceDueKey(plan),
    updatedAt: new Date().toISOString()
  });
}

export async function completeMaintenancePlan(planId, {
  date = todayISO(),
  meter = null,
  cost = 0,
  notes = ""
} = {}) {
  const [plan, assets, tasks] = await Promise.all([
    getOne("maintenancePlans", planId),
    getAll("maintenanceAssets"),
    getAll("tasks")
  ]);

  if (!plan) throw new Error("Plan d'entretien introuvable.");

  const asset = assets.find(item => item.id === plan.assetId);
  if (!asset) throw new Error("Équipement introuvable.");

  const completionMeter = meter === null || meter === "" ? Number(asset.currentMeter || 0) : Number(meter);

  const record = {
    id: uid("maintenance_record"),
    assetId: asset.id,
    planId: plan.id,
    title: plan.title,
    date,
    meter: Number.isFinite(completionMeter) ? completionMeter : null,
    cost: Number(cost || 0),
    notes: String(notes || "").trim(),
    createdAt: new Date().toISOString()
  };

  await putOne("maintenanceRecords", record);

  if (
    Number.isFinite(completionMeter) &&
    completionMeter >= 0 &&
    asset.meterUnit &&
    completionMeter !== Number(asset.currentMeter || 0)
  ) {
    await putOne("maintenanceAssets", {
      ...asset,
      currentMeter: completionMeter,
      updatedAt: new Date().toISOString()
    });
  }

  let nextDueDate = plan.nextDueDate || "";
  if (Number(plan.intervalMonths || 0) > 0) {
    nextDueDate = addMonths(date, Number(plan.intervalMonths));
  } else if (Number(plan.intervalDays || 0) > 0) {
    nextDueDate = addDays(date, Number(plan.intervalDays));
  } else if (plan.oneTimeDate === true) {
    nextDueDate = "";
  }

  let nextDueMeter = plan.nextDueMeter;
  if (Number(plan.intervalMeter || 0) > 0 && Number.isFinite(completionMeter)) {
    nextDueMeter = completionMeter + Number(plan.intervalMeter);
  } else if (plan.oneTimeMeter === true) {
    nextDueMeter = null;
  }

  await putOne("maintenancePlans", {
    ...plan,
    lastDoneDate: date,
    lastDoneMeter: Number.isFinite(completionMeter) ? completionMeter : null,
    nextDueDate,
    nextDueMeter,
    taskDismissedKey: null,
    updatedAt: new Date().toISOString()
  });

  for (const task of tasks.filter(task =>
    task.source === "maintenance" &&
    task.maintenancePlanId === plan.id &&
    !task.done
  )) {
    await putOne("tasks", {
      ...task,
      done: true,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  await syncMaintenanceTasks();

  return record;
}

export async function deleteMaintenanceTasksForPlan(planId) {
  const tasks = await getAll("tasks");

  for (const task of tasks.filter(task =>
    task.source === "maintenance" &&
    task.maintenancePlanId === planId &&
    !task.done
  )) {
    await deleteOne("tasks", task.id);
  }
}
