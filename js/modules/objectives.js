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
  createOrUpdateTaskFromMilestone,
  syncTaskFromMilestone,
  deleteLinkedTaskForMilestone,
  syncRecurringObjectiveTasks,
  deleteFutureTasksForAction,
  deleteFutureObjectiveActionTasks,
  deleteAllObjectiveLinkedTasks,
  getObjectiveTaskStats
} from "../core/objective_tasks.js";

let currentView = "active";
let currentObjectiveId = null;
let allFilter = "all";
let lastContainer = null;

export async function renderObjectives(container) {
  lastContainer = container;
  container.innerHTML = `<section class="objectives-shell" id="objectives-shell"></section>`;
  await syncRecurringObjectiveTasks(30);
  await renderCurrentView();
}

export function requestNewObjective(preset = {}) {
  currentView = "active";
  window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "objectives" }));
  setTimeout(() => showObjectiveModal(null, preset), 120);
}

function tabs(active) {
  return `
    <div class="objectives-tabs">
      <button class="objectives-tab ${active === "active" ? "active" : ""}" data-objectives-view="active">En cours</button>
      <button class="objectives-tab ${active === "all" ? "active" : ""}" data-objectives-view="all">Tous</button>
      <button class="objectives-tab ${active === "stats" ? "active" : ""}" data-objectives-view="stats">Stats</button>
    </div>
  `;
}

function bindTabs(shell) {
  shell.querySelectorAll("[data-objectives-view]").forEach(btn => {
    btn.addEventListener("click", async () => {
      currentView = btn.dataset.objectivesView;
      currentObjectiveId = null;
      await renderCurrentView();
    });
  });
}

async function renderCurrentView() {
  if (!lastContainer) return;

  const shell = lastContainer.querySelector("#objectives-shell") || lastContainer;

  if (currentView === "detail") return renderDetail(shell, currentObjectiveId);
  if (currentView === "all") return renderAll(shell);
  if (currentView === "stats") return renderStats(shell);

  return renderActive(shell);
}

async function getObjectivesData() {
  const [objectives, milestones, actions, tasks] = await Promise.all([
    getAll("objectives"),
    getAll("objectiveMilestones"),
    getAll("objectiveActions"),
    getAll("tasks")
  ]);

  return {
    objectives: [...objectives].sort((a,b) =>
      String(a.targetDate || "9999-12-31").localeCompare(String(b.targetDate || "9999-12-31")) ||
      String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
    ),
    milestones: [...milestones].sort((a,b) =>
      (a.order || 0) - (b.order || 0) ||
      String(a.dueDate || "9999-12-31").localeCompare(String(b.dueDate || "9999-12-31"))
    ),
    actions: [...actions].sort((a,b) =>
      String(a.title || "").localeCompare(String(b.title || ""))
    ),
    tasks
  };
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function progressFor(objective, milestones) {
  if (objective.status === "completed") return 100;

  if (objective.progressMode === "milestones") {
    const linked = milestones.filter(m => m.objectiveId === objective.id);
    if (!linked.length) return 0;
    const done = linked.filter(m => m.done === true).length;
    return Math.round((done / linked.length) * 100);
  }

  if (objective.progressMode === "numeric") {
    const start = Number(objective.startValue || 0);
    const current = Number(objective.currentValue || 0);
    const target = Number(objective.targetValue || 0);

    if (target === start) return current === target ? 100 : 0;

    const raw = target > start
      ? (current - start) / (target - start)
      : (start - current) / (start - target);

    return clamp(Math.round(raw * 100));
  }

  return clamp(objective.manualProgress || 0);
}

function expectedProgress(objective) {
  if (!objective.targetDate || objective.status === "completed") return null;

  const start = new Date(`${objective.startDate || objective.createdDate || todayISO()}T12:00:00`);
  const end = new Date(`${objective.targetDate}T12:00:00`);
  const now = new Date(`${todayISO()}T12:00:00`);

  const total = end - start;
  if (total <= 0) return 100;

  const elapsed = Math.max(0, Math.min(total, now - start));
  return clamp(Math.round((elapsed / total) * 100));
}

function objectiveState(objective, milestones) {
  if (objective.status === "completed") {
    return { key: "completed", label: "✓ Terminé" };
  }

  if (objective.status === "paused") {
    return { key: "paused", label: "En pause" };
  }

  const progress = progressFor(objective, milestones);
  const expected = expectedProgress(objective);

  if (objective.targetDate && objective.targetDate < todayISO()) {
    return { key: "late", label: "Échéance dépassée" };
  }

  if (expected !== null && progress + 5 < expected) {
    return { key: "behind", label: "À rattraper" };
  }

  return { key: "on-track", label: "Dans le rythme" };
}

function formatDate(date) {
  if (!date) return "Sans échéance";

  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(`${date}T12:00:00`));
}


const OBJECTIVE_DAY_NAMES = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

function actionFrequencyLabel(action) {
  const frequency = action.frequency || "weekly";

  if (frequency === "daily") return "Tous les jours";

  if (frequency === "weekly") {
    return `Chaque ${OBJECTIVE_DAY_NAMES[Number(action.weekday ?? 1)] || "semaine"}`;
  }

  if (frequency === "custom") {
    const days = Array.isArray(action.daysOfWeek)
      ? action.daysOfWeek.map(Number)
      : [];

    return days.length
      ? days.map(day => OBJECTIVE_DAY_NAMES[day]).join(", ")
      : "Jours choisis";
  }

  return "Récurrent";
}

function actionDateRangeLabel(action) {
  const start = action.startDate ? formatDate(action.startDate) : "maintenant";
  const end = action.endDate ? formatDate(action.endDate) : "sans fin";
  return `${start} → ${end}`;
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n)
    ? n.toLocaleString("fr-FR")
    : n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

