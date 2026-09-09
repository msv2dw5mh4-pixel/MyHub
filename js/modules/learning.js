import { getAll, putOne, deleteOne } from "../core/db.js";
import { escapeHtml, uid, openModal, closeModal, todayISO } from "../core/ui.js";
import { syncLearningObjective } from "../core/learning_sync.js";
import { showAddTaskModal } from "./tasks.js";

let currentView = "active";
let currentTopicId = null;
let topicFilter = "all";
let lastContainer = null;

export async function renderLearning(container) {
  lastContainer = container;
  container.innerHTML = `<section class="learning-shell" id="learning-shell"></section>`;
  await syncLearningObjective();
  await renderCurrentView();
}

export function requestNewLearningTopic(preset = {}) {
  currentView = "active";
  window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "learning" }));
  setTimeout(() => showTopicModal(null, preset), 120);
}

function tabs(active) {
  return `
    <div class="learning-tabs">
      <button class="learning-tab ${active === "active" ? "active" : ""}" data-learning-view="active">En cours</button>
      <button class="learning-tab ${active === "history" ? "active" : ""}" data-learning-view="history">Historique</button>
      <button class="learning-tab ${active === "stats" ? "active" : ""}" data-learning-view="stats">Stats</button>
    </div>
  `;
}

function bindTabs(shell) {
  shell.querySelectorAll("[data-learning-view]").forEach(btn => {
    btn.addEventListener("click", async () => {
      currentView = btn.dataset.learningView;
      currentTopicId = null;
      await renderCurrentView();
    });
  });
}

async function getData() {
  const [topics, sessions, objectives, projects] = await Promise.all([
    getAll("learningTopics"),
    getAll("learningSessions"),
    getAll("objectives"),
    getAll("projects")
  ]);

  return {
    topics: [...topics]
      .filter(topic => topic.active !== false)
      .sort((a,b) => String(a.deadline || "9999-12-31").localeCompare(String(b.deadline || "9999-12-31")) || String(a.title || "").localeCompare(String(b.title || ""))),
    sessions: [...sessions].sort((a,b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""))),
    objectives,
    projects: projects.filter(project => project.active !== false)
  };
}

function localDate(dateString) {
  return new Date(`${dateString}T12:00:00`);
}

function daysBetween(a,b) {
  return Math.round((localDate(b) - localDate(a)) / 86400000);
}

function formatDate(date) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day:"numeric", month:"short", year:"numeric" }).format(localDate(date));
}

function formatHours(minutes) {
  const total = Number(minutes || 0);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (!hours) return `${mins} min`;
  if (!mins) return `${hours} h`;
  return `${hours} h ${mins} min`;
}

function topicStats(topic, sessions) {
  const linked = sessions.filter(session => session.topicId === topic.id);
  const minutes = linked.reduce((sum, session) => sum + Number(session.minutes || 0), 0);
  const hours = minutes / 60;
  const targetHours = Number(topic.targetHours || 0);
  const progress = targetHours > 0 ? Math.min(100, Math.round((hours / targetHours) * 100)) : 0;

  const today = todayISO();
  const weekStart = localDate(today);
  const day = weekStart.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  weekStart.setDate(weekStart.getDate() + delta);
  const weekStartISO = (() => {
    const offset = weekStart.getTimezoneOffset();
    return new Date(weekStart.getTime() - offset * 60000).toISOString().slice(0,10);
  })();
  const weekMinutes = linked.filter(session => session.date >= weekStartISO && session.date <= today).reduce((sum, session) => sum + Number(session.minutes || 0), 0);

  let expected = null;
  if (topic.deadline && topic.startDate && topic.deadline > topic.startDate) {
    const totalDays = Math.max(1, daysBetween(topic.startDate, topic.deadline));
    const elapsed = Math.max(0, Math.min(totalDays, daysBetween(topic.startDate, today)));
    expected = Math.round((elapsed / totalDays) * 100);
  }

  const behind = topic.status !== "completed" && expected !== null && targetHours > 0 && progress + 5 < expected;

  return { linked, minutes, hours, targetHours, progress, weekMinutes, expected, behind };
}

function statusLabel(topic, stats) {
  if (topic.status === "completed") return "Terminé";
  if (topic.status === "paused") return "En pause";
  if (stats.behind) return "À rattraper";
  return "En cours";
}

function statusClass(topic, stats) {
  if (topic.status === "completed") return "completed";
  if (topic.status === "paused") return "paused";
  if (stats.behind) return "behind";
  return "active";
}

