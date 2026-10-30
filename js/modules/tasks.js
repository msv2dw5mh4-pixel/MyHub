import {
  getAll,
  putOne,
  deleteOne
} from "../core/db.js";

import {
  escapeHtml,
  formatDate,
  todayISO,
  uid,
  openModal,
  closeModal
} from "../core/ui.js";

import {
  syncRecurringObjectiveTasks,
  syncMilestoneFromTask,
  unlinkMilestoneTaskReference,
  skipRecurringTaskOccurrence,
  syncObjectiveProgressFromActions
} from "../core/objective_tasks.js";

import {
  dismissMaintenanceTask
} from "../core/maintenance_tasks.js";

import { dismissDocumentTask, syncDocumentTasks } from "../core/document_tasks.js";
import { skipSportPlanTask, syncSportPlanTasks } from "../core/sport_planner.js";
import { completeLivingCareTask, syncLivingCareTasks, skipLivingCareTask } from "../core/living_tasks.js";
import { dismissPeopleReminderTask, syncPeopleReminderTasks } from "../core/people_tasks.js";
import { getTaskFolders, createTaskFolder, renameTaskFolder, deleteTaskFolder, ensureTaskFolder, sameTaskFolder, DEFAULT_TASK_FOLDER } from "../core/task_folders.js";

let activeFilter = "focus";
let linkedFilter = "all";
let objectiveContextId = null;
let taskSearch = "";
let activeFolder = "all";

async function safeGetAll(storeName) {
  try {
    return await getAll(storeName);
  } catch (error) {
    console.warn(`[Tâches] Lecture impossible du store ${storeName}:`, error);
    return [];
  }
}

function taskState(task) {
  if (task.done) return "done";

  const today = todayISO();

  if (task.dueDate && task.dueDate < today) return "late";
  if (task.dueDate === today) return "today";

  return "upcoming";
}

function isAutomaticTask(task) {
  return Boolean(task.generated) || [
    "maintenance",
    "document",
    "sport-plan",
    "living-care",
    "objective-recurring",
    "objective-milestone",
    "people-reminder"
  ].includes(task.source);
}

function hasTaskLink(task) {
  return Boolean(
    task.objectiveId ||
    task.projectId ||
    task.assetId ||
    task.maintenanceAssetId ||
    task.personId ||
    task.livingEntityId ||
    ["maintenance","document","sport-plan","living-care","objective-recurring","objective-milestone","people-reminder"].includes(task.source)
  );
}

function linkedFilterMatches(task) {
  if (objectiveContextId && task.objectiveId !== objectiveContextId) return false;

  if (linkedFilter === "all") return hasTaskLink(task);
  if (linkedFilter === "objectives") return Boolean(task.objectiveId);
  if (linkedFilter === "projects") return Boolean(task.projectId);
  if (linkedFilter === "maintenance") return task.source === "maintenance" || Boolean(task.assetId || task.maintenanceAssetId);
  if (linkedFilter === "sport") return task.source === "sport-plan";
  if (linkedFilter === "living") return task.source === "living-care" || Boolean(task.livingEntityId);
  if (linkedFilter === "people") return task.source === "people-reminder" || Boolean(task.personId);
  if (linkedFilter === "documents") return task.source === "document";

  return true;
}

function filterTasks(tasks) {
  const today = todayISO();

  let filtered;
  switch (activeFilter) {
    case "focus":
      filtered = tasks.filter(task =>
        !task.done &&
        Boolean(task.dueDate) &&
        task.dueDate <= today
      );
      break;

    case "upcoming":
      filtered = tasks.filter(task =>
        !task.done &&
        !isAutomaticTask(task) &&
        Boolean(task.dueDate) &&
        task.dueDate > today
      );
      break;

    case "no-date":
      filtered = tasks.filter(task => !task.done && !isAutomaticTask(task) && !task.dueDate);
      break;

    case "automatic":
      filtered = tasks.filter(task => !task.done && isAutomaticTask(task));
      break;

    case "linked":
      filtered = tasks.filter(task => !task.done && linkedFilterMatches(task));
      break;

    case "done":
      filtered = tasks.filter(task => task.done);
      break;

    default:
      filtered = tasks.filter(task => !task.done);
  }

  if (activeFolder !== "all") {
    filtered = filtered.filter(task => sameTaskFolder(task.folder || DEFAULT_TASK_FOLDER, activeFolder));
  }

  const query = taskSearch.trim().toLocaleLowerCase("fr-FR");
  if (!query) return filtered;

  return filtered.filter(task => [
    task.title,
    task.description,
    task.folder
  ].some(value => String(value || "").toLocaleLowerCase("fr-FR").includes(query)));
}