function numericLabel(objective, value) {
  const formatted = formatNumber(value);
  return `${formatted}${objective.unit ? ` ${escapeHtml(objective.unit)}` : ""}`;
}

function daysUntil(date) {
  if (!date) return null;
  const now = new Date(`${todayISO()}T12:00:00`);
  const target = new Date(`${date}T12:00:00`);
  return Math.ceil((target - now) / 86400000);
}

function priorityLabel(priority) {
  if (priority === "high") return "Priorité haute";
  if (priority === "low") return "Priorité basse";
  return "Priorité normale";
}

function progressModeLabel(mode) {
  if (mode === "numeric") return "Progression chiffrée";
  if (mode === "milestones") return "Progression par jalons";
  return "Progression manuelle";
}

function objectiveCard(objective, milestones) {
  const progress = progressFor(objective, milestones);
  const state = objectiveState(objective, milestones);
  const linked = milestones.filter(m => m.objectiveId === objective.id);
  const due = daysUntil(objective.targetDate);

  let meta = `${progressModeLabel(objective.progressMode)} · ${formatDate(objective.targetDate)}`;

  if (objective.progressMode === "milestones" && linked.length) {
    meta = `${linked.filter(m => m.done).length}/${linked.length} jalons · ${formatDate(objective.targetDate)}`;
  }

  if (objective.progressMode === "numeric") {
    meta = `${numericLabel(objective, objective.currentValue)} / ${numericLabel(objective, objective.targetValue)} · ${formatDate(objective.targetDate)}`;
  }

  return `
    <article class="objective-card ${state.key}" data-objective="${objective.id}">
      <div class="objective-card-head">
        <div>
          <h3>${escapeHtml(objective.title)}</h3>
          <p>${escapeHtml(objective.category || "Personnel")} · ${meta}</p>
        </div>
        <strong>${progress} %</strong>
      </div>

      <div class="objective-badges">
        <span class="objective-badge priority-${objective.priority || "medium"}">${priorityLabel(objective.priority)}</span>
        <span class="objective-badge">${state.label}</span>
        ${
          due !== null && due >= 0 && due <= 30 && objective.status !== "completed"
            ? `<span class="objective-badge">J-${due}</span>`
            : ""
        }
      </div>

      <div class="objective-progress-wrap">
        <div class="objective-progress-meta">
          <span>Progression</span>
          <span>${progress} %</span>
        </div>
        <div class="objective-progress"><i style="width:${progress}%"></i></div>
      </div>
    </article>
  `;
}

function bindObjectiveCards(parent) {
  parent.querySelectorAll("[data-objective]").forEach(card => {
    card.addEventListener("click", async () => {
      currentObjectiveId = card.dataset.objective;
      currentView = "detail";
      await renderCurrentView();
    });
  });
}

async function renderActive(shell) {
  const data = await getObjectivesData();
  const active = data.objectives.filter(o => o.status !== "completed" && o.status !== "cancelled");
  const completedCount = data.objectives.filter(o => o.status === "completed").length;
  const states = active.map(o => objectiveState(o, data.milestones));
  const behind = states.filter(s => s.key === "behind" || s.key === "late").length;

  shell.innerHTML = `
    ${tabs("active")}

    <div class="objectives-hero">
      <span>Objectifs actifs</span>
      <strong>${active.length}</strong>
      <small>${behind ? `${behind} à surveiller` : "Tous dans le rythme"} · ${completedCount} terminé${completedCount > 1 ? "s" : ""}</small>
    </div>

    <section class="objectives-section">
      <div class="objectives-section-head">
        <div>
          <h2>Mes objectifs</h2>
          <p>Du projet à l'action, avec une progression visible.</p>
        </div>
        <button class="primary-btn" id="objective-add">+ Objectif</button>
      </div>

      <div class="objectives-list">
        ${
          active.length
            ? active.map(o => objectiveCard(o, data.milestones)).join("")
            : `
              <div class="objective-empty">
                <h3>Aucun objectif actif</h3>
                <p>Crée ton premier objectif et choisis comment mesurer sa progression.</p>
                <button class="primary-btn" id="objective-empty-add">Créer un objectif</button>
              </div>
            `
        }
      </div>
    </section>
  `;

  bindTabs(shell);
  bindObjectiveCards(shell);

  shell.querySelector("#objective-add").addEventListener("click", () => showObjectiveModal());

  const empty = shell.querySelector("#objective-empty-add");
  if (empty) empty.addEventListener("click", () => showObjectiveModal());
}

async function renderAll(shell) {
  const data = await getObjectivesData();
  const filters = [
    ["all", "Tous"],
    ["active", "Actifs"],
    ["completed", "Terminés"],
    ["paused", "En pause"]
  ];

  const filtered = data.objectives.filter(objective => {
    if (allFilter === "all") return objective.status !== "cancelled";
    if (allFilter === "active") return objective.status === "active" || !objective.status;
    return objective.status === allFilter;
  });

  shell.innerHTML = `
    ${tabs("all")}

    <section class="objectives-section">
      <div class="objectives-section-head">
        <div>
          <h2>Tous les objectifs</h2>
          <p>${data.objectives.filter(o => o.status !== "cancelled").length} objectif${data.objectives.filter(o => o.status !== "cancelled").length > 1 ? "s" : ""}</p>
        </div>
        <button class="primary-btn" id="objective-all-add">+ Objectif</button>
      </div>

      <div class="objective-filter-row">
        ${filters.map(([key,label]) => `
          <button class="objective-filter ${allFilter === key ? "active" : ""}" data-objective-filter="${key}">${label}</button>
        `).join("")}
      </div>

      <div class="objectives-list" style="margin-top:12px">
        ${
          filtered.length
            ? filtered.map(o => objectiveCard(o, data.milestones)).join("")
            : `<div class="objective-empty"><h3>Aucun résultat</h3><p>Aucun objectif dans ce filtre.</p></div>`
        }
      </div>
    </section>
  `;

  bindTabs(shell);
  bindObjectiveCards(shell);

  shell.querySelector("#objective-all-add").addEventListener("click", () => showObjectiveModal());

  shell.querySelectorAll("[data-objective-filter]").forEach(btn => {
    btn.addEventListener("click", async () => {
      allFilter = btn.dataset.objectiveFilter;
      await renderAll(shell);
    });
  });
}