function topicCard(topic, data) {
  const stats = topicStats(topic, data.sessions);
  const project = data.projects.find(project => project.id === topic.projectId);
  const objective = data.objectives.find(objective => objective.id === topic.objectiveId);

  return `
    <article class="learning-card ${statusClass(topic, stats)}" data-learning-topic="${topic.id}">
      <div class="learning-card-head">
        <div>
          <h3>${escapeHtml(topic.title)}</h3>
          <p>${escapeHtml(topic.category || "Apprentissage")}${project ? ` · 🏠 ${escapeHtml(project.title)}` : ""}</p>
          <span class="learning-status ${statusClass(topic, stats)}">${statusLabel(topic, stats)}</span>
        </div>
        <strong>${stats.targetHours > 0 ? `${stats.progress} %` : formatHours(stats.minutes)}</strong>
      </div>

      ${stats.targetHours > 0 ? `<div class="learning-progress"><i style="width:${stats.progress}%"></i></div>` : ""}

      <div class="learning-metrics">
        <div class="learning-metric"><span>Réalisé</span><strong>${formatHours(stats.minutes)}</strong></div>
        <div class="learning-metric"><span>Cible</span><strong>${stats.targetHours ? `${stats.targetHours} h` : "Libre"}</strong></div>
        <div class="learning-metric"><span>Cette semaine</span><strong>${formatHours(stats.weekMinutes)}</strong></div>
        <div class="learning-metric"><span>Échéance</span><strong>${formatDate(topic.deadline)}</strong></div>
      </div>

      ${objective ? `<div class="learning-note" style="margin-top:10px">🎯 Objectif lié : ${escapeHtml(objective.title)} · progression mise à jour automatiquement par les sessions.</div>` : ""}
    </article>
  `;
}

async function renderCurrentView() {
  if (!lastContainer) return;
  const shell = lastContainer.querySelector("#learning-shell") || lastContainer;

  if (currentView === "detail") return renderDetail(shell, currentTopicId);
  if (currentView === "history") return renderHistory(shell);
  if (currentView === "stats") return renderStats(shell);
  return renderActive(shell);
}

async function renderActive(shell) {
  const data = await getData();
  let topics = data.topics.filter(topic => topic.status !== "completed");
  if (topicFilter === "active") topics = topics.filter(topic => (topic.status || "active") === "active");
  if (topicFilter === "paused") topics = topics.filter(topic => topic.status === "paused");

  const active = data.topics.filter(topic => (topic.status || "active") === "active");
  const weekMinutes = active.reduce((sum, topic) => sum + topicStats(topic, data.sessions).weekMinutes, 0);
  const weekTarget = active.reduce((sum, topic) => sum + Number(topic.weeklyHoursGoal || 0) * 60, 0);

  shell.innerHTML = `
    ${tabs("active")}
    <div class="learning-hero">
      <span>Apprentissage cette semaine</span>
      <strong>${formatHours(weekMinutes)}</strong>
      <small>${active.length} apprentissage${active.length > 1 ? "s" : ""} actif${active.length > 1 ? "s" : ""}${weekTarget ? ` · cible ${formatHours(weekTarget)}` : ""}</small>
    </div>

    <section class="learning-section">
      <div class="learning-section-head">
        <div><h2>Mes apprentissages</h2><p>Langues, formations, compétences, lectures ou sujets à maîtriser.</p></div>
        <button class="primary-btn" id="learning-add">+ Apprentissage</button>
      </div>

      <div class="learning-filter-row">
        <button class="learning-filter ${topicFilter === "all" ? "active" : ""}" data-learning-filter="all">Tous</button>
        <button class="learning-filter ${topicFilter === "active" ? "active" : ""}" data-learning-filter="active">En cours</button>
        <button class="learning-filter ${topicFilter === "paused" ? "active" : ""}" data-learning-filter="paused">En pause</button>
      </div>

      <div class="learning-list" style="margin-top:12px">
        ${topics.length ? topics.map(topic => topicCard(topic, data)).join("") : `<div class="learning-empty"><h3>Aucun apprentissage</h3><p>Ajoute une compétence ou une formation à suivre.</p><button class="primary-btn" id="learning-empty-add">Créer un apprentissage</button></div>`}
      </div>
    </section>
  `;

  bindTabs(shell);
  bindTopicCards(shell);
  shell.querySelector("#learning-add").addEventListener("click", () => showTopicModal());
  const empty = shell.querySelector("#learning-empty-add");
  if (empty) empty.addEventListener("click", () => showTopicModal());
  shell.querySelectorAll("[data-learning-filter]").forEach(btn => btn.addEventListener("click", async () => {
    topicFilter = btn.dataset.learningFilter;
    await renderActive(shell);
  }));
}

