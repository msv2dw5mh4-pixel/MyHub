import { getAll, putOne, deleteOne } from "../core/db.js";
import { escapeHtml, uid, openModal, closeModal, todayISO } from "../core/ui.js";
import { showAddTaskModal } from "./tasks.js";
import { requestNewDocument } from "./documents.js";
import { requestNewBudgetEntry } from "./budget.js";
import { requestNewObjective } from "./objectives.js";
import { requestNewPlanningEvent } from "./planning.js";
import { requestNewLearningTopic } from "./learning.js";
import { requestNewIdea } from "./ideas.js";

let currentView = "active";
let currentProjectId = null;
let projectFilter = "all";
let lastContainer = null;

export async function renderProjects(container) {
  lastContainer = container;
  container.innerHTML = `<section class="projects-shell" id="projects-shell"></section>`;
  await renderCurrentView();
}

export function requestNewProject(preset = {}) {
  currentView = "active";
  window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "projects" }));
  setTimeout(() => showProjectModal(null, preset), 120);
}

function tabs(active) {
  return `
    <div class="projects-tabs">
      <button class="projects-tab ${active === "active" ? "active" : ""}" data-project-view="active">En cours</button>
      <button class="projects-tab ${active === "all" ? "active" : ""}" data-project-view="all">Tous</button>
      <button class="projects-tab ${active === "stats" ? "active" : ""}" data-project-view="stats">Stats</button>
    </div>
  `;
}

function bindTabs(shell) {
  shell.querySelectorAll("[data-project-view]").forEach(btn => {
    btn.addEventListener("click", async () => {
      currentView = btn.dataset.projectView;
      currentProjectId = null;
      await renderCurrentView();
    });
  });
}

async function getData() {
  const [projects, tasks, documents, transactions, objectives, events, learningTopics, ideas] = await Promise.all([
    getAll("projects"),
    getAll("tasks"),
    getAll("documents"),
    getAll("budgetTransactions"),
    getAll("objectives"),
    getAll("calendarEvents"),
    getAll("learningTopics"),
    getAll("ideas")
  ]);

  return {
    projects: [...projects].filter(p => p.active !== false).sort((a,b) => String(a.targetDate || "9999-12-31").localeCompare(String(b.targetDate || "9999-12-31")) || String(a.title || "").localeCompare(String(b.title || ""))),
    tasks,
    documents: documents.filter(doc => doc.active !== false),
    transactions,
    objectives: objectives.filter(objective => objective.status !== "cancelled"),
    events,
    learningTopics: learningTopics.filter(topic => topic.active !== false),
    ideas
  };
}

function formatMoney(value) {
  return new Intl.NumberFormat("fr-FR", { style:"currency", currency:"EUR", minimumFractionDigits:0, maximumFractionDigits:2 }).format(Number(value) || 0);
}

function formatDate(date) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day:"numeric", month:"short", year:"numeric" }).format(new Date(`${date}T12:00:00`));
}

function statusLabel(status) {
  if (status === "completed") return "Terminé";
  if (status === "paused") return "En pause";
  return "En cours";
}

function statusClass(status) {
  if (status === "completed") return "completed";
  if (status === "paused") return "paused";
  return "active";
}