async function renderStats(shell) {
  const data = await getObjectivesData();
  const visible = data.objectives.filter(o => o.status !== "cancelled");
  const active = visible.filter(o => o.status !== "completed");
  const completed = visible.filter(o => o.status === "completed");
  const behind = active.filter(o => {
    const state = objectiveState(o, data.milestones);
    return state.key === "behind" || state.key === "late";
  });
  const avg = active.length
    ? Math.round(active.reduce((sum,o) => sum + progressFor(o, data.milestones), 0) / active.length)
    : 0;

  const byCategory = {};
  visible.forEach(o => {
    const category = o.category || "Personnel";
    byCategory[category] = (byCategory[category] || 0) + 1;
  });

  shell.innerHTML = `
    ${tabs("stats")}

    <section class="objectives-section">
      <div class="objectives-section-head">
        <div>
          <h2>Vue d'ensemble</h2>
          <p>État de tes objectifs personnels.</p>
        </div>
      </div>

      <div class="objective-stat-card">
        <div class="objective-stat-row"><span>Objectifs actifs</span><strong>${active.length}</strong></div>
        <div class="objective-stat-row"><span>Progression moyenne</span><strong>${avg} %</strong></div>
        <div class="objective-stat-row"><span>À surveiller</span><strong>${behind.length}</strong></div>
        <div class="objective-stat-row"><span>Terminés</span><strong>${completed.length}</strong></div>
      </div>
    </section>

    <section class="objectives-section">
      <div class="objectives-section-head">
        <div>
          <h2>Par catégorie</h2>
          <p>Répartition de tes objectifs.</p>
        </div>
      </div>

      <div class="objectives-list">
        ${
          Object.keys(byCategory).length
            ? Object.entries(byCategory)
                .sort((a,b) => b[1] - a[1])
                .map(([category,count]) => `
                  <div class="objective-stat-card">
                    <div class="objective-stat-row">
                      <span>${escapeHtml(category)}</span>
                      <strong>${count}</strong>
                    </div>
                  </div>
                `).join("")
            : `<div class="objective-empty"><h3>Aucune donnée</h3><p>Les statistiques apparaîtront avec tes objectifs.</p></div>`
        }
      </div>
    </section>
  `;

  bindTabs(shell);
}