function bindTopicCards(shell) {
  shell.querySelectorAll("[data-learning-topic]").forEach(card => card.addEventListener("click", async () => {
    currentTopicId = card.dataset.learningTopic;
    currentView = "detail";
    await renderCurrentView();
  }));
}

async function renderDetail(shell, topicId) {
  const data = await getData();
  const topic = data.topics.find(item => item.id === topicId);
  if (!topic) {
    currentTopicId = null;
    currentView = "active";
    return renderCurrentView();
  }

  const stats = topicStats(topic, data.sessions);
  const project = data.projects.find(project => project.id === topic.projectId);
  const objective = data.objectives.find(objective => objective.id === topic.objectiveId);

  shell.innerHTML = `
    <button class="stock-back" id="learning-back">‹ Apprentissage</button>
    <div class="learning-hero">
      <span>${escapeHtml(topic.category || "APPRENTISSAGE")}</span>
      <strong>${escapeHtml(topic.title)}</strong>
      <small>${statusLabel(topic, stats)}${topic.deadline ? ` · échéance ${formatDate(topic.deadline)}` : ""}${stats.targetHours ? ` · ${stats.progress} %` : ""}</small>
    </div>

    <section class="learning-detail-card" style="margin-top:12px">
      <div class="learning-detail-head"><div><h3>Progression</h3><p class="muted" style="margin:4px 0 0">Chaque session enregistrée alimente automatiquement ce suivi.</p></div><button class="primary-btn" id="learning-edit">Modifier</button></div>
      ${stats.targetHours ? `<div class="learning-progress"><i style="width:${stats.progress}%"></i></div>` : ""}
      <div class="learning-metrics">
        <div class="learning-metric"><span>Total réalisé</span><strong>${formatHours(stats.minutes)}</strong></div>
        <div class="learning-metric"><span>Objectif total</span><strong>${stats.targetHours ? `${stats.targetHours} h` : "Libre"}</strong></div>
        <div class="learning-metric"><span>Cette semaine</span><strong>${formatHours(stats.weekMinutes)}</strong></div>
        <div class="learning-metric"><span>Cible semaine</span><strong>${topic.weeklyHoursGoal ? `${topic.weeklyHoursGoal} h` : "—"}</strong></div>
      </div>
      ${objective ? `<div class="learning-note" style="margin-top:12px">🎯 ${escapeHtml(objective.title)} est synchronisé avec ${Math.round((stats.minutes / 60) * 100) / 100} h réalisées.</div>` : ""}
      ${project ? `<div class="learning-note" style="margin-top:8px">🏠 Projet lié : ${escapeHtml(project.title)}</div>` : ""}
    </section>

    ${topic.notes ? `<section class="learning-detail-card" style="margin-top:12px"><h3>Notes</h3><p class="muted" style="margin:8px 0 0;line-height:1.55">${escapeHtml(topic.notes)}</p></section>` : ""}

    <section class="learning-detail-card" style="margin-top:12px">
      <div class="learning-detail-head"><div><h3>Sessions</h3><p class="muted" style="margin:4px 0 0">${stats.linked.length} session${stats.linked.length > 1 ? "s" : ""}</p></div><button class="primary-btn" id="learning-add-session">+ Session</button></div>
      <div class="learning-list" style="margin-top:12px">
        ${stats.linked.length ? stats.linked.slice(0,12).map(session => `
          <article class="learning-session-card" data-learning-session="${session.id}">
            <div class="learning-session-head">
              <div><strong>${formatDate(session.date)}</strong><small>${escapeHtml(session.note || "Session d'apprentissage")}</small></div>
              <div style="display:flex;gap:8px;align-items:center"><div class="learning-hours">${formatHours(session.minutes)}</div><button class="icon-btn" data-delete-learning-session="${session.id}" aria-label="Supprimer">×</button></div>
            </div>
          </article>
        `).join("") : `<div class="learning-empty"><h3>Aucune session</h3><p>Enregistre ton premier temps d'apprentissage.</p></div>`}
      </div>
    </section>

    <div class="learning-actions">
      <button class="primary-btn" id="learning-task">+ Tâche d'étude</button>
      ${project ? `<button class="ghost-btn" id="learning-project">Voir le projet</button>` : ""}
      ${objective ? `<button class="ghost-btn" id="learning-objective">Voir l'objectif</button>` : ""}
      <button class="danger-btn" id="learning-delete">Supprimer</button>
    </div>
  `;

  shell.querySelector("#learning-back").addEventListener("click", async () => { currentTopicId = null; currentView = "active"; await renderCurrentView(); });
  shell.querySelector("#learning-edit").addEventListener("click", () => showTopicModal(topic.id));
  shell.querySelector("#learning-add-session").addEventListener("click", () => showSessionModal(topic.id));
  shell.querySelector("#learning-task").addEventListener("click", () => showAddTaskModal({
    title: `Apprentissage — ${topic.title}`,
    folder: "Apprentissage",
    objectiveId: topic.objectiveId || null,
    projectId: topic.projectId || null
  }));
  const projectBtn = shell.querySelector("#learning-project");
  if (projectBtn) projectBtn.addEventListener("click", () => window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "projects" })));
  const objectiveBtn = shell.querySelector("#learning-objective");
  if (objectiveBtn) objectiveBtn.addEventListener("click", () => window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "objectives" })));

  shell.querySelectorAll("[data-delete-learning-session]").forEach(btn => btn.addEventListener("click", async () => {
    const session = stats.linked.find(item => item.id === btn.dataset.deleteLearningSession);
    if (!session || !confirm("Supprimer cette session ?")) return;
    await deleteOne("learningSessions", session.id);
    await syncLearningObjective(topic.id);
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrentView();
  }));

  shell.querySelector("#learning-delete").addEventListener("click", async () => {
    if (!confirm(`Supprimer "${topic.title}" et toutes ses sessions ? L'objectif lié sera conservé.`)) return;
    for (const session of stats.linked) await deleteOne("learningSessions", session.id);
    await deleteOne("learningTopics", topic.id);
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    currentTopicId = null;
    currentView = "active";
    await renderCurrentView();
  });
}