function projectStats(project, data) {
  const tasks = data.tasks.filter(task => task.projectId === project.id);
  const doneTasks = tasks.filter(task => task.done).length;
  const documents = data.documents.filter(doc => doc.projectId === project.id);
  const transactions = data.transactions.filter(tx => tx.projectId === project.id);
  const objectives = data.objectives.filter(objective => objective.projectId === project.id);
  const events = data.events.filter(event => event.projectId === project.id);
  const learningTopics = data.learningTopics.filter(topic => topic.projectId === project.id);
  const ideas = data.ideas.filter(idea => idea.projectId === project.id && idea.status !== "archived");

  const expenses = transactions.filter(tx => tx.type === "expense").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const income = transactions.filter(tx => tx.type === "income").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const savings = transactions.filter(tx => tx.type === "saving").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

  let progress = Number(project.manualProgress || 0);
  if (tasks.length) progress = Math.round((doneTasks / tasks.length) * 100);
  else if (project.status === "completed") progress = 100;

  const openTasks = tasks.filter(task => !task.done);
  const nextTask = [...openTasks].filter(task => task.dueDate).sort((a,b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0];

  return {
    tasks,
    doneTasks,
    documents,
    transactions,
    objectives,
    events,
    learningTopics,
    ideas,
    expenses,
    income,
    savings,
    progress: Math.max(0, Math.min(100, progress)),
    nextTask
  };
}

function projectCard(project, data) {
  const stats = projectStats(project, data);
  return `
    <article class="projects-card" data-project-id="${project.id}">
      <div class="projects-card-head">
        <div>
          <h3>${escapeHtml(project.title)}</h3>
          <p>${escapeHtml(project.category || "Projet")}${project.targetDate ? ` · échéance ${formatDate(project.targetDate)}` : ""}</p>
          <span class="projects-status ${statusClass(project.status)}">${statusLabel(project.status)}</span>
        </div>
        <strong>${stats.progress} %</strong>
      </div>

      <div class="projects-progress"><i style="width:${stats.progress}%"></i></div>

      <div class="projects-metrics">
        <div class="projects-metric"><span>Tâches</span><strong>${stats.doneTasks}/${stats.tasks.length}</strong></div>
        <div class="projects-metric"><span>Budget dépensé</span><strong>${formatMoney(stats.expenses)}</strong></div>
        <div class="projects-metric"><span>Documents</span><strong>${stats.documents.length}</strong></div>
        <div class="projects-metric"><span>Objectifs</span><strong>${stats.objectives.length}</strong></div>
        <div class="projects-metric"><span>Apprentissages</span><strong>${stats.learningTopics.length}</strong></div>
        <div class="projects-metric"><span>Idées</span><strong>${stats.ideas.length}</strong></div>
      </div>
    </article>
  `;
}

async function renderCurrentView() {
  if (!lastContainer) return;
  const shell = lastContainer.querySelector("#projects-shell") || lastContainer;
  if (currentView === "detail") return renderDetail(shell, currentProjectId);
  if (currentView === "all") return renderAll(shell);
  if (currentView === "stats") return renderStats(shell);
  return renderActive(shell);
}

async function renderActive(shell) {
  const data = await getData();
  const active = data.projects.filter(project => (project.status || "active") === "active");
  const paused = data.projects.filter(project => project.status === "paused").length;
  const completed = data.projects.filter(project => project.status === "completed").length;

  shell.innerHTML = `
    ${tabs("active")}
    <div class="projects-hero">
      <span>Projets actifs</span>
      <strong>${active.length}</strong>
      <small>${paused} en pause · ${completed} terminé${completed > 1 ? "s" : ""}</small>
    </div>

    <section class="projects-section">
      <div class="projects-section-head">
        <div><h2>Mes projets</h2><p>Un même endroit pour tâches, budget, documents, objectifs et dates.</p></div>
        <button class="primary-btn" id="projects-add">+ Projet</button>
      </div>
      <div class="projects-list">
        ${active.length ? active.map(project => projectCard(project, data)).join("") : `<div class="projects-empty"><h3>Aucun projet actif</h3><p>Crée ton premier projet pour regrouper tout ce qui lui appartient.</p><button class="primary-btn" id="projects-empty-add">Créer un projet</button></div>`}
      </div>
    </section>
  `;

  bindTabs(shell);
  bindCards(shell);
  shell.querySelector("#projects-add").addEventListener("click", () => showProjectModal());
  const empty = shell.querySelector("#projects-empty-add");
  if (empty) empty.addEventListener("click", () => showProjectModal());
}

async function renderAll(shell) {
  const data = await getData();
  let projects = data.projects;
  if (projectFilter !== "all") projects = projects.filter(project => (project.status || "active") === projectFilter);

  shell.innerHTML = `
    ${tabs("all")}
    <section class="projects-section">
      <div class="projects-section-head"><div><h2>Tous les projets</h2><p>${data.projects.length} projet${data.projects.length > 1 ? "s" : ""}</p></div><button class="primary-btn" id="projects-add">+ Projet</button></div>
      <div class="projects-filter-row">
        <button class="projects-filter ${projectFilter === "all" ? "active" : ""}" data-project-filter="all">Tous</button>
        <button class="projects-filter ${projectFilter === "active" ? "active" : ""}" data-project-filter="active">En cours</button>
        <button class="projects-filter ${projectFilter === "paused" ? "active" : ""}" data-project-filter="paused">En pause</button>
        <button class="projects-filter ${projectFilter === "completed" ? "active" : ""}" data-project-filter="completed">Terminés</button>
      </div>
      <div class="projects-list" style="margin-top:12px">${projects.length ? projects.map(project => projectCard(project, data)).join("") : `<div class="projects-empty"><h3>Aucun projet</h3><p>Rien dans ce filtre.</p></div>`}</div>
    </section>
  `;
  bindTabs(shell);
  bindCards(shell);
  shell.querySelector("#projects-add").addEventListener("click", () => showProjectModal());
  shell.querySelectorAll("[data-project-filter]").forEach(btn => btn.addEventListener("click", async () => { projectFilter = btn.dataset.projectFilter; await renderAll(shell); }));
}

async function renderStats(shell) {
  const data = await getData();
  const active = data.projects.filter(project => (project.status || "active") === "active");
  const totals = active.map(project => projectStats(project, data));
  const expenses = totals.reduce((sum, stat) => sum + stat.expenses, 0);
  const tasks = totals.reduce((sum, stat) => sum + stat.tasks.length, 0);
  const done = totals.reduce((sum, stat) => sum + stat.doneTasks, 0);
  const avg = totals.length ? Math.round(totals.reduce((sum, stat) => sum + stat.progress, 0) / totals.length) : 0;

  shell.innerHTML = `
    ${tabs("stats")}
    <section class="projects-section">
      <div class="projects-section-head"><div><h2>Vue globale</h2><p>Statistiques des projets actifs.</p></div></div>
      <div class="projects-metrics">
        <div class="projects-metric"><span>Actifs</span><strong>${active.length}</strong></div>
        <div class="projects-metric"><span>Progression moyenne</span><strong>${avg} %</strong></div>
        <div class="projects-metric"><span>Tâches terminées</span><strong>${done}/${tasks}</strong></div>
        <div class="projects-metric"><span>Dépenses projets</span><strong>${formatMoney(expenses)}</strong></div>
      </div>
    </section>
  `;
  bindTabs(shell);
}

function bindCards(shell) {
  shell.querySelectorAll("[data-project-id]").forEach(card => card.addEventListener("click", async () => {
    currentProjectId = card.dataset.projectId;
    currentView = "detail";
    await renderCurrentView();
  }));
}

async function renderDetail(shell, projectId) {
  const data = await getData();
  const project = data.projects.find(item => item.id === projectId);
  if (!project) {
    currentProjectId = null;
    currentView = "active";
    return renderCurrentView();
  }
  const stats = projectStats(project, data);
  const budgetTarget = Number(project.budgetTarget || 0);
  const budgetPct = budgetTarget > 0 ? Math.min(999, Math.round((stats.expenses / budgetTarget) * 100)) : null;

  shell.innerHTML = `
    <button class="stock-back" id="project-back">‹ Projets</button>
    <div class="projects-hero">
      <span>${escapeHtml(project.category || "PROJET")}</span>
      <strong>${escapeHtml(project.title)}</strong>
      <small>${statusLabel(project.status)}${project.targetDate ? ` · échéance ${formatDate(project.targetDate)}` : ""} · ${stats.progress} %</small>
    </div>

    <section class="projects-detail-card" style="margin-top:12px">
      <div class="projects-detail-head"><div><h3>Vue d'ensemble</h3><p class="muted" style="margin:4px 0 0">Tout ce qui est relié à ce projet.</p></div><button class="primary-btn" id="project-edit">Modifier</button></div>
      <div class="projects-progress"><i style="width:${stats.progress}%"></i></div>
      <div class="projects-metrics">
        <div class="projects-metric"><span>Tâches</span><strong>${stats.doneTasks}/${stats.tasks.length}</strong></div>
        <div class="projects-metric"><span>Dépenses</span><strong>${formatMoney(stats.expenses)}</strong></div>
        <div class="projects-metric"><span>Documents</span><strong>${stats.documents.length}</strong></div>
        <div class="projects-metric"><span>Objectifs</span><strong>${stats.objectives.length}</strong></div>
        <div class="projects-metric"><span>Apprentissages</span><strong>${stats.learningTopics.length}</strong></div>
        <div class="projects-metric"><span>Idées</span><strong>${stats.ideas.length}</strong></div>
      </div>
      ${budgetTarget > 0 ? `<div class="projects-link-list"><div class="projects-link" style="cursor:default"><div><strong>Budget projet</strong><small>${formatMoney(stats.expenses)} dépensés sur ${formatMoney(budgetTarget)}</small></div><strong>${budgetPct} %</strong></div></div>` : ""}
    </section>

    ${project.description ? `<section class="projects-detail-card" style="margin-top:12px"><h3>Description</h3><p class="muted" style="margin:8px 0 0;line-height:1.55">${escapeHtml(project.description)}</p></section>` : ""}

    <section class="projects-detail-card" style="margin-top:12px">
      <div class="projects-detail-head"><div><h3>Tâches</h3><p class="muted" style="margin:4px 0 0">${stats.doneTasks}/${stats.tasks.length} terminée(s)</p></div><button class="primary-btn" id="project-add-task">+ Tâche</button></div>
      <div class="projects-link-list">
        ${stats.tasks.length ? stats.tasks.slice(0,8).map(task => `<div class="projects-link" data-project-route="tasks"><div><strong>${task.done ? "✓ " : ""}${escapeHtml(task.title)}</strong><small>${task.dueDate ? `Échéance ${formatDate(task.dueDate)}` : "Sans échéance"}</small></div><span>›</span></div>`).join("") : `<div class="projects-empty"><h3>Aucune tâche</h3><p>Ajoute les actions nécessaires au projet.</p></div>`}
      </div>
    </section>

    <section class="projects-detail-card" style="margin-top:12px">
      <div class="projects-detail-head"><div><h3>Budget</h3><p class="muted" style="margin:4px 0 0">${stats.transactions.length} mouvement(s) · ${formatMoney(stats.expenses)} dépensés</p></div><button class="primary-btn" id="project-add-budget">+ Mouvement</button></div>
      <div class="projects-link-list">
        ${stats.transactions.length ? stats.transactions.slice(0,6).map(tx => `<div class="projects-link" data-project-route="budget"><div><strong>${escapeHtml(tx.title || tx.category || "Mouvement")}</strong><small>${formatDate(tx.date)} · ${escapeHtml(tx.category || "Sans catégorie")}</small></div><strong>${tx.type === "expense" ? "-" : "+"}${formatMoney(tx.amount)}</strong></div>`).join("") : `<div class="projects-empty"><h3>Aucun mouvement</h3><p>Les dépenses ou revenus du projet apparaîtront ici.</p></div>`}
      </div>
    </section>

    <section class="projects-detail-card" style="margin-top:12px">
      <div class="projects-detail-head"><div><h3>Documents</h3><p class="muted" style="margin:4px 0 0">${stats.documents.length} document(s)</p></div><button class="primary-btn" id="project-add-document">+ Document</button></div>
      <div class="projects-link-list">
        ${stats.documents.length ? stats.documents.slice(0,6).map(doc => `<div class="projects-link" data-project-route="documents"><div><strong>${escapeHtml(doc.title)}</strong><small>${escapeHtml(doc.category || "Document")}${doc.expiryDate ? ` · expire ${formatDate(doc.expiryDate)}` : ""}</small></div><span>›</span></div>`).join("") : `<div class="projects-empty"><h3>Aucun document</h3><p>Ajoute devis, réservation, contrat ou justificatif.</p></div>`}
      </div>
    </section>

    <section class="projects-detail-card" style="margin-top:12px">
      <div class="projects-detail-head"><div><h3>Objectifs</h3><p class="muted" style="margin:4px 0 0">${stats.objectives.length} objectif(s)</p></div><button class="primary-btn" id="project-add-objective">+ Objectif</button></div>
      <div class="projects-link-list">
        ${stats.objectives.length ? stats.objectives.slice(0,6).map(objective => `<div class="projects-link" data-project-route="objectives"><div><strong>${escapeHtml(objective.title)}</strong><small>${objective.targetDate ? `Échéance ${formatDate(objective.targetDate)}` : "Sans échéance"}</small></div><span>›</span></div>`).join("") : `<div class="projects-empty"><h3>Aucun objectif</h3><p>Relie un résultat mesurable à ce projet.</p></div>`}
      </div>
    </section>

    <section class="projects-detail-card" style="margin-top:12px">
      <div class="projects-detail-head"><div><h3>Apprentissage</h3><p class="muted" style="margin:4px 0 0">${stats.learningTopics.length} apprentissage(s)</p></div><button class="primary-btn" id="project-add-learning">+ Apprentissage</button></div>
      <div class="projects-link-list">
        ${stats.learningTopics.length ? stats.learningTopics.slice(0,6).map(topic => `<div class="projects-link" data-project-route="learning"><div><strong>${escapeHtml(topic.title)}</strong><small>${topic.deadline ? `Échéance ${formatDate(topic.deadline)}` : "Sans échéance"}</small></div><span>›</span></div>`).join("") : `<div class="projects-empty"><h3>Aucun apprentissage</h3><p>Relie une compétence ou une formation à ce projet.</p></div>`}
      </div>
    </section>

    <section class="projects-detail-card" style="margin-top:12px">
      <div class="projects-detail-head"><div><h3>Idées</h3><p class="muted" style="margin:4px 0 0">${stats.ideas.length} idée(s)</p></div><button class="primary-btn" id="project-add-idea">+ Idée</button></div>
      <div class="projects-link-list">
        ${stats.ideas.length ? stats.ideas.slice(0,6).map(idea => `<div class="projects-link" data-project-route="ideas"><div><strong>${escapeHtml(idea.title)}</strong><small>${escapeHtml(idea.category || "Idée")} · ${idea.status === "converted" ? "transformée" : idea.status === "kept" ? "à garder" : "Inbox"}</small></div><span>›</span></div>`).join("") : `<div class="projects-empty"><h3>Aucune idée</h3><p>Capture les pistes liées à ce projet sans en faire immédiatement une tâche.</p></div>`}
      </div>
    </section>

    <div class="projects-actions">
      <button class="primary-btn" id="project-add-event">+ Événement Planning</button>
      <button class="ghost-btn" id="project-open-planning">Voir dans Planning</button>
      <button class="danger-btn" id="project-delete">Supprimer le projet</button>
    </div>
  `;

  shell.querySelector("#project-back").addEventListener("click", async () => { currentProjectId = null; currentView = "active"; await renderCurrentView(); });
  shell.querySelector("#project-edit").addEventListener("click", () => showProjectModal(project.id));
  shell.querySelector("#project-add-task").addEventListener("click", () => showAddTaskModal({ projectId: project.id, folder: project.title }));
  shell.querySelector("#project-add-budget").addEventListener("click", () => requestNewBudgetEntry({ projectId: project.id, type: "expense" }));
  shell.querySelector("#project-add-document").addEventListener("click", () => requestNewDocument({ projectId: project.id }));
  shell.querySelector("#project-add-objective").addEventListener("click", () => requestNewObjective({ projectId: project.id, category: project.category || "Projet", targetDate: project.targetDate || "" }));
  shell.querySelector("#project-add-event").addEventListener("click", () => requestNewPlanningEvent({ projectId: project.id, date: project.startDate || todayISO(), category: project.category || "Projet" }));
  shell.querySelector("#project-add-learning").addEventListener("click", () => requestNewLearningTopic({ projectId: project.id, category: project.category || "Projet", deadline: project.targetDate || "" }));
  shell.querySelector("#project-add-idea").addEventListener("click", () => requestNewIdea({ projectId: project.id, category: project.category || "Projet" }));
  shell.querySelector("#project-open-planning").addEventListener("click", () => window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "planning" })));
  shell.querySelectorAll("[data-project-route]").forEach(item => item.addEventListener("click", () => window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: item.dataset.projectRoute }))));

  shell.querySelector("#project-delete").addEventListener("click", async () => {
    if (!confirm(`Supprimer le projet "${project.title}" ? Les tâches, documents, transactions et objectifs liés seront conservés mais détachés du projet.`)) return;

    for (const task of stats.tasks) await putOne("tasks", { ...task, projectId: null, updatedAt: new Date().toISOString() });
    for (const doc of stats.documents) await putOne("documents", { ...doc, projectId: null, updatedAt: new Date().toISOString() });
    for (const tx of stats.transactions) await putOne("budgetTransactions", { ...tx, projectId: null, updatedAt: new Date().toISOString() });
    for (const objective of stats.objectives) await putOne("objectives", { ...objective, projectId: null, updatedAt: new Date().toISOString() });
    for (const event of stats.events) await putOne("calendarEvents", { ...event, projectId: null, updatedAt: new Date().toISOString() });
    for (const topic of stats.learningTopics) await putOne("learningTopics", { ...topic, projectId: null, updatedAt: new Date().toISOString() });
    for (const idea of stats.ideas) await putOne("ideas", { ...idea, projectId: null, updatedAt: new Date().toISOString() });
    await deleteOne("projects", project.id);

    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    currentProjectId = null;
    currentView = "active";
    await renderCurrentView();
  });
}

