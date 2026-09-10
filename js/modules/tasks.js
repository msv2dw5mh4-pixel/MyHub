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
  skipRecurringTaskOccurrence
} from "../core/objective_tasks.js";

import {
  dismissMaintenanceTask
} from "../core/maintenance_tasks.js";

import { dismissDocumentTask, syncDocumentTasks } from "../core/document_tasks.js";
import { skipSportPlanTask, syncSportPlanTasks } from "../core/sport_planner.js";
import { completeLivingCareTask, syncLivingCareTasks, skipLivingCareTask } from "../core/living_tasks.js";
import { dismissPeopleReminderTask, syncPeopleReminderTasks } from "../core/people_tasks.js";

let activeFilter = "today";
let taskSearch = "";

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

function filterTasks(tasks) {
  const today = todayISO();
  const tomorrow = (() => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() + 1);
    const offset = d.getTimezoneOffset();
    return new Date(d.getTime() - offset * 60000).toISOString().slice(0,10);
  })();
  const weekEnd = (() => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() + 7);
    const offset = d.getTimezoneOffset();
    return new Date(d.getTime() - offset * 60000).toISOString().slice(0,10);
  })();

  let filtered;
  switch (activeFilter) {
    case "today":
      filtered = tasks.filter(t => !t.done && (!t.dueDate || t.dueDate <= today));
      break;
    case "tomorrow":
      filtered = tasks.filter(t => !t.done && t.dueDate === tomorrow);
      break;
    case "week":
      filtered = tasks.filter(t => !t.done && t.dueDate && t.dueDate > today && t.dueDate <= weekEnd);
      break;
    case "late":
      filtered = tasks.filter(t => !t.done && t.dueDate && t.dueDate < today);
      break;
    case "no-date":
      filtered = tasks.filter(t => !t.done && !t.dueDate);
      break;
    case "all":
      filtered = tasks.filter(t => !t.done);
      break;
    case "objectives":
      filtered = tasks.filter(t => !t.done && t.objectiveId);
      break;
    case "maintenance":
      filtered = tasks.filter(t => !t.done && (t.source === "maintenance" || t.assetId || t.maintenanceAssetId));
      break;
    case "projects":
      filtered = tasks.filter(t => !t.done && t.projectId);
      break;
    case "sport-plan":
      filtered = tasks.filter(t => !t.done && t.source === "sport-plan");
      break;
    case "living":
      filtered = tasks.filter(t => !t.done && (t.source === "living-care" || t.livingEntityId));
      break;
    case "people":
      filtered = tasks.filter(t => !t.done && (t.source === "people-reminder" || t.personId));
      break;
    case "done":
      filtered = tasks.filter(t => t.done);
      break;
    default:
      filtered = tasks;
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
  return [...tasks].sort((a,b) => {
    if (a.done !== b.done) return Number(a.done) - Number(b.done);

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
  return ["maintenance", "document", "sport-plan", "living-care", "objective-recurring", "people-reminder"].includes(task.source);
}

function taskDateAction(task) {
  if (task.done || isSystemTask(task)) return "";
  return `<div class="task-quick-actions">
    <button class="task-mini-btn task-edit" type="button">Modifier</button>
    <button class="task-mini-btn task-move-tomorrow" type="button">Demain</button>
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
    sourceBadge(task)
  ].filter(Boolean).join(" ");

  return `
    <article class="list-item ${task.done ? "done" : ""}" data-task-id="${task.id}">
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
  await syncRecurringObjectiveTasks(30);
  await syncDocumentTasks();
  await syncSportPlanTasks();
  await syncLivingCareTasks();
  await syncPeopleReminderTasks();

  const [tasksRaw, objectives, projects, assets, aquariums, plants, people] = await Promise.all([
    getAll("tasks"),
    getAll("objectives"),
    getAll("projects"),
    getAll("maintenanceAssets"),
    getAll("livingAquariums"),
    getAll("livingPlants"),
    getAll("people")
  ]);

  const tasks = sortTasks(tasksRaw);
  const objectiveMap = new Map(objectives.map(o => [o.id, o]));
  const projectMap = new Map(projects.map(p => [p.id, p]));
  const assetMap = new Map(assets.map(a => [a.id, a]));
  const aquariumMap = new Map(aquariums.map(a => [a.id, a]));
  const plantMap = new Map(plants.map(p => [p.id, p]));
  const peopleMap = new Map(people.map(p => [p.id, p]));
  const visible = filterTasks(tasks);

  container.innerHTML = `
    <section>
      <div class="section-head">
        <div>
          <h2>Mes tâches</h2>
          <p class="muted" style="margin:4px 0 0">
            ${tasks.filter(t => !t.done).length} en cours ·
            ${tasks.filter(t => !t.done && (t.assetId || t.maintenanceAssetId)).length} liée${tasks.filter(t => !t.done && (t.assetId || t.maintenanceAssetId)).length > 1 ? "s" : ""} à des biens
          </p>
        </div>

        <button class="primary-btn" id="add-task">Ajouter</button>
      </div>

      <div class="task-overview">
        <article><span>En retard</span><strong>${tasks.filter(t=>!t.done&&t.dueDate&&t.dueDate<todayISO()).length}</strong></article>
        <article><span>Aujourd'hui</span><strong>${tasks.filter(t=>!t.done&&t.dueDate===todayISO()).length}</strong></article>
        <article><span>Sans date</span><strong>${tasks.filter(t=>!t.done&&!t.dueDate).length}</strong></article>
      </div>

      <div class="task-search-wrap">
        <input id="task-search" type="search" value="${escapeHtml(taskSearch)}" placeholder="Rechercher une tâche…">
      </div>

      <div class="pills" id="task-filters">
        <button class="pill ${activeFilter === "today" ? "active" : ""}" data-filter="today">Aujourd'hui</button>
        <button class="pill ${activeFilter === "tomorrow" ? "active" : ""}" data-filter="tomorrow">Demain</button>
        <button class="pill ${activeFilter === "week" ? "active" : ""}" data-filter="week">7 jours</button>
        <button class="pill ${activeFilter === "late" ? "active" : ""}" data-filter="late">En retard</button>
        <button class="pill ${activeFilter === "no-date" ? "active" : ""}" data-filter="no-date">Sans date</button>
        <button class="pill ${activeFilter === "all" ? "active" : ""}" data-filter="all">Toutes</button>
        <button class="pill ${activeFilter === "objectives" ? "active" : ""}" data-filter="objectives">🎯 Objectifs</button>
        <button class="pill ${activeFilter === "maintenance" ? "active" : ""}" data-filter="maintenance">🔧 Entretien</button>
        <button class="pill ${activeFilter === "projects" ? "active" : ""}" data-filter="projects">🏠 Projets</button>
        <button class="pill ${activeFilter === "sport-plan" ? "active" : ""}" data-filter="sport-plan">🏅 Programme sport</button>
        <button class="pill ${activeFilter === "living" ? "active" : ""}" data-filter="living">🌿 Vivant</button>
        <button class="pill ${activeFilter === "people" ? "active" : ""}" data-filter="people">👥 Personnes</button>
        <button class="pill ${activeFilter === "done" ? "active" : ""}" data-filter="done">Terminées</button>
      </div>

      <div class="section list" id="task-list">
        ${
          visible.length
            ? visible.map(task => taskRow(task, objectiveMap, projectMap, assetMap, aquariumMap, plantMap, peopleMap)).join("")
            : `<div class="empty">Aucune tâche dans cette vue.</div>`
        }
      </div>
    </section>
  `;

  container.querySelector("#add-task").addEventListener("click", () => showAddTaskModal());

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
  const [objectivesRaw, projectsRaw, assetsRaw, aquariumsRaw, plantsRaw, peopleRaw] = await Promise.all([
    safeGetAll("objectives"),
    safeGetAll("projects"),
    safeGetAll("maintenanceAssets"),
    safeGetAll("livingAquariums"),
    safeGetAll("livingPlants"),
    safeGetAll("people")
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
        <input
          id="task-folder"
          name="folder"
          maxlength="60"
          value="${escapeHtml(preset.folder || "")}"
          placeholder="Général, Maison, Travail…"
        >
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