async function renderHistory(shell) {
  const data = await getData();
  const topicMap = new Map(data.topics.map(topic => [topic.id, topic]));
  shell.innerHTML = `
    ${tabs("history")}
    <section class="learning-section">
      <div class="learning-section-head"><div><h2>Historique des sessions</h2><p>${data.sessions.length} session${data.sessions.length > 1 ? "s" : ""} enregistrée${data.sessions.length > 1 ? "s" : ""}</p></div></div>
      <div class="learning-list">
        ${data.sessions.length ? data.sessions.map(session => {
          const topic = topicMap.get(session.topicId);
          return `<article class="learning-session-card"><div class="learning-session-head"><div><strong>${escapeHtml(topic?.title || "Apprentissage supprimé")}</strong><small>${formatDate(session.date)}${session.note ? ` · ${escapeHtml(session.note)}` : ""}</small></div><div class="learning-hours">${formatHours(session.minutes)}</div></div></article>`;
        }).join("") : `<div class="learning-empty"><h3>Aucun historique</h3><p>Les sessions apparaîtront ici.</p></div>`}
      </div>
    </section>
  `;
  bindTabs(shell);
}

async function renderStats(shell) {
  const data = await getData();
  const totalMinutes = data.sessions.reduce((sum, session) => sum + Number(session.minutes || 0), 0);
  const completed = data.topics.filter(topic => topic.status === "completed").length;
  const active = data.topics.filter(topic => (topic.status || "active") === "active").length;

  const month = todayISO().slice(0,7);
  const monthMinutes = data.sessions.filter(session => String(session.date || "").startsWith(month)).reduce((sum, session) => sum + Number(session.minutes || 0), 0);

  const ranked = data.topics.map(topic => ({ topic, stats: topicStats(topic, data.sessions) })).sort((a,b) => b.stats.minutes - a.stats.minutes);

  shell.innerHTML = `
    ${tabs("stats")}
    <section class="learning-section">
      <div class="learning-section-head"><div><h2>Vue globale</h2><p>Temps et progression de tes apprentissages.</p></div></div>
      <div class="learning-metrics">
        <div class="learning-metric"><span>Temps total</span><strong>${formatHours(totalMinutes)}</strong></div>
        <div class="learning-metric"><span>Ce mois</span><strong>${formatHours(monthMinutes)}</strong></div>
        <div class="learning-metric"><span>Actifs</span><strong>${active}</strong></div>
        <div class="learning-metric"><span>Terminés</span><strong>${completed}</strong></div>
      </div>
    </section>
    <section class="learning-section">
      <div class="learning-section-head"><div><h2>Temps par apprentissage</h2><p>Du plus travaillé au moins travaillé.</p></div></div>
      <div class="learning-list">
        ${ranked.length ? ranked.map(item => topicCard(item.topic, data)).join("") : `<div class="learning-empty"><h3>Aucune donnée</h3><p>Commence par enregistrer une session.</p></div>`}
      </div>
    </section>
  `;
  bindTabs(shell);
  bindTopicCards(shell);
}