async function renderDetail(shell, objectiveId) {
  const data = await getObjectivesData();
  const objective = data.objectives.find(o => o.id === objectiveId);

  if (!objective) {
    currentView = "active";
    currentObjectiveId = null;
    await renderCurrentView();
    return;
  }

  const linked = data.milestones.filter(m => m.objectiveId === objective.id);
  const actions = data.actions.filter(a => a.objectiveId === objective.id && a.active !== false);
  const objectiveTasks = data.tasks.filter(t => t.objectiveId === objective.id);
  const taskStats = await getObjectiveTaskStats(objective.id);

  const progress = progressFor(objective, data.milestones);
  const expected = expectedProgress(objective);
  const state = objectiveState(objective, data.milestones);

  shell.innerHTML = `
    <button class="stock-back" id="objective-detail-back">‹ Objectifs</button>

    <div class="objective-detail-top">
      <span class="eyebrow" style="color:#d0d5dd">${escapeHtml(objective.category || "PERSONNEL")}</span>
      <h2>${escapeHtml(objective.title)}</h2>
      <p>${objective.targetDate ? `Échéance ${formatDate(objective.targetDate)}` : "Sans échéance"} · ${priorityLabel(objective.priority)}</p>

      <div class="objective-progress-wrap">
        <div class="objective-progress-meta" style="color:#d0d5dd">
          <span>Progression</span>
          <span>${progress} %</span>
        </div>
        <div class="objective-progress"><i style="width:${progress}%;background:#fff"></i></div>
      </div>

      <div class="objective-detail-actions">
        <button class="ghost-btn" id="objective-edit">Modifier</button>
        ${
          objective.status === "completed"
            ? `<button class="ghost-btn" id="objective-reopen">Réouvrir</button>`
            : `<button class="primary-btn" id="objective-complete">Marquer terminé</button>`
        }
      </div>
    </div>

    <section class="objective-detail-card" style="margin-top:12px">
      <div class="objective-detail-head">
        <div>
          <h3>Progression</h3>
          <p class="muted" style="margin:4px 0 0">${progressModeLabel(objective.progressMode)}</p>
        </div>
        <span class="objective-status ${state.key}">${state.label}</span>
      </div>

      ${
        objective.progressMode === "numeric"
          ? `
            <div class="objective-metrics">
              <div class="objective-metric">
                <span>Départ</span>
                <strong>${numericLabel(objective, objective.startValue)}</strong>
              </div>
              <div class="objective-metric">
                <span>Actuel</span>
                <strong>${numericLabel(objective, objective.currentValue)}</strong>
              </div>
              <div class="objective-metric">
                <span>Cible</span>
                <strong>${numericLabel(objective, objective.targetValue)}</strong>
              </div>
            </div>
            <button class="ghost-btn" id="objective-update-progress" style="margin-top:12px">Mettre à jour la valeur</button>
          `
          : objective.progressMode === "manual"
            ? `
              <div class="objective-metrics">
                <div class="objective-metric">
                  <span>Progression actuelle</span>
                  <strong>${progress} %</strong>
                </div>
                ${
                  expected !== null
                    ? `<div class="objective-metric"><span>Jalon théorique</span><strong>${expected} %</strong></div>`
                    : ""
                }
                <div class="objective-metric">
                  <span>Échéance</span>
                  <strong>${formatDate(objective.targetDate)}</strong>
                </div>
              </div>
              <button class="ghost-btn" id="objective-update-progress" style="margin-top:12px">Mettre à jour le pourcentage</button>
            `
            : `
              <div class="objective-metrics">
                <div class="objective-metric">
                  <span>Jalons terminés</span>
                  <strong>${linked.filter(m => m.done).length}/${linked.length}</strong>
                </div>
                <div class="objective-metric">
                  <span>Progression</span>
                  <strong>${progress} %</strong>
                </div>
                <div class="objective-metric">
                  <span>Échéance</span>
                  <strong>${formatDate(objective.targetDate)}</strong>
                </div>
              </div>
            `
      }
    </section>

    ${
      objective.description
        ? `
          <section class="objective-detail-card" style="margin-top:12px">
            <h3>Description</h3>
            <p class="muted" style="margin:8px 0 0;line-height:1.55">${escapeHtml(objective.description)}</p>
          </section>
        `
        : ""
    }

    <section class="objective-detail-card objective-task-summary" style="margin-top:12px">
      <div class="objective-detail-head">
        <div>
          <h3>Actions & tâches</h3>
          <p class="muted" style="margin:4px 0 0">Les tâches générées restent liées à cet objectif.</p>
        </div>
        <button class="ghost-btn" id="objective-open-tasks">Voir les tâches</button>
      </div>

      <div class="objective-metrics">
        <div class="objective-metric">
          <span>Cette semaine</span>
          <strong>${taskStats.weekDone}/${taskStats.weekTotal}</strong>
        </div>
        <div class="objective-metric">
          <span>Aujourd'hui</span>
          <strong>${taskStats.dueToday}</strong>
        </div>
        <div class="objective-metric">
          <span>En retard</span>
          <strong>${taskStats.late}</strong>
        </div>
      </div>
    </section>

    <section class="objective-detail-card" style="margin-top:12px">
      <div class="objective-detail-head">
        <div>
          <h3>Jalons</h3>
          <p class="muted" style="margin:4px 0 0">Chaque jalon peut devenir une tâche synchronisée.</p>
        </div>
        <button class="primary-btn" id="objective-add-milestone">+ Jalon</button>
      </div>

      <div class="objective-milestones">
        ${
          linked.length
            ? linked.map(m => {
                const linkedTask = objectiveTasks.find(t => t.milestoneId === m.id);

                return `
                  <div class="objective-milestone">
                    <button class="objective-milestone-toggle ${m.done ? "done" : ""}" data-toggle-milestone="${m.id}">
                      ${m.done ? "✓" : ""}
                    </button>

                    <div class="objective-milestone-main">
                      <strong>${escapeHtml(m.title)}</strong>
                      <small>
                        ${m.dueDate ? `Échéance ${formatDate(m.dueDate)}` : "Sans échéance"}
                        ${linkedTask ? " · tâche liée" : ""}
                      </small>
                    </div>

                    <button class="objective-task-link-btn ${linkedTask ? "linked" : ""}" data-milestone-task="${m.id}">
                      ${linkedTask ? "✓ Tâche" : "→ Tâche"}
                    </button>

                    <button class="icon-btn" data-edit-milestone="${m.id}" aria-label="Modifier">✎</button>
                    <button class="icon-btn" data-delete-milestone="${m.id}" aria-label="Supprimer">×</button>
                  </div>
                `;
              }).join("")
            : `<div class="objective-empty"><h3>Aucun jalon</h3><p>Découpe cet objectif en étapes concrètes.</p></div>`
        }
      </div>
    </section>

    <section class="objective-detail-card" style="margin-top:12px">
      <div class="objective-detail-head">
        <div>
          <h3>Actions récurrentes</h3>
          <p class="muted" style="margin:4px 0 0">MyHub prépare automatiquement 30 jours de tâches à l'avance.</p>
        </div>
        <button class="primary-btn" id="objective-add-action">+ Action</button>
      </div>

      <div class="objective-action-list">
        ${
          actions.length
            ? actions.map(action => {
                const generated = objectiveTasks.filter(t => t.objectiveActionId === action.id);
                const completed = generated.filter(t => t.done).length;

                return `
                  <article class="objective-action-card">
                    <div class="objective-action-head">
                      <div>
                        <strong>${escapeHtml(action.title)}</strong>
                        <small>${escapeHtml(actionFrequencyLabel(action))} · ${escapeHtml(actionDateRangeLabel(action))}</small>
                      </div>

                      <div class="objective-action-buttons">
                        <button class="icon-btn" data-edit-action="${action.id}" aria-label="Modifier">✎</button>
                        <button class="icon-btn" data-delete-action="${action.id}" aria-label="Supprimer">×</button>
                      </div>
                    </div>

                    <div class="objective-action-meta">
                      <span>${generated.length} tâche${generated.length > 1 ? "s" : ""} préparée${generated.length > 1 ? "s" : ""}</span>
                      <span>${completed} terminée${completed > 1 ? "s" : ""}</span>
                      ${action.reminderTime ? `<span>Rappel ${escapeHtml(action.reminderTime)}</span>` : ""}
                    </div>
                  </article>
                `;
              }).join("")
            : `
              <div class="objective-empty">
                <h3>Aucune action récurrente</h3>
                <p>Exemple : anglais lundi, mercredi et vendredi jusqu'à l'échéance.</p>
              </div>
            `
        }
      </div>
    </section>

    <button class="danger-btn" id="objective-delete" style="margin-top:12px;width:100%">Supprimer cet objectif</button>
  `;

  shell.querySelector("#objective-detail-back").addEventListener("click", async () => {
    currentView = "active";
    currentObjectiveId = null;
    await renderCurrentView();
  });

  shell.querySelector("#objective-edit").addEventListener("click", () => showObjectiveModal(objective.id));

  shell.querySelector("#objective-open-tasks").addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "tasks" }));
  });

  const complete = shell.querySelector("#objective-complete");
  if (complete) {
    complete.addEventListener("click", async () => {
      await putOne("objectives", {
        ...objective,
        status: "completed",
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await deleteFutureObjectiveActionTasks(objective.id);

      window.dispatchEvent(new CustomEvent("myhub:data-changed"));
      await renderDetail(shell, objective.id);
    });
  }

  const reopen = shell.querySelector("#objective-reopen");
  if (reopen) {
    reopen.addEventListener("click", async () => {
      await putOne("objectives", {
        ...objective,
        status: "active",
        completedAt: null,
        updatedAt: new Date().toISOString()
      });

      await syncRecurringObjectiveTasks(30);

      window.dispatchEvent(new CustomEvent("myhub:data-changed"));
      await renderDetail(shell, objective.id);
    });
  }

  const update = shell.querySelector("#objective-update-progress");
  if (update) update.addEventListener("click", () => showProgressModal(objective));

  shell.querySelector("#objective-add-milestone").addEventListener("click", () => showMilestoneModal(objective.id));

  shell.querySelectorAll("[data-toggle-milestone]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const milestone = linked.find(m => m.id === btn.dataset.toggleMilestone);
      if (!milestone) return;

      const updatedMilestone = {
        ...milestone,
        done: !milestone.done,
        completedAt: !milestone.done ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString()
      };

      await putOne("objectiveMilestones", updatedMilestone);
      await syncTaskFromMilestone(updatedMilestone);

      window.dispatchEvent(new CustomEvent("myhub:data-changed"));
      await renderDetail(shell, objective.id);
    });
  });

  shell.querySelectorAll("[data-milestone-task]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const milestone = linked.find(m => m.id === btn.dataset.milestoneTask);
      if (!milestone) return;

      await createOrUpdateTaskFromMilestone(milestone, objective);

      window.dispatchEvent(new CustomEvent("myhub:data-changed"));
      await renderDetail(shell, objective.id);
    });
  });

  shell.querySelectorAll("[data-edit-milestone]").forEach(btn => {
    btn.addEventListener("click", () => showMilestoneModal(objective.id, btn.dataset.editMilestone));
  });

  shell.querySelectorAll("[data-delete-milestone]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const milestone = linked.find(m => m.id === btn.dataset.deleteMilestone);
      if (!milestone) return;

      if (!confirm(`Supprimer le jalon "${milestone.title}" et sa tâche liée éventuelle ?`)) return;

      await deleteLinkedTaskForMilestone(milestone.id);
      await deleteOne("objectiveMilestones", milestone.id);

      window.dispatchEvent(new CustomEvent("myhub:data-changed"));
      await renderDetail(shell, objective.id);
    });
  });

  shell.querySelector("#objective-add-action").addEventListener("click", () => showActionModal(objective.id));

  shell.querySelectorAll("[data-edit-action]").forEach(btn => {
    btn.addEventListener("click", () => showActionModal(objective.id, btn.dataset.editAction));
  });

  shell.querySelectorAll("[data-delete-action]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const action = actions.find(a => a.id === btn.dataset.deleteAction);
      if (!action) return;

      if (!confirm(`Supprimer l'action récurrente "${action.title}" ? Les futures tâches non terminées seront supprimées.`)) return;

      await deleteFutureTasksForAction(action.id);
      await deleteOne("objectiveActions", action.id);

      window.dispatchEvent(new CustomEvent("myhub:data-changed"));
      await renderDetail(shell, objective.id);
    });
  });

  shell.querySelector("#objective-delete").addEventListener("click", async () => {
    if (!confirm(`Supprimer définitivement l'objectif "${objective.title}", ses jalons, ses actions et ses tâches générées ?`)) return;

    for (const milestone of linked) {
      await deleteOne("objectiveMilestones", milestone.id);
    }

    for (const action of actions) {
      await deleteOne("objectiveActions", action.id);
    }

    await deleteAllObjectiveLinkedTasks(objective.id);
    await deleteOne("objectives", objective.id);

    window.dispatchEvent(new CustomEvent("myhub:data-changed"));

    currentObjectiveId = null;
    currentView = "active";
    await renderCurrentView();
  });
}