function sortTasks(tasks) {
  const priorityRank = { high: 0, medium: 1, low: 2 };

  return [...tasks].sort((a,b) => {
    if (a.done !== b.done) return Number(a.done) - Number(b.done);

    const ap = priorityRank[a.priority || "medium"] ?? 1;
    const bp = priorityRank[b.priority || "medium"] ?? 1;
    if (ap !== bp) return ap - bp;

    const ad = a.dueDate || "9999-12-31";
    const bd = b.dueDate || "9999-12-31";

    return ad.localeCompare(bd) ||
      String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
}

function objectiveBadge(task, objectiveMap) {
  if (!task.objectiveId) return "";

  const objective = objectiveMap.get(task.objectiveId);
  const label = objective?.title || "Objectif";

  return `<span class="badge">🎯 ${escapeHtml(label)}</span>`;
}

function projectBadge(task, projectMap) {
  if (!task.projectId) return "";
  const project = projectMap.get(task.projectId);
  return `<span class="badge">🏠 ${escapeHtml(project?.title || "Projet")}</span>`;
}

function assetBadge(task, assetMap) {
  const assetId = task.assetId || task.maintenanceAssetId;
  if (!assetId) return "";
  const asset = assetMap.get(assetId);
  return `<span class="badge">🔗 ${escapeHtml(asset?.name || "Bien")}</span>`;
}

function livingBadge(task, aquariumMap, plantMap) {
  if (!task.livingEntityId) return "";
  if (task.livingEntityType === "plant") {
    const plant = plantMap.get(task.livingEntityId);
    return `<span class="badge">🌿 ${escapeHtml(plant?.name || "Plante")}</span>`;
  }
  const aquarium = aquariumMap.get(task.livingEntityId);
  return `<span class="badge">🐠 ${escapeHtml(aquarium?.name || "Aquarium")}</span>`;
}

function personBadge(task, peopleMap) {
  if (!task.personId) return "";
  const person = peopleMap.get(task.personId);
  const label = [person?.firstName, person?.lastName].filter(Boolean).join(" ").trim() || person?.nickname || "Personne";
  return `<span class="badge">👤 ${escapeHtml(label)}</span>`;
}

function priorityBadge(task) {
  const priority = task.priority || "medium";
  if (priority === "high") return `<span class="badge task-priority high">Priorité haute</span>`;
  if (priority === "low") return `<span class="badge task-priority low">Priorité basse</span>`;
  return "";
}

function sourceBadge(task) {
  if (task.source === "objective-milestone") {
    return `<span class="badge">Jalon lié</span>`;
  }

  if (task.source === "objective-recurring") {
    return `<span class="badge">↻ Récurrente</span>`;
  }

  if (task.source === "maintenance") {
    return `<span class="badge">🔧 Entretien</span>`;
  }

  if (task.source === "document") {
    return `<span class="badge">📂 Document</span>`;
  }

  if (task.source === "idea") {
    return `<span class="badge">💡 Idée</span>`;
  }

  if (task.source === "sport-plan") {
    return `<span class="badge">🏅 Programme sport</span>`;
  }

  if (task.source === "living-care") {
    return `<span class="badge">🌿 Soin récurrent</span>`;
  }

  if (task.source === "people-reminder") {
    return `<span class="badge">👥 Personnes</span>`;
  }

  return "";
}

function isSystemTask(task) {
  return isAutomaticTask(task);
}

function systemTaskRoute(task) {
  if (task.source === "maintenance") return "maintenance";
  if (task.source === "document") return "documents";
  if (task.source === "sport-plan") return "sport";
  if (task.source === "living-care") return "living";
  if (["objective-recurring", "objective-milestone"].includes(task.source)) return "objectives";
  if (task.source === "people-reminder") return "people";
  return null;
}

function taskDateAction(task) {
  if (isSystemTask(task)) return "";

  return `<div class="task-quick-actions">
    <button class="task-mini-btn task-edit" type="button">Modifier</button>
    ${task.done ? "" : `<button class="task-mini-btn task-move-tomorrow" type="button">Demain</button>`}
  </div>`;
}

function taskRow(task, objectiveMap, projectMap, assetMap, aquariumMap, plantMap, peopleMap) {
  const state = taskState(task);

  const badge =
    state === "late"
      ? `<span class="badge danger">En retard</span>`
      : state === "today"
        ? `<span class="badge success">Aujourd'hui</span>`
        : "";

  const badges = [
    badge,
    objectiveBadge(task, objectiveMap),
    projectBadge(task, projectMap),
    assetBadge(task, assetMap),
    livingBadge(task, aquariumMap, plantMap),
    personBadge(task, peopleMap),
    priorityBadge(task),
    sourceBadge(task)
  ].filter(Boolean).join(" ");

  return `
    <article class="list-item ${task.done ? "done" : ""} ${!isSystemTask(task) ? "task-row-clickable" : "task-row-system"}" data-task-id="${task.id}" data-task-editable="${!isSystemTask(task) ? "true" : "false"}">
      <input class="checkbox task-toggle" type="checkbox" ${task.done ? "checked" : ""} aria-label="Terminer la tâche">

      <div class="task-main">
        <div class="task-title">${escapeHtml(task.title)}</div>

        <div class="task-meta">
          ${escapeHtml(task.folder || "Général")} · ${formatDate(task.dueDate)}
          ${badges ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px">${badges}</div>` : ""}
        </div>

        ${task.description ? `<div class="task-desc">${escapeHtml(task.description)}</div>` : ""}
        ${taskDateAction(task)}
      </div>

      <button class="icon-btn task-delete" aria-label="Supprimer">×</button>
    </article>
  `;
}

export async function renderTasks(container) {
  await syncRecurringObjectiveTasks(7);
  await syncDocumentTasks();
  await syncSportPlanTasks();
  await syncLivingCareTasks();
  await syncPeopleReminderTasks();

  const [tasksRaw, objectives, projects, assets, aquariums, plants, people, taskFolders] = await Promise.all([
    getAll("tasks"),
    getAll("objectives"),
    getAll("projects"),
    getAll("maintenanceAssets"),
    getAll("livingAquariums"),
    getAll("livingPlants"),
    getAll("people"),
    getTaskFolders()
  ]);

  const tasks = sortTasks(tasksRaw);
  const objectiveMap = new Map(objectives.map(o => [o.id, o]));
  const projectMap = new Map(projects.map(p => [p.id, p]));
  const assetMap = new Map(assets.map(a => [a.id, a]));
  const aquariumMap = new Map(aquariums.map(a => [a.id, a]));
  const plantMap = new Map(plants.map(p => [p.id, p]));
  const peopleMap = new Map(people.map(p => [p.id, p]));
  const visible = filterTasks(tasks);

  const today = todayISO();
  const focusCount = tasks.filter(task => !task.done && task.dueDate && task.dueDate <= today).length;
  const upcomingCount = tasks.filter(task => !task.done && !isAutomaticTask(task) && task.dueDate && task.dueDate > today).length;
  const inboxCount = tasks.filter(task => !task.done && !isAutomaticTask(task) && !task.dueDate).length;
  const automaticCount = tasks.filter(task => !task.done && isAutomaticTask(task)).length;
  const linkedCount = tasks.filter(task => !task.done && hasTaskLink(task)).length;
  const doneCount = tasks.filter(task => task.done).length;
  const contextObjective = objectiveContextId ? objectiveMap.get(objectiveContextId) : null;

  if (activeFolder !== "all" && !taskFolders.some(folder => sameTaskFolder(folder, activeFolder))) {
    activeFolder = "all";
  }

  const userOpenTasks = tasks.filter(task => !task.done && !isAutomaticTask(task));
  const folderCount = folder => userOpenTasks.filter(task => sameTaskFolder(task.folder || DEFAULT_TASK_FOLDER, folder)).length;

  container.innerHTML = `
    <section class="tasks-v32">
      <div class="section-head">
        <div>
          <h2>Mes tâches</h2>
          <p class="muted" style="margin:4px 0 0">
            ${tasks.filter(task => !task.done).length} à faire · ${focusCount} à traiter maintenant
          </p>
        </div>

        <button class="primary-btn" id="add-task">+ Tâche</button>
      </div>

      <section class="task-folders-panel">
        <div class="task-folders-head">
          <div>
            <strong>Dossiers</strong>
            <span>Range tes tâches comme dans une liste To Do.</span>
          </div>
          <div class="task-folders-actions">
            <button class="ghost-btn" id="task-manage-folders">Gérer</button>
            <button class="primary-btn" id="task-add-folder">+ Dossier</button>
          </div>
        </div>

        <div class="task-folder-strip" aria-label="Dossiers de tâches">
          <button class="task-folder-chip ${activeFolder === "all" ? "active" : ""}" data-task-folder="all">
            Toutes <span>${userOpenTasks.length}</span>
          </button>
          ${taskFolders.map(folder => `
            <button class="task-folder-chip ${activeFolder !== "all" && sameTaskFolder(activeFolder, folder) ? "active" : ""}" data-task-folder="${escapeHtml(folder)}">
              📁 ${escapeHtml(folder)} <span>${folderCount(folder)}</span>
            </button>
          `).join("")}
        </div>
      </section>

      <div class="task-overview task-overview-v32">
        <article class="${focusCount ? "attention" : ""}">
          <span>À traiter</span>
          <strong>${focusCount}</strong>
          <small>retard + aujourd'hui</small>
        </article>
        <article>
          <span>À venir</span>
          <strong>${upcomingCount}</strong>
          <small>avec une date future</small>
        </article>
        <article>
          <span>Inbox</span>
          <strong>${inboxCount}</strong>
          <small>sans échéance</small>
        </article>
      </div>

      <nav class="task-primary-tabs" aria-label="Vues des tâches">
        <button class="${activeFilter === "focus" ? "active" : ""}" data-filter="focus">
          À traiter <span>${focusCount}</span>
        </button>
        <button class="${activeFilter === "upcoming" ? "active" : ""}" data-filter="upcoming">
          À venir <span>${upcomingCount}</span>
        </button>
        <button class="${activeFilter === "no-date" ? "active" : ""}" data-filter="no-date">
          Sans date <span>${inboxCount}</span>
        </button>
        <button class="${activeFilter === "automatic" ? "active" : ""}" data-filter="automatic">
          Automatiques <span>${automaticCount}</span>
        </button>
        <button class="${activeFilter === "linked" ? "active" : ""}" data-filter="linked">
          Liées <span>${linkedCount}</span>
        </button>
        <button class="${activeFilter === "done" ? "active" : ""}" data-filter="done">
          Terminées <span>${doneCount}</span>
        </button>
      </nav>

      ${activeFilter === "linked" ? `
        <div class="task-linked-filters">
          <button class="${linkedFilter === "all" ? "active" : ""}" data-linked-filter="all">Toutes</button>
          <button class="${linkedFilter === "objectives" ? "active" : ""}" data-linked-filter="objectives">🎯 Objectifs</button>
          <button class="${linkedFilter === "projects" ? "active" : ""}" data-linked-filter="projects">🏠 Projets</button>
          <button class="${linkedFilter === "maintenance" ? "active" : ""}" data-linked-filter="maintenance">🔧 Entretien</button>
          <button class="${linkedFilter === "sport" ? "active" : ""}" data-linked-filter="sport">🏅 Sport</button>
          <button class="${linkedFilter === "documents" ? "active" : ""}" data-linked-filter="documents">📂 Documents</button>
          <button class="${linkedFilter === "living" ? "active" : ""}" data-linked-filter="living">🌿 Vivant</button>
          <button class="${linkedFilter === "people" ? "active" : ""}" data-linked-filter="people">👥 Personnes</button>
        </div>
      ` : ""}

      ${contextObjective ? `
        <div class="task-context-banner">
          <div>
            <span>Filtre objectif</span>
            <strong>🎯 ${escapeHtml(contextObjective.title)}</strong>
          </div>
          <button class="ghost-btn" id="task-clear-context">Voir toutes les tâches liées</button>
        </div>
      ` : ""}

      <div class="task-search-wrap">
        <input id="task-search" type="search" value="${escapeHtml(taskSearch)}" placeholder="Rechercher dans cette vue…" autocomplete="off">
      </div>

      <div class="task-view-heading">
        <div>
          <strong>${
            activeFilter === "focus" ? "À traiter maintenant" :
            activeFilter === "upcoming" ? "À venir" :
            activeFilter === "no-date" ? "Sans échéance" :
            activeFilter === "automatic" ? "Tâches automatiques" :
            activeFilter === "linked" ? "Tâches liées" :
            "Terminées"
          }</strong>
          <span>${visible.length} tâche${visible.length > 1 ? "s" : ""}${activeFolder !== "all" ? ` · 📁 ${escapeHtml(activeFolder)}` : ""}</span>
        </div>
      </div>

      <div class="section list task-list-v32" id="task-list">
        ${
          visible.length
            ? visible.map(task => taskRow(task, objectiveMap, projectMap, assetMap, aquariumMap, plantMap, peopleMap)).join("")
            : `<div class="empty task-empty-v32">${
                activeFilter === "focus"
                  ? "Rien d'urgent. Les tâches sans date sont maintenant rangées dans « Sans date »."
                  : "Aucune tâche dans cette vue."
              }</div>`
        }
      </div>
    </section>
  `;

  container.querySelector("#add-task").addEventListener("click", () => showAddTaskModal(
    activeFolder !== "all" ? { folder: activeFolder } : {}
  ));

  container.querySelectorAll("[data-task-folder]").forEach(btn => {
    btn.addEventListener("click", async () => {
      activeFolder = btn.dataset.taskFolder || "all";
      await renderTasks(container);
    });
  });

  container.querySelector("#task-add-folder")?.addEventListener("click", () => showTaskFolderCreateModal(container));
  container.querySelector("#task-manage-folders")?.addEventListener("click", () => showTaskFolderManager(container));

  const searchInput = container.querySelector("#task-search");
  searchInput?.addEventListener("input", async event => {
    taskSearch = event.target.value;
    await renderTasks(container);
    const next = container.querySelector("#task-search");
    next?.focus();
    next?.setSelectionRange(taskSearch.length, taskSearch.length);
  });

  container.querySelectorAll("[data-filter]").forEach(btn => {
    btn.addEventListener("click", async () => {
      activeFilter = btn.dataset.filter;
      await renderTasks(container);
    });
  });

  container.querySelectorAll("[data-linked-filter]").forEach(btn => {
    btn.addEventListener("click", async () => {
      linkedFilter = btn.dataset.linkedFilter;
      if (linkedFilter !== "objectives") objectiveContextId = null;
      await renderTasks(container);
    });
  });

  container.querySelector("#task-clear-context")?.addEventListener("click", async () => {
    objectiveContextId = null;
    linkedFilter = "all";
    await renderTasks(container);
  });

  container.querySelectorAll("[data-task-id]").forEach(row => {
    row.addEventListener("click", event => {
      if (event.target.closest("button, input, select, textarea, label, a")) return;

      const task = tasks.find(item => item.id === row.dataset.taskId);
      if (!task) return;

      if (!isSystemTask(task)) {
        // Le listener robuste de task_modal_guard intercepte ce bouton et ouvre la fiche.
        row.querySelector(".task-edit")?.click();
        return;
      }

      const route = systemTaskRoute(task);
      if (route) {
        window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: route }));
      }
    });
  });

  container.querySelectorAll(".task-toggle").forEach(input => {
    input.addEventListener("change", async event => {
      const row = event.target.closest("[data-task-id]");
      const id = row.dataset.taskId;
      const task = tasks.find(t => t.id === id);

      if (!task) return;

      if (task.source === "maintenance" && event.target.checked) {
        event.target.checked = false;
        alert("Pour terminer cette tâche, enregistre l'entretien depuis le module Entretien. MyHub recalculera ensuite la prochaine échéance.");
        window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "maintenance" }));
        return;
      }

      if (task.source === "document" && event.target.checked) {
        event.target.checked = false;
        alert("Pour terminer cette alerte, mets à jour la nouvelle date d'expiration dans le module Documents. MyHub recalculera automatiquement la prochaine échéance.");
        window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "documents" }));
        return;
      }

      if (task.source === "sport-plan" && event.target.checked) {
        event.target.checked = false;
        alert("Pour valider cette séance, enregistre l'activité réelle dans le module Sport. MyHub rapprochera automatiquement la séance du programme.");
        window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "sport" }));
        return;
      }

      if (task.source === "living-care" && event.target.checked) {
        await completeLivingCareTask(task);
        await renderTasks(container);
        window.dispatchEvent(new CustomEvent("myhub:data-changed"));
        return;
      }

      const updated = {
        ...task,
        done: event.target.checked,
        completedAt: event.target.checked ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString()
      };

      await putOne("tasks", updated);
      await syncMilestoneFromTask(updated);
      if (updated.objectiveId) await syncObjectiveProgressFromActions(updated.objectiveId);

      await renderTasks(container);

      window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    });
  });

  container.querySelectorAll(".task-edit").forEach(btn => {
    btn.addEventListener("click", event => {
      event.stopPropagation();
      const id = event.target.closest("[data-task-id]").dataset.taskId;
      const task = tasks.find(t => t.id === id);
      if (task && !isSystemTask(task)) showAddTaskModal(task);
    });
  });

  container.querySelectorAll(".task-move-tomorrow").forEach(btn => {
    btn.addEventListener("click", async event => {
      event.stopPropagation();
      const id = event.target.closest("[data-task-id]").dataset.taskId;
      const task = tasks.find(t => t.id === id);
      if (!task || isSystemTask(task)) return;
      const d = new Date(`${todayISO()}T12:00:00`);
      d.setDate(d.getDate()+1);
      const offset=d.getTimezoneOffset();
      const tomorrow=new Date(d.getTime()-offset*60000).toISOString().slice(0,10);
      await putOne("tasks", {...task,dueDate:tomorrow,updatedAt:new Date().toISOString()});
      await renderTasks(container);
      window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    });
  });

  container.querySelectorAll(".task-delete").forEach(btn => {
    btn.addEventListener("click", async event => {
      const id = event.target.closest("[data-task-id]").dataset.taskId;
      const task = tasks.find(t => t.id === id);

      if (!task) return;

      const confirmMessage = task.source === "objective-recurring"
        ? "Supprimer cette occurrence ? Elle ne sera pas recréée."
        : task.source === "sport-plan"
          ? "Ignorer cette séance du programme ? Elle ne sera plus comptée comme séance prévue."
          : task.source === "living-care"
            ? "Ignorer ce soin cette fois-ci ? La prochaine occurrence sera conservée."
            : task.source === "people-reminder"
              ? "Ignorer ce rappel Personnes ? Il ne sera pas recréé pour cette occurrence."
              : "Supprimer cette tâche ?";

      if (!confirm(confirmMessage)) return;

      if (task.source === "objective-recurring") {
        await skipRecurringTaskOccurrence(task);
      } else if (task.source === "maintenance") {
        await dismissMaintenanceTask(task);
      } else if (task.source === "document") {
        await dismissDocumentTask(task);
      } else if (task.source === "sport-plan") {
        await skipSportPlanTask(task);
      } else if (task.source === "living-care") {
        await skipLivingCareTask(task);
      } else if (task.source === "people-reminder") {
        await dismissPeopleReminderTask(task);
      } else {
        await unlinkMilestoneTaskReference(task);
      }

      await deleteOne("tasks", id);

      await renderTasks(container);

      window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    });
  });
}

export async function showAddTaskModal(preset = {}) {
  const editing = Boolean(preset?.id);
  const [objectivesRaw, projectsRaw, assetsRaw, aquariumsRaw, plantsRaw, peopleRaw, taskFolders] = await Promise.all([
    safeGetAll("objectives"),
    safeGetAll("projects"),
    safeGetAll("maintenanceAssets"),
    safeGetAll("livingAquariums"),
    safeGetAll("livingPlants"),
    safeGetAll("people"),
    getTaskFolders()
  ]);

  const objectives = objectivesRaw
    .filter(o => (o.status || "active") !== "completed" && o.status !== "cancelled")
    .sort((a,b) => String(a.title || "").localeCompare(String(b.title || "")));

  const projects = projectsRaw
    .filter(p => p.active !== false && (p.status || "active") !== "completed")
    .sort((a,b) => String(a.title || "").localeCompare(String(b.title || "")));

  const assets = assetsRaw
    .filter(a => a.active !== false && !["sold", "retired"].includes(a.ownershipStatus))
    .sort((a,b) => String(a.name || "").localeCompare(String(b.name || "")));

  const aquariums = aquariumsRaw.filter(a => a.active !== false).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||"")));
  const plants = plantsRaw.filter(p => p.active !== false).sort((a,b)=>String(p.name||"").localeCompare(String(b.name||"")));
  const people = peopleRaw.filter(p => p.active !== false).sort((a,b) => {
    const an = [a.firstName,a.lastName].filter(Boolean).join(" ");
    const bn = [b.firstName,b.lastName].filter(Boolean).join(" ");
    return an.localeCompare(bn, "fr");
  });

  openModal(`
    <div class="modal-head">
      <div>
        <p class="eyebrow">TÂCHE</p>
        <h2>${editing ? "Modifier la tâche" : "Nouvelle tâche"}</h2>
      </div>

      <button class="icon-btn" id="close-modal">×</button>
    </div>

    <form class="form-grid" id="task-form">
      <div class="field">
        <label for="task-title">Nom de la tâche</label>
        <input
          id="task-title"
          name="title"
          required
          maxlength="120"
          value="${escapeHtml(preset.title || "")}"
          placeholder="Ex. Appeler le garage"
        >
      </div>

      <div class="field">
        <label for="task-desc">Description</label>
        <textarea id="task-desc" name="description" placeholder="Informations complémentaires">${escapeHtml(preset.description || "")}</textarea>
      </div>

      <div class="field">
        <label for="task-folder">Dossier</label>
        <select id="task-folder" name="folder">
          ${[...new Set([DEFAULT_TASK_FOLDER, ...taskFolders, preset.folder].filter(Boolean))].map(folder => `
            <option value="${escapeHtml(folder)}" ${sameTaskFolder(folder, preset.folder || DEFAULT_TASK_FOLDER) ? "selected" : ""}>📁 ${escapeHtml(folder)}</option>
          `).join("")}
        </select>
        <small class="muted">Les dossiers se créent et se gèrent depuis l’écran Tâches.</small>
      </div>

      <div class="field">
        <label for="task-priority">Priorité</label>
        <select id="task-priority" name="priority">
          <option value="high" ${preset.priority === "high" ? "selected" : ""}>Haute</option>
          <option value="medium" ${!preset.priority || preset.priority === "medium" ? "selected" : ""}>Normale</option>
          <option value="low" ${preset.priority === "low" ? "selected" : ""}>Basse</option>
        </select>
      </div>

      <div class="field">
        <label for="task-objective">Objectif lié</label>
        <select id="task-objective" name="objectiveId">
          <option value="">Aucun objectif</option>
          ${objectives.map(objective => `
            <option
              value="${objective.id}"
              ${objective.id === preset.objectiveId ? "selected" : ""}
            >
              ${escapeHtml(objective.title)}
            </option>
          `).join("")}
        </select>
      </div>

      <div class="field">
        <label for="task-project">Projet lié</label>
        <select id="task-project" name="projectId">
          <option value="">Aucun projet</option>
          ${projects.map(project => `<option value="${project.id}" ${project.id === preset.projectId ? "selected" : ""}>${escapeHtml(project.title)}</option>`).join("")}
        </select>
      </div>

      <div class="field">
        <label for="task-asset">Bien lié</label>
        <select id="task-asset" name="assetId">
          <option value="">Aucun bien</option>
          ${assets.map(asset => `<option value="${asset.id}" ${asset.id === preset.assetId ? "selected" : ""}>${escapeHtml(asset.name)}</option>`).join("")}
        </select>
        <small class="muted">Ex : relier « Mettre à jour l'iPhone » à ton iPhone.</small>
      </div>

      <div class="field">
        <label for="task-person">Personne liée</label>
        <select id="task-person" name="personId">
          <option value="">Aucune personne</option>
          ${people.map(person => {
            const label = [person.firstName, person.lastName].filter(Boolean).join(" ").trim() || person.nickname || "Sans nom";
            return `<option value="${person.id}" ${person.id === preset.personId ? "selected" : ""}>👤 ${escapeHtml(label)}</option>`;
          }).join("")}
        </select>
      </div>

      <div class="field">
        <label for="task-living">Aquarium / plante lié(e)</label>
        <select id="task-living" name="livingLink">
          <option value="">Aucun</option>
          ${aquariums.length ? `<optgroup label="Aquariums">${aquariums.map(a => `<option value="aquarium:${a.id}" ${preset.livingEntityType==="aquarium" && preset.livingEntityId===a.id ? "selected" : ""}>🐠 ${escapeHtml(a.name)}</option>`).join("")}</optgroup>` : ""}
          ${plants.length ? `<optgroup label="Plantes">${plants.map(p => `<option value="plant:${p.id}" ${preset.livingEntityType==="plant" && preset.livingEntityId===p.id ? "selected" : ""}>🌿 ${escapeHtml(p.name)}</option>`).join("")}</optgroup>` : ""}
        </select>
      </div>

      <div class="row">
        <div class="field">
          <label for="task-due">Échéance</label>
          <input
            id="task-due"
            type="date"
            name="dueDate"
            value="${escapeHtml(preset.dueDate || "")}"
          >
        </div>

        <div class="field">
          <label for="task-reminder">Rappel</label>
          <input
            id="task-reminder"
            type="datetime-local"
            name="reminderAt"
            value="${escapeHtml(preset.reminderAt || "")}"
          >
        </div>
      </div>

      <div class="actions">
        <button type="button" class="ghost-btn" id="cancel-task">Annuler</button>
        <button class="primary-btn" id="task-submit" type="submit">${editing ? "Enregistrer" : "Créer"}</button>
      </div>
    </form>
  `);

  document.getElementById("close-modal").addEventListener("click", closeModal);
  document.getElementById("cancel-task").addEventListener("click", closeModal);

  document.getElementById("task-form").addEventListener("submit", async event => {
    event.preventDefault();

    const fd = new FormData(event.target);

    const livingLink = String(fd.get("livingLink") || "");
    const [livingEntityType, livingEntityId] = livingLink.includes(":") ? livingLink.split(":") : [null, null];

    const task = {
      ...preset,
      id: preset.id || uid("task"),
      title: String(fd.get("title") || "").trim(),
      description: String(fd.get("description") || "").trim(),
      folder: String(fd.get("folder") || "").trim() || "Général",
      priority: String(fd.get("priority") || preset.priority || "medium"),
      dueDate: String(fd.get("dueDate") || ""),
      reminderAt: String(fd.get("reminderAt") || ""),
      objectiveId: String(fd.get("objectiveId") || "") || null,
      projectId: String(fd.get("projectId") || "") || null,
      assetId: String(fd.get("assetId") || "") || null,
      personId: String(fd.get("personId") || "") || null,
      livingEntityType,
      livingEntityId,
      done: preset.done === true,
      createdAt: preset.createdAt || new Date().toISOString(),
      completedAt: preset.completedAt || null,
      updatedAt: new Date().toISOString()
    };

    const submitButton = document.getElementById("task-submit");
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = editing ? "Enregistrement…" : "Création…";
    }

    try {
      if (!task.title) {
        throw new Error("Le nom de la tâche est obligatoire.");
      }

      task.folder = await ensureTaskFolder(task.folder);
      await putOne("tasks", task);

      closeModal();

      window.dispatchEvent(
        new CustomEvent("myhub:navigate", { detail: "tasks" })
      );

      window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    } catch (error) {
      console.error("[Tâches] Échec de l'enregistrement :", error);
      alert(`Impossible d'enregistrer la tâche. ${error?.message || "Réessaie après avoir rechargé MyHub."}`);
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = editing ? "Enregistrer" : "Créer";
      }
    }
  });
}