async function showTopicModal(topicId = null, preset = {}) {
  const data = await getData();
  const topic = data.topics.find(item => item.id === topicId);
  const activeObjectives = data.objectives.filter(objective => (objective.status || "active") !== "completed" && objective.status !== "cancelled");

  openModal(`
    <div class="modal-head">
      <div><p class="eyebrow">APPRENTISSAGE</p><h2>${topic ? "Modifier" : "Nouvel"} apprentissage</h2></div>
      <button class="icon-btn" id="learning-modal-close">×</button>
    </div>

    <form class="form-grid" id="learning-topic-form">
      <div class="field"><label>Nom</label><input name="title" required maxlength="120" value="${escapeHtml(topic?.title || preset.title || "")}" placeholder="Ex : Anglais B2, Excel avancé, JavaScript..."></div>
      <div class="field"><label>Catégorie</label><input name="category" maxlength="60" value="${escapeHtml(topic?.category || preset.category || "")}" placeholder="Langue, Formation, Compétence, Lecture..."></div>
      <div class="row">
        <div class="field"><label>Objectif total (heures)</label><input type="number" min="0" step="0.5" name="targetHours" value="${topic?.targetHours ?? preset.targetHours ?? ""}" placeholder="Ex : 120"></div>
        <div class="field"><label>Cible hebdomadaire (h)</label><input type="number" min="0" step="0.5" name="weeklyHoursGoal" value="${topic?.weeklyHoursGoal ?? preset.weeklyHoursGoal ?? ""}" placeholder="Ex : 3"></div>
      </div>
      <div class="row">
        <div class="field"><label>Date de départ</label><input type="date" name="startDate" value="${topic?.startDate || preset.startDate || todayISO()}"></div>
        <div class="field"><label>Échéance</label><input type="date" name="deadline" value="${topic?.deadline || preset.deadline || ""}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Statut</label><select name="status"><option value="active" ${(topic?.status || preset.status || "active") === "active" ? "selected" : ""}>En cours</option><option value="paused" ${(topic?.status || preset.status) === "paused" ? "selected" : ""}>En pause</option><option value="completed" ${(topic?.status || preset.status) === "completed" ? "selected" : ""}>Terminé</option></select></div>
        <div class="field"><label>Projet lié</label><select name="projectId"><option value="">Aucun</option>${data.projects.map(project => `<option value="${project.id}" ${(topic?.projectId || preset.projectId || "") === project.id ? "selected" : ""}>${escapeHtml(project.title)}</option>`).join("")}</select></div>
      </div>
      <div class="field"><label>Objectif MyHub lié</label><select name="objectiveId"><option value="">Aucun</option>${activeObjectives.map(objective => `<option value="${objective.id}" ${(topic?.objectiveId || preset.objectiveId || "") === objective.id ? "selected" : ""}>${escapeHtml(objective.title)}</option>`).join("")}</select></div>
      ${!topic ? `<label class="setting-card" style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" name="createObjective" style="margin-top:3px"><span><strong>Créer aussi un objectif MyHub</strong><span class="muted">Le temps enregistré ici mettra automatiquement à jour l'objectif chiffré en heures.</span></span></label>` : ""}
      <div class="field"><label>Notes</label><textarea name="notes" placeholder="Ressources, programme, méthode, certification visée...">${escapeHtml(topic?.notes || preset.notes || "")}</textarea></div>
      <div class="actions"><button type="button" class="ghost-btn" id="learning-modal-cancel">Annuler</button><button class="primary-btn" type="submit">Enregistrer</button></div>
    </form>
  `);

  document.querySelector("#learning-modal-close").addEventListener("click", closeModal);
  document.querySelector("#learning-modal-cancel").addEventListener("click", closeModal);

  document.querySelector("#learning-topic-form").addEventListener("submit", async event => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const targetHours = Number(fd.get("targetHours") || 0);
    let objectiveId = String(fd.get("objectiveId") || "") || null;
    const projectId = String(fd.get("projectId") || "") || null;

    if (!topic && fd.get("createObjective") === "on" && !objectiveId) {
      const objective = {
        id: uid("objective"),
        title: String(fd.get("title") || "").trim(),
        category: String(fd.get("category") || "Apprentissage").trim() || "Apprentissage",
        description: `Objectif créé depuis le module Apprentissage.`,
        priority: "medium",
        status: "active",
        startDate: String(fd.get("startDate") || todayISO()),
        targetDate: String(fd.get("deadline") || ""),
        progressMode: "numeric",
        manualProgress: 0,
        startValue: 0,
        currentValue: 0,
        targetValue: targetHours,
        unit: "h",
        projectId,
        createdDate: todayISO(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null
      };
      await putOne("objectives", objective);
      objectiveId = objective.id;
    }

    const saved = {
      ...(topic || {}),
      id: topic?.id || uid("learning_topic"),
      title: String(fd.get("title") || "").trim(),
      category: String(fd.get("category") || "").trim(),
      targetHours,
      weeklyHoursGoal: Number(fd.get("weeklyHoursGoal") || 0),
      startDate: String(fd.get("startDate") || todayISO()),
      deadline: String(fd.get("deadline") || ""),
      status: String(fd.get("status") || "active"),
      projectId,
      objectiveId,
      syncObjective: Boolean(objectiveId),
      notes: String(fd.get("notes") || "").trim(),
      active: true,
      createdAt: topic?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await putOne("learningTopics", saved);
    await syncLearningObjective(saved.id);
    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    currentTopicId = saved.id;
    currentView = "detail";
    await renderCurrentView();
  });
}

async function showSessionModal(topicId) {
  const data = await getData();
  const topic = data.topics.find(item => item.id === topicId);
  if (!topic) return;

  openModal(`
    <div class="modal-head"><div><p class="eyebrow">SESSION</p><h2>${escapeHtml(topic.title)}</h2></div><button class="icon-btn" id="learning-session-close">×</button></div>
    <form class="form-grid" id="learning-session-form">
      <div class="row"><div class="field"><label>Date</label><input type="date" name="date" value="${todayISO()}" required></div><div class="field"><label>Durée (minutes)</label><input type="number" min="1" step="5" name="minutes" value="30" required></div></div>
      <div class="field"><label>Ce que tu as travaillé</label><textarea name="note" placeholder="Ex : vocabulaire, chapitre 3, exercices..."></textarea></div>
      <div class="actions"><button type="button" class="ghost-btn" id="learning-session-cancel">Annuler</button><button class="primary-btn" type="submit">Enregistrer la session</button></div>
    </form>
  `);

  document.querySelector("#learning-session-close").addEventListener("click", closeModal);
  document.querySelector("#learning-session-cancel").addEventListener("click", closeModal);
  document.querySelector("#learning-session-form").addEventListener("submit", async event => {
    event.preventDefault();
    const fd = new FormData(event.target);
    await putOne("learningSessions", {
      id: uid("learning_session"),
      topicId,
      date: String(fd.get("date") || todayISO()),
      minutes: Number(fd.get("minutes") || 0),
      note: String(fd.get("note") || "").trim(),
      createdAt: new Date().toISOString()
    });
    await syncLearningObjective(topicId);
    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrentView();
  });
}

export async function getLearningSummary() {
  const data = await getData();
  const active = data.topics.filter(topic => (topic.status || "active") === "active");
  const month = todayISO().slice(0,7);
  const monthMinutes = data.sessions.filter(session => String(session.date || "").startsWith(month)).reduce((sum, session) => sum + Number(session.minutes || 0), 0);

  const today = todayISO();
  const weekStart = localDate(today);
  const day = weekStart.getDay();
  weekStart.setDate(weekStart.getDate() + (day === 0 ? -6 : 1 - day));
  const offset = weekStart.getTimezoneOffset();
  const start = new Date(weekStart.getTime() - offset * 60000).toISOString().slice(0,10);
  const weekMinutes = data.sessions.filter(session => session.date >= start && session.date <= today).reduce((sum, session) => sum + Number(session.minutes || 0), 0);

  return {
    active: active.length,
    completed: data.topics.filter(topic => topic.status === "completed").length,
    weekMinutes,
    monthMinutes
  };
}