async function showObjectiveModal(objectiveId = null, preset = {}) {
  const [objectives, projects] = await Promise.all([getAll("objectives"), getAll("projects")]);
  const objective = objectives.find(o => o.id === objectiveId);
  const activeProjects = projects.filter(project => project.active !== false && (project.status || "active") !== "completed");

  const defaultTarget = (() => {
    const date = new Date();
    date.setMonth(date.getMonth() + 6);
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000).toISOString().slice(0,10);
  })();

  openModal(`
    <div class="modal-head">
      <div>
        <p class="eyebrow">OBJECTIFS</p>
        <h2>${objective ? "Modifier" : "Nouvel"} objectif</h2>
      </div>
      <button class="icon-btn" id="objective-modal-close">×</button>
    </div>

    <form class="form-grid" id="objective-form">
      <div class="field">
        <label>Objectif</label>
        <input name="title" required maxlength="120" value="${escapeHtml(objective?.title || preset.title || "")}" placeholder="Ex : Atteindre un niveau B2 en anglais">
      </div>

      <div class="field">
        <label>Catégorie</label>
        <input name="category" maxlength="60" value="${escapeHtml(objective?.category || preset.category || "")}" placeholder="Ex : Langues, Finance, Personnel, Sport...">
      </div>

      <div class="field">
        <label>Description</label>
        <textarea name="description" placeholder="Pourquoi cet objectif et ce que tu veux obtenir...">${escapeHtml(objective?.description || preset.description || "")}</textarea>
      </div>

      <div class="row">
        <div class="field">
          <label>Priorité</label>
          <select name="priority">
            <option value="low" ${objective?.priority === "low" ? "selected" : ""}>Basse</option>
            <option value="medium" ${!objective || objective?.priority === "medium" ? "selected" : ""}>Normale</option>
            <option value="high" ${objective?.priority === "high" ? "selected" : ""}>Haute</option>
          </select>
        </div>

        <div class="field">
          <label>Statut</label>
          <select name="status">
            <option value="active" ${!objective || objective?.status === "active" ? "selected" : ""}>Actif</option>
            <option value="paused" ${objective?.status === "paused" ? "selected" : ""}>En pause</option>
            <option value="completed" ${objective?.status === "completed" ? "selected" : ""}>Terminé</option>
          </select>
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>Date de départ</label>
          <input type="date" name="startDate" value="${objective?.startDate || preset.startDate || todayISO()}">
        </div>

        <div class="field">
          <label>Échéance</label>
          <input type="date" name="targetDate" value="${objective?.targetDate || preset.targetDate || defaultTarget}">
        </div>
      </div>

      <div class="field">
        <label>Projet lié</label>
        <select name="projectId">
          <option value="">Aucun projet</option>
          ${activeProjects.map(project => `<option value="${project.id}" ${(objective?.projectId || preset.projectId || "") === project.id ? "selected" : ""}>${escapeHtml(project.title)}</option>`).join("")}
        </select>
      </div>

      <div class="field">
        <label>Comment mesurer la progression ?</label>
        <select name="progressMode" id="objective-progress-mode">
          <option value="manual" ${!objective || objective?.progressMode === "manual" ? "selected" : ""}>Pourcentage manuel</option>
          <option value="numeric" ${objective?.progressMode === "numeric" ? "selected" : ""}>Valeur chiffrée</option>
          <option value="milestones" ${objective?.progressMode === "milestones" ? "selected" : ""}>Jalons terminés</option>
        </select>
      </div>

      <div id="objective-manual-fields">
        <div class="field">
          <label>Progression actuelle (%)</label>
          <input type="number" name="manualProgress" min="0" max="100" step="1" value="${objective?.manualProgress ?? 0}">
        </div>
      </div>

      <div id="objective-numeric-fields">
        <div class="row">
          <div class="field">
            <label>Valeur départ</label>
            <input type="number" name="startValue" step="0.01" value="${objective?.startValue ?? ""}" placeholder="0">
          </div>
          <div class="field">
            <label>Valeur actuelle</label>
            <input type="number" name="currentValue" step="0.01" value="${objective?.currentValue ?? ""}" placeholder="0">
          </div>
        </div>

        <div class="row">
          <div class="field">
            <label>Valeur cible</label>
            <input type="number" name="targetValue" step="0.01" value="${objective?.targetValue ?? ""}" placeholder="100">
          </div>
          <div class="field">
            <label>Unité</label>
            <input name="unit" maxlength="20" value="${escapeHtml(objective?.unit || "")}" placeholder="€, h, pages...">
          </div>
        </div>
      </div>

      <div class="objective-form-note" id="objective-mode-note"></div>

      <div class="actions">
        <button type="button" class="ghost-btn" id="objective-modal-cancel">Annuler</button>
        <button class="primary-btn" type="submit">Enregistrer</button>
      </div>
    </form>
  `);

  const mode = document.querySelector("#objective-progress-mode");
  const manualFields = document.querySelector("#objective-manual-fields");
  const numericFields = document.querySelector("#objective-numeric-fields");
  const note = document.querySelector("#objective-mode-note");

  function updateModeUI() {
    const value = mode.value;
    manualFields.style.display = value === "manual" ? "block" : "none";
    numericFields.style.display = value === "numeric" ? "block" : "none";

    if (value === "milestones") {
      note.textContent = "La progression sera calculée automatiquement selon le nombre de jalons terminés.";
    } else if (value === "numeric") {
      note.textContent = "MyHub calcule automatiquement la progression entre la valeur de départ et la valeur cible.";
    } else {
      note.textContent = "Tu mets à jour toi-même le pourcentage lorsque l'objectif avance.";
    }
  }

  updateModeUI();
  mode.addEventListener("change", updateModeUI);

  document.querySelector("#objective-modal-close").addEventListener("click", closeModal);
  document.querySelector("#objective-modal-cancel").addEventListener("click", closeModal);

  document.querySelector("#objective-form").addEventListener("submit", async event => {
    event.preventDefault();

    const fd = new FormData(event.target);
    const progressMode = String(fd.get("progressMode"));
    const status = String(fd.get("status") || "active");

    const saved = {
      ...(objective || {}),
      id: objective?.id || uid("objective"),
      title: String(fd.get("title") || "").trim(),
      category: String(fd.get("category") || "").trim(),
      description: String(fd.get("description") || "").trim(),
      priority: String(fd.get("priority") || "medium"),
      status,
      startDate: String(fd.get("startDate") || todayISO()),
      targetDate: String(fd.get("targetDate") || ""),
      projectId: String(fd.get("projectId") || "") || null,
      progressMode,
      manualProgress: clamp(fd.get("manualProgress") || 0),
      startValue: Number(fd.get("startValue") || 0),
      currentValue: Number(fd.get("currentValue") || 0),
      targetValue: Number(fd.get("targetValue") || 0),
      unit: String(fd.get("unit") || "").trim(),
      createdDate: objective?.createdDate || todayISO(),
      createdAt: objective?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: status === "completed"
        ? (objective?.completedAt || new Date().toISOString())
        : null
    };

    await putOne("objectives", saved);

    const linkedMilestones = (await getAll("objectiveMilestones"))
      .filter(m => m.objectiveId === saved.id);

    for (const linkedMilestone of linkedMilestones) {
      await syncTaskFromMilestone(linkedMilestone);
    }

    if (saved.status === "active") {
      await syncRecurringObjectiveTasks(30);
    } else {
      await deleteFutureObjectiveActionTasks(saved.id);
    }

    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));

    currentObjectiveId = saved.id;
    currentView = "detail";
    await renderCurrentView();
  });
}