async function showProjectModal(projectId = null, preset = {}) {
  const projects = await getAll("projects");
  const project = projects.find(item => item.id === projectId);

  openModal(`
    <div class="modal-head">
      <div><p class="eyebrow">PROJET</p><h2>${project ? "Modifier" : "Nouveau"} projet</h2></div>
      <button class="icon-btn" id="project-modal-close">×</button>
    </div>
    <form class="form-grid" id="project-form">
      <div class="field"><label>Nom du projet</label><input name="title" required maxlength="120" value="${escapeHtml(project?.title || preset.title || "")}" placeholder="Ex : Voyage Japon 2027"></div>
      <div class="field"><label>Catégorie</label><input name="category" maxlength="60" value="${escapeHtml(project?.category || preset.category || "")}" placeholder="Voyage, Maison, Perso, Travail..."></div>
      <div class="field"><label>Description</label><textarea name="description" placeholder="Ce que tu veux réaliser, contraintes, idées...">${escapeHtml(project?.description || preset.description || "")}</textarea></div>
      <div class="row">
        <div class="field"><label>Statut</label><select name="status"><option value="active" ${(project?.status || preset.status || "active") === "active" ? "selected" : ""}>En cours</option><option value="paused" ${(project?.status || preset.status) === "paused" ? "selected" : ""}>En pause</option><option value="completed" ${(project?.status || preset.status) === "completed" ? "selected" : ""}>Terminé</option></select></div>
        <div class="field"><label>Progression manuelle (%)</label><input type="number" min="0" max="100" step="1" name="manualProgress" value="${project?.manualProgress ?? preset.manualProgress ?? 0}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Date de départ</label><input type="date" name="startDate" value="${project?.startDate || preset.startDate || todayISO()}"></div>
        <div class="field"><label>Échéance</label><input type="date" name="targetDate" value="${project?.targetDate || preset.targetDate || ""}"></div>
      </div>
      <div class="field"><label>Budget cible (€)</label><input type="number" min="0" step="0.01" name="budgetTarget" value="${project?.budgetTarget ?? preset.budgetTarget ?? ""}" placeholder="Facultatif"></div>
      <div class="actions"><button type="button" class="ghost-btn" id="project-modal-cancel">Annuler</button><button class="primary-btn" type="submit">Enregistrer</button></div>
    </form>
  `);

  document.querySelector("#project-modal-close").addEventListener("click", closeModal);
  document.querySelector("#project-modal-cancel").addEventListener("click", closeModal);
  document.querySelector("#project-form").addEventListener("submit", async event => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const status = String(fd.get("status") || "active");
    const saved = {
      ...(project || {}),
      id: project?.id || uid("project"),
      title: String(fd.get("title") || "").trim(),
      category: String(fd.get("category") || "").trim(),
      description: String(fd.get("description") || "").trim(),
      status,
      manualProgress: status === "completed" ? 100 : Math.max(0, Math.min(100, Number(fd.get("manualProgress") || 0))),
      startDate: String(fd.get("startDate") || todayISO()),
      targetDate: String(fd.get("targetDate") || ""),
      budgetTarget: Number(fd.get("budgetTarget") || 0),
      active: true,
      createdAt: project?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: status === "completed" ? (project?.completedAt || new Date().toISOString()) : null
    };
    await putOne("projects", saved);
    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    currentProjectId = saved.id;
    currentView = "detail";
    await renderCurrentView();
  });
}

export async function getProjectsSummary() {
  const data = await getData();
  const active = data.projects.filter(project => (project.status || "active") === "active");
  const stats = active.map(project => projectStats(project, data));
  return {
    active: active.length,
    completed: data.projects.filter(project => project.status === "completed").length,
    averageProgress: stats.length ? Math.round(stats.reduce((sum, stat) => sum + stat.progress, 0) / stats.length) : 0,
    expenses: stats.reduce((sum, stat) => sum + stat.expenses, 0)
  };
}