export function requestTasksForObjective(objectiveId) {
  activeFilter = "linked";
  linkedFilter = "objectives";
  objectiveContextId = objectiveId || null;
  taskSearch = "";
  window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "tasks" }));
}

export function requestTaskView(view = "focus") {
  activeFilter = ["focus","upcoming","no-date","automatic","linked","done"].includes(view) ? view : "focus";
  if (activeFilter !== "linked") objectiveContextId = null;
  taskSearch = "";
  window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "tasks" }));
}

export async function getTasksSummary() {
  await syncRecurringObjectiveTasks(30);
  await syncDocumentTasks();
  await syncLivingCareTasks();
  await syncPeopleReminderTasks();

  const tasks = await getAll("tasks");
  const today = todayISO();
  const open = tasks.filter(t => !t.done);
  const personalOpen = open.filter(t => t.source !== "sport-plan");
  const sportPlanOpen = open.filter(t => t.source === "sport-plan");

  const dueToday = personalOpen.filter(t => t.dueDate === today).length;
  const late = personalOpen.filter(t => t.dueDate && t.dueDate < today).length;
  const objectiveOpen = personalOpen.filter(t => t.objectiveId).length;
  const projectOpen = personalOpen.filter(t => t.projectId).length;
  const noDate = personalOpen.filter(t => !t.dueDate).length;
  const tomorrowDate = (() => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate()+1);
    const offset=d.getTimezoneOffset();
    return new Date(d.getTime()-offset*60000).toISOString().slice(0,10);
  })();
  const tomorrow = personalOpen.filter(t => t.dueDate === tomorrowDate).length;
  const sportPlanToday = sportPlanOpen.filter(t => t.dueDate === today).length;

  return {
    open: personalOpen.length,
    dueToday,
    late,
    tomorrow,
    noDate,
    objectiveOpen,
    projectOpen,
    sportPlanOpen: sportPlanOpen.length,
    sportPlanToday
  };
}