async function showProgressModal(objective) {
  const numeric = objective.progressMode === "numeric";

  openModal(`
    <div class="modal-head">
      <div>
        <p class="eyebrow">PROGRESSION</p>
        <h2>${escapeHtml(objective.title)}</h2>
      </div>
      <button class="icon-btn" id="objective-progress-close">×</button>
    </div>

    <form class="form-grid" id="objective-progress-form">
      ${
        numeric
          ? `
            <div class="field">
              <label>Valeur actuelle ${objective.unit ? `(${escapeHtml(objective.unit)})` : ""}</label>
              <input type="number" name="value" step="0.01" value="${objective.currentValue ?? 0}" required>
            </div>
            <div class="objective-form-note">
              Départ : ${numericLabel(objective, objective.startValue)} · Cible : ${numericLabel(objective, objective.targetValue)}
            </div>
          `
          : `
            <div class="field">
              <label>Progression actuelle (%)</label>
              <input type="number" name="value" min="0" max="100" step="1" value="${objective.manualProgress ?? 0}" required>
            </div>
          `
      }

      <div class="actions">
        <button type="button" class="ghost-btn" id="objective-progress-cancel">Annuler</button>
        <button class="primary-btn" type="submit">Mettre à jour</button>
      </div>
    </form>
  `);

  document.querySelector("#objective-progress-close").addEventListener("click", closeModal);
  document.querySelector("#objective-progress-cancel").addEventListener("click", closeModal);

  document.querySelector("#objective-progress-form").addEventListener("submit", async event => {
    event.preventDefault();

    const value = Number(new FormData(event.target).get("value"));

    await putOne("objectives", {
      ...objective,
      ...(numeric
        ? { currentValue: value }
        : { manualProgress: clamp(value) }),
      updatedAt: new Date().toISOString()
    });

    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrentView();
  });
}

async function showMilestoneModal(objectiveId, milestoneId = null) {
  const milestones = await getAll("objectiveMilestones");
  const milestone = milestones.find(m => m.id === milestoneId);
  const linked = milestones.filter(m => m.objectiveId === objectiveId);

  openModal(`
    <div class="modal-head">
      <div>
        <p class="eyebrow">JALON</p>
        <h2>${milestone ? "Modifier" : "Nouveau"} jalon</h2>
      </div>
      <button class="icon-btn" id="milestone-close">×</button>
    </div>

    <form class="form-grid" id="milestone-form">
      <div class="field">
        <label>Étape</label>
        <input name="title" required maxlength="120" value="${escapeHtml(milestone?.title || "")}" placeholder="Ex : Terminer le premier niveau">
      </div>

      <div class="field">
        <label>Échéance</label>
        <input type="date" name="dueDate" value="${milestone?.dueDate || ""}">
      </div>

      <div class="actions">
        <button type="button" class="ghost-btn" id="milestone-cancel">Annuler</button>
        <button class="primary-btn" type="submit">Enregistrer</button>
      </div>
    </form>
  `);

  document.querySelector("#milestone-close").addEventListener("click", closeModal);
  document.querySelector("#milestone-cancel").addEventListener("click", closeModal);

  document.querySelector("#milestone-form").addEventListener("submit", async event => {
    event.preventDefault();

    const fd = new FormData(event.target);

    const savedMilestone = {
      ...(milestone || {}),
      id: milestone?.id || uid("objective_milestone"),
      objectiveId,
      title: String(fd.get("title") || "").trim(),
      dueDate: String(fd.get("dueDate") || ""),
      done: milestone?.done || false,
      order: milestone?.order ?? linked.length + 1,
      createdAt: milestone?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await putOne("objectiveMilestones", savedMilestone);
    await syncTaskFromMilestone(savedMilestone);

    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrentView();
  });
}

async function showActionModal(objectiveId, actionId = null) {
  const [objective, actions] = await Promise.all([
    getOne("objectives", objectiveId),
    getAll("objectiveActions")
  ]);

  if (!objective) return;

  const action = actions.find(a => a.id === actionId);
  const selectedDays = new Set(
    Array.isArray(action?.daysOfWeek)
      ? action.daysOfWeek.map(Number)
      : [1, 3, 5]
  );

  openModal(`
    <div class="modal-head">
      <div>
        <p class="eyebrow">ACTION RÉCURRENTE</p>
        <h2>${action ? "Modifier" : "Nouvelle"} action</h2>
      </div>
      <button class="icon-btn" id="objective-action-close">×</button>
    </div>

    <form class="form-grid" id="objective-action-form">
      <div class="objective-form-note">
        Les tâches sont générées localement sur 30 jours glissants. À chaque ouverture de MyHub, les prochaines occurrences sont préparées automatiquement.
      </div>

      <div class="field">
        <label>Action</label>
        <input
          name="title"
          required
          maxlength="120"
          value="${escapeHtml(action?.title || "")}"
          placeholder="Ex : Anglais 30 min"
        >
      </div>

      <div class="field">
        <label>Description</label>
        <textarea name="description" placeholder="Ex : Session vocabulaire + compréhension orale">${escapeHtml(action?.description || "")}</textarea>
      </div>

      <div class="field">
        <label>Dossier Tâches</label>
        <input
          name="folder"
          maxlength="60"
          value="${escapeHtml(action?.folder || "")}"
          placeholder="${escapeHtml(objective.category || "Objectifs")}"
        >
      </div>

      <div class="field">
        <label>Rythme</label>
        <select name="frequency" id="objective-action-frequency">
          <option value="daily" ${action?.frequency === "daily" ? "selected" : ""}>Tous les jours</option>
          <option value="weekly" ${!action || action?.frequency === "weekly" ? "selected" : ""}>Une fois par semaine</option>
          <option value="custom" ${action?.frequency === "custom" ? "selected" : ""}>Jours choisis</option>
        </select>
      </div>

      <div class="field" id="objective-action-weekly">
        <label>Jour de la semaine</label>
        <select name="weekday">
          ${[
            [1,"Lundi"],
            [2,"Mardi"],
            [3,"Mercredi"],
            [4,"Jeudi"],
            [5,"Vendredi"],
            [6,"Samedi"],
            [0,"Dimanche"]
          ].map(([value,label]) => `
            <option value="${value}" ${Number(action?.weekday ?? 1) === value ? "selected" : ""}>${label}</option>
          `).join("")}
        </select>
      </div>

      <div class="field" id="objective-action-custom">
        <label>Jours choisis</label>
        <div class="objective-day-picker">
          ${[
            [1,"Lun"],
            [2,"Mar"],
            [3,"Mer"],
            [4,"Jeu"],
            [5,"Ven"],
            [6,"Sam"],
            [0,"Dim"]
          ].map(([value,label]) => `
            <label class="objective-day-chip">
              <input
                type="checkbox"
                name="daysOfWeek"
                value="${value}"
                ${selectedDays.has(value) ? "checked" : ""}
              >
              <span>${label}</span>
            </label>
          `).join("")}
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>Date de départ</label>
          <input
            type="date"
            name="startDate"
            value="${action?.startDate || todayISO()}"
            required
          >
        </div>

        <div class="field">
          <label>Date de fin</label>
          <input
            type="date"
            name="endDate"
            value="${action?.endDate || objective.targetDate || ""}"
          >
        </div>
      </div>

      <div class="field">
        <label>Heure de rappel (optionnel)</label>
        <input
          type="time"
          name="reminderTime"
          value="${escapeHtml(action?.reminderTime || "")}"
        >
      </div>

      <div class="actions">
        <button type="button" class="ghost-btn" id="objective-action-cancel">Annuler</button>
        <button class="primary-btn" type="submit">Enregistrer</button>
      </div>
    </form>
  `);

  const frequency = document.querySelector("#objective-action-frequency");
  const weekly = document.querySelector("#objective-action-weekly");
  const custom = document.querySelector("#objective-action-custom");

  function refreshFrequency() {
    weekly.style.display = frequency.value === "weekly" ? "grid" : "none";
    custom.style.display = frequency.value === "custom" ? "grid" : "none";
  }

  refreshFrequency();
  frequency.addEventListener("change", refreshFrequency);

  document.querySelector("#objective-action-close").addEventListener("click", closeModal);
  document.querySelector("#objective-action-cancel").addEventListener("click", closeModal);

  document.querySelector("#objective-action-form").addEventListener("submit", async event => {
    event.preventDefault();

    const fd = new FormData(event.target);
    const frequencyValue = String(fd.get("frequency") || "weekly");
    const daysOfWeek = fd.getAll("daysOfWeek").map(Number);

    if (frequencyValue === "custom" && !daysOfWeek.length) {
      alert("Choisis au moins un jour.");
      return;
    }

    const startDate = String(fd.get("startDate") || todayISO());
    const endDate = String(fd.get("endDate") || "");

    if (endDate && endDate < startDate) {
      alert("La date de fin doit être postérieure à la date de départ.");
      return;
    }

    const savedAction = {
      ...(action || {}),
      id: action?.id || uid("objective_action"),
      objectiveId,
      title: String(fd.get("title") || "").trim(),
      description: String(fd.get("description") || "").trim(),
      folder: String(fd.get("folder") || "").trim(),
      frequency: frequencyValue,
      weekday: Number(fd.get("weekday") ?? 1),
      daysOfWeek,
      startDate,
      endDate,
      reminderTime: String(fd.get("reminderTime") || ""),
      active: true,
      createdAt: action?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await putOne("objectiveActions", savedAction);
    await syncRecurringObjectiveTasks(30);

    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrentView();
  });
}

export async function getObjectivesSummary() {
  const data = await getObjectivesData();
  const active = data.objectives.filter(o =>
    o.status !== "completed" &&
    o.status !== "cancelled"
  );

  const completed = data.objectives.filter(o => o.status === "completed");

  const behind = active.filter(o => {
    const state = objectiveState(o, data.milestones);
    return state.key === "behind" || state.key === "late";
  });

  const dueSoon = active.filter(o => {
    const days = daysUntil(o.targetDate);
    return days !== null && days >= 0 && days <= 30;
  });

  const averageProgress = active.length
    ? Math.round(active.reduce((sum,o) => sum + progressFor(o, data.milestones), 0) / active.length)
    : 0;

  return {
    active: active.length,
    completed: completed.length,
    behind: behind.length,
    dueSoon: dueSoon.length,
    averageProgress
  };
}
