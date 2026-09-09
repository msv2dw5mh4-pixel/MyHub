import { getAll, putOne, deleteOne } from "../core/db.js";
import { escapeHtml, uid, openModal, closeModal, todayISO } from "../core/ui.js";

let currentView = "inbox";
let currentIdeaId = null;
let lastContainer = null;

export async function renderIdeas(container) {
  lastContainer = container;
  container.innerHTML = `<section class="ideas-shell" id="ideas-shell"></section>`;
  await renderCurrentView();
}

export function requestNewIdea(preset = {}) {
  currentView = "inbox";
  window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "ideas" }));
  setTimeout(() => showIdeaModal(null, preset), 120);
}

function tabs(active) {
  return `
    <div class="ideas-tabs">
      <button class="ideas-tab ${active === "inbox" ? "active" : ""}" data-ideas-view="inbox">Inbox</button>
      <button class="ideas-tab ${active === "kept" ? "active" : ""}" data-ideas-view="kept">À garder</button>
      <button class="ideas-tab ${active === "converted" ? "active" : ""}" data-ideas-view="converted">Transformées</button>
      <button class="ideas-tab ${active === "archived" ? "active" : ""}" data-ideas-view="archived">Archives</button>
    </div>
  `;
}

function bindTabs(shell) {
  shell.querySelectorAll("[data-ideas-view]").forEach(btn => btn.addEventListener("click", async () => {
    currentView = btn.dataset.ideasView;
    currentIdeaId = null;
    await renderCurrentView();
  }));
}

async function getData() {
  const [ideas, projects] = await Promise.all([
    getAll("ideas"),
    getAll("projects")
  ]);
  return {
    ideas: [...ideas].sort((a,b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))),
    projects: projects.filter(project => project.active !== false)
  };
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }).format(new Date(value));
}

function priorityLabel(priority) {
  if (priority === "high") return "Priorité haute";
  if (priority === "low") return "Priorité basse";
  return "Priorité normale";
}

function ideaCard(idea, data) {
  const project = data.projects.find(project => project.id === idea.projectId);
  return `
    <article class="idea-card" data-idea-id="${idea.id}">
      <div class="idea-card-head">
        <div>
          <h3>${escapeHtml(idea.title)}</h3>
          <p>${escapeHtml(idea.category || "Idée")}${project ? ` · 🏠 ${escapeHtml(project.title)}` : ""}</p>
        </div>
        <button class="icon-btn" data-edit-idea="${idea.id}" aria-label="Modifier">✎</button>
      </div>
      ${idea.notes ? `<p>${escapeHtml(idea.notes)}</p>` : ""}
      <div class="idea-badges">
        <span class="idea-badge ${idea.priority || "medium"}">${priorityLabel(idea.priority)}</span>
        ${idea.status === "converted" ? `<span class="idea-badge converted">✓ ${escapeHtml(conversionLabel(idea.convertedType))}</span>` : ""}
        <span class="idea-badge">${formatDateTime(idea.createdAt)}</span>
      </div>
      <div class="idea-actions">
        ${idea.status === "inbox" ? `<button class="ghost-btn" data-idea-keep="${idea.id}">À garder</button><button class="primary-btn" data-idea-convert="${idea.id}">Transformer</button>` : ""}
        ${idea.status === "kept" ? `<button class="primary-btn" data-idea-convert="${idea.id}">Transformer</button><button class="ghost-btn" data-idea-inbox="${idea.id}">Inbox</button>` : ""}
        ${idea.status === "converted" ? `<button class="ghost-btn" data-idea-open-linked="${idea.id}">Ouvrir ${escapeHtml(conversionLabel(idea.convertedType))}</button><button class="ghost-btn" data-idea-inbox="${idea.id}">Remettre dans l'Inbox</button>` : ""}
        ${idea.status !== "archived" ? `<button class="ghost-btn" data-idea-archive="${idea.id}">Archiver</button>` : `<button class="ghost-btn" data-idea-inbox="${idea.id}">Restaurer</button>`}
      </div>
    </article>
  `;
}

function conversionLabel(type) {
  if (type === "task") return "Tâche";
  if (type === "project") return "Projet";
  if (type === "objective") return "Objectif";
  if (type === "learning") return "Apprentissage";
  return "élément";
}

function conversionRoute(type) {
  if (type === "task") return "tasks";
  if (type === "project") return "projects";
  if (type === "objective") return "objectives";
  if (type === "learning") return "learning";
  return "dashboard";
}

async function renderCurrentView() {
  if (!lastContainer) return;
  const shell = lastContainer.querySelector("#ideas-shell") || lastContainer;
  if (currentView === "detail") return renderDetail(shell, currentIdeaId);
  return renderList(shell, currentView);
}

async function renderList(shell, status) {
  const data = await getData();
  const list = data.ideas.filter(idea => (idea.status || "inbox") === status);
  const inboxCount = data.ideas.filter(idea => (idea.status || "inbox") === "inbox").length;
  const converted = data.ideas.filter(idea => idea.status === "converted").length;

  shell.innerHTML = `
    ${tabs(status)}
    <div class="ideas-hero">
      <span>Inbox d'idées</span>
      <strong>${inboxCount} à traiter</strong>
      <small>${converted} transformée${converted > 1 ? "s" : ""} en action · capture rapide puis décision plus tard</small>
    </div>

    ${status === "inbox" ? `
      <form class="ideas-capture" id="ideas-quick-form">
        <div class="ideas-capture-row">
          <input name="title" maxlength="160" required placeholder="Une idée te passe par la tête ? Écris-la ici...">
          <button class="primary-btn" type="submit">Capturer</button>
        </div>
      </form>
    ` : ""}

    <section class="ideas-section">
      <div class="ideas-section-head">
        <div><h2>${status === "inbox" ? "À traiter" : status === "kept" ? "À garder" : status === "converted" ? "Transformées" : "Archives"}</h2><p>${list.length} idée${list.length > 1 ? "s" : ""}</p></div>
        <button class="primary-btn" id="ideas-add">+ Idée</button>
      </div>
      <div class="ideas-list">
        ${list.length ? list.map(idea => ideaCard(idea, data)).join("") : `<div class="ideas-empty"><h3>Rien ici</h3><p>${status === "inbox" ? "Ton Inbox est vide." : "Aucune idée dans cette catégorie."}</p></div>`}
      </div>
    </section>
  `;

  bindTabs(shell);
  bindIdeaActions(shell, data);
  shell.querySelector("#ideas-add").addEventListener("click", () => showIdeaModal());
  const quick = shell.querySelector("#ideas-quick-form");
  if (quick) quick.addEventListener("submit", async event => {
    event.preventDefault();
    const title = String(new FormData(event.target).get("title") || "").trim();
    if (!title) return;
    await putOne("ideas", {
      id: uid("idea"),
      title,
      notes: "",
      category: "",
      priority: "medium",
      projectId: null,
      status: "inbox",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderList(shell, "inbox");
  });
}

function bindIdeaActions(shell, data) {
  shell.querySelectorAll("[data-idea-id]").forEach(card => card.addEventListener("click", async event => {
    if (event.target.closest("button")) return;
    currentIdeaId = card.dataset.ideaId;
    currentView = "detail";
    await renderCurrentView();
  }));
  shell.querySelectorAll("[data-edit-idea]").forEach(btn => btn.addEventListener("click", event => { event.stopPropagation(); showIdeaModal(btn.dataset.editIdea); }));
  shell.querySelectorAll("[data-idea-keep]").forEach(btn => btn.addEventListener("click", () => setIdeaStatus(btn.dataset.ideaKeep, "kept")));
  shell.querySelectorAll("[data-idea-inbox]").forEach(btn => btn.addEventListener("click", () => setIdeaStatus(btn.dataset.ideaInbox, "inbox")));
  shell.querySelectorAll("[data-idea-archive]").forEach(btn => btn.addEventListener("click", () => setIdeaStatus(btn.dataset.ideaArchive, "archived")));
  shell.querySelectorAll("[data-idea-convert]").forEach(btn => btn.addEventListener("click", () => showConvertModal(btn.dataset.ideaConvert)));
  shell.querySelectorAll("[data-idea-open-linked]").forEach(btn => btn.addEventListener("click", () => {
    const idea = data.ideas.find(item => item.id === btn.dataset.ideaOpenLinked);
    if (!idea) return;
    window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: conversionRoute(idea.convertedType) }));
  }));
}

async function setIdeaStatus(ideaId, status) {
  const data = await getData();
  const idea = data.ideas.find(item => item.id === ideaId);
  if (!idea) return;
  await putOne("ideas", { ...idea, status, updatedAt: new Date().toISOString() });
  window.dispatchEvent(new CustomEvent("myhub:data-changed"));
  currentView = status === "inbox" ? "inbox" : status;
  await renderCurrentView();
}

async function renderDetail(shell, ideaId) {
  const data = await getData();
  const idea = data.ideas.find(item => item.id === ideaId);
  if (!idea) {
    currentIdeaId = null;
    currentView = "inbox";
    return renderCurrentView();
  }
  const project = data.projects.find(project => project.id === idea.projectId);

  shell.innerHTML = `
    <button class="stock-back" id="idea-back">‹ Idées</button>
    <div class="ideas-hero">
      <span>${escapeHtml(idea.category || "IDÉE")}</span>
      <strong>${escapeHtml(idea.title)}</strong>
      <small>${priorityLabel(idea.priority)}${project ? ` · projet ${escapeHtml(project.title)}` : ""}</small>
    </div>
    <section class="idea-detail-card" style="margin-top:12px">
      <div class="idea-detail-head"><div><h3>Détails</h3><p class="muted" style="margin:4px 0 0">Capturée ${formatDateTime(idea.createdAt)}</p></div><button class="primary-btn" id="idea-edit">Modifier</button></div>
      ${idea.notes ? `<p class="muted" style="line-height:1.55">${escapeHtml(idea.notes)}</p>` : `<p class="muted">Aucune note complémentaire.</p>`}
    </section>

    ${idea.status !== "converted" ? `
      <section class="idea-detail-card" style="margin-top:12px">
        <h3>Transformer cette idée</h3>
        <div class="idea-convert-grid">
          <button class="idea-convert-btn" data-convert-type="task"><strong>✓ Tâche</strong><small>Une action concrète à faire.</small></button>
          <button class="idea-convert-btn" data-convert-type="project"><strong>🏠 Projet</strong><small>Un sujet avec plusieurs étapes.</small></button>
          <button class="idea-convert-btn" data-convert-type="objective"><strong>🎯 Objectif</strong><small>Un résultat que tu veux atteindre.</small></button>
          <button class="idea-convert-btn" data-convert-type="learning"><strong>🧠 Apprentissage</strong><small>Une compétence ou un sujet à travailler.</small></button>
        </div>
      </section>
    ` : `<section class="idea-detail-card" style="margin-top:12px"><h3>Idée transformée</h3><p class="muted">Cette idée a été convertie en ${escapeHtml(conversionLabel(idea.convertedType))}.</p><button class="primary-btn" id="idea-open-converted">Ouvrir ${escapeHtml(conversionLabel(idea.convertedType))}</button></section>`}

    <div class="idea-actions">
      ${idea.status === "inbox" ? `<button class="ghost-btn" id="idea-keep">À garder</button>` : `<button class="ghost-btn" id="idea-inbox">Remettre dans l'Inbox</button>`}
      <button class="ghost-btn" id="idea-archive">Archiver</button>
      <button class="danger-btn" id="idea-delete">Supprimer</button>
    </div>
  `;

  shell.querySelector("#idea-back").addEventListener("click", async () => { currentIdeaId = null; currentView = idea.status || "inbox"; await renderCurrentView(); });
  shell.querySelector("#idea-edit").addEventListener("click", () => showIdeaModal(idea.id));
  shell.querySelectorAll("[data-convert-type]").forEach(btn => btn.addEventListener("click", () => convertIdea(idea.id, btn.dataset.convertType)));
  const openConverted = shell.querySelector("#idea-open-converted");
  if (openConverted) openConverted.addEventListener("click", () => window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: conversionRoute(idea.convertedType) })));
  const keep = shell.querySelector("#idea-keep");
  if (keep) keep.addEventListener("click", () => setIdeaStatus(idea.id, "kept"));
  const inbox = shell.querySelector("#idea-inbox");
  if (inbox) inbox.addEventListener("click", () => setIdeaStatus(idea.id, "inbox"));
  shell.querySelector("#idea-archive").addEventListener("click", () => setIdeaStatus(idea.id, "archived"));
  shell.querySelector("#idea-delete").addEventListener("click", async () => {
    if (!confirm(`Supprimer définitivement l'idée "${idea.title}" ?`)) return;
    await deleteOne("ideas", idea.id);
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    currentIdeaId = null;
    currentView = "inbox";
    await renderCurrentView();
  });
}

async function showIdeaModal(ideaId = null, preset = {}) {
  const data = await getData();
  const idea = data.ideas.find(item => item.id === ideaId);
  openModal(`
    <div class="modal-head"><div><p class="eyebrow">IDÉE</p><h2>${idea ? "Modifier" : "Nouvelle"} idée</h2></div><button class="icon-btn" id="idea-modal-close">×</button></div>
    <form class="form-grid" id="idea-form">
      <div class="field"><label>Idée</label><input name="title" maxlength="160" required value="${escapeHtml(idea?.title || preset.title || "")}" placeholder="Ex : Faire un potager sur le balcon"></div>
      <div class="field"><label>Catégorie</label><input name="category" maxlength="60" value="${escapeHtml(idea?.category || preset.category || "")}" placeholder="Maison, Perso, Voyage, Travail..."></div>
      <div class="row"><div class="field"><label>Priorité</label><select name="priority"><option value="low" ${(idea?.priority || preset.priority) === "low" ? "selected" : ""}>Basse</option><option value="medium" ${(!idea && !preset.priority) || (idea?.priority || preset.priority) === "medium" ? "selected" : ""}>Normale</option><option value="high" ${(idea?.priority || preset.priority) === "high" ? "selected" : ""}>Haute</option></select></div><div class="field"><label>Projet lié</label><select name="projectId"><option value="">Aucun</option>${data.projects.map(project => `<option value="${project.id}" ${(idea?.projectId || preset.projectId || "") === project.id ? "selected" : ""}>${escapeHtml(project.title)}</option>`).join("")}</select></div></div>
      <div class="field"><label>Notes</label><textarea name="notes" placeholder="Développe l'idée si nécessaire...">${escapeHtml(idea?.notes || preset.notes || "")}</textarea></div>
      <div class="actions"><button type="button" class="ghost-btn" id="idea-modal-cancel">Annuler</button><button class="primary-btn" type="submit">Enregistrer</button></div>
    </form>
  `);
  document.querySelector("#idea-modal-close").addEventListener("click", closeModal);
  document.querySelector("#idea-modal-cancel").addEventListener("click", closeModal);
  document.querySelector("#idea-form").addEventListener("submit", async event => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const saved = {
      ...(idea || {}),
      id: idea?.id || uid("idea"),
      title: String(fd.get("title") || "").trim(),
      category: String(fd.get("category") || "").trim(),
      priority: String(fd.get("priority") || "medium"),
      projectId: String(fd.get("projectId") || "") || null,
      notes: String(fd.get("notes") || "").trim(),
      status: idea?.status || "inbox",
      createdAt: idea?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await putOne("ideas", saved);
    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    currentIdeaId = saved.id;
    currentView = "detail";
    await renderCurrentView();
  });
}

async function showConvertModal(ideaId) {
  const data = await getData();
  const idea = data.ideas.find(item => item.id === ideaId);
  if (!idea) return;
  openModal(`
    <div class="modal-head"><div><p class="eyebrow">TRANSFORMER</p><h2>${escapeHtml(idea.title)}</h2></div><button class="icon-btn" id="convert-modal-close">×</button></div>
    <div class="idea-convert-grid">
      <button class="idea-convert-btn" data-modal-convert="task"><strong>✓ Tâche</strong><small>Créer une action dans Tâches.</small></button>
      <button class="idea-convert-btn" data-modal-convert="project"><strong>🏠 Projet</strong><small>Créer un nouveau projet.</small></button>
      <button class="idea-convert-btn" data-modal-convert="objective"><strong>🎯 Objectif</strong><small>Créer un objectif personnel.</small></button>
      <button class="idea-convert-btn" data-modal-convert="learning"><strong>🧠 Apprentissage</strong><small>Créer un apprentissage à suivre.</small></button>
    </div>
  `);
  document.querySelector("#convert-modal-close").addEventListener("click", closeModal);
  document.querySelectorAll("[data-modal-convert]").forEach(btn => btn.addEventListener("click", async () => {
    closeModal();
    await convertIdea(idea.id, btn.dataset.modalConvert);
  }));
}

function sixMonthsFromToday() {
  const date = new Date(`${todayISO()}T12:00:00`);
  date.setMonth(date.getMonth() + 6);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0,10);
}

async function convertIdea(ideaId, type) {
  const data = await getData();
  const idea = data.ideas.find(item => item.id === ideaId);
  if (!idea) return;

  let linkedId = null;
  const now = new Date().toISOString();

  if (type === "task") {
    linkedId = uid("task");
    await putOne("tasks", {
      id: linkedId,
      title: idea.title,
      description: idea.notes || "Créée depuis Idées / Inbox.",
      folder: idea.category || "Idées",
      dueDate: "",
      reminderAt: "",
      objectiveId: null,
      projectId: idea.projectId || null,
      source: "idea",
      ideaId: idea.id,
      done: false,
      createdAt: now,
      completedAt: null
    });
  }

  if (type === "project") {
    linkedId = uid("project");
    await putOne("projects", {
      id: linkedId,
      title: idea.title,
      category: idea.category || "Idée",
      description: idea.notes || "Projet créé depuis Idées / Inbox.",
      status: "active",
      manualProgress: 0,
      startDate: todayISO(),
      targetDate: "",
      budgetTarget: 0,
      active: true,
      sourceIdeaId: idea.id,
      createdAt: now,
      updatedAt: now,
      completedAt: null
    });
  }

  if (type === "objective") {
    linkedId = uid("objective");
    await putOne("objectives", {
      id: linkedId,
      title: idea.title,
      category: idea.category || "Idée",
      description: idea.notes || "Objectif créé depuis Idées / Inbox.",
      priority: idea.priority || "medium",
      status: "active",
      startDate: todayISO(),
      targetDate: sixMonthsFromToday(),
      progressMode: "manual",
      manualProgress: 0,
      startValue: 0,
      currentValue: 0,
      targetValue: 0,
      unit: "",
      projectId: idea.projectId || null,
      sourceIdeaId: idea.id,
      createdDate: todayISO(),
      createdAt: now,
      updatedAt: now,
      completedAt: null
    });
  }

  if (type === "learning") {
    linkedId = uid("learning_topic");
    await putOne("learningTopics", {
      id: linkedId,
      title: idea.title,
      category: idea.category || "À apprendre",
      targetHours: 0,
      weeklyHoursGoal: 0,
      startDate: todayISO(),
      deadline: "",
      status: "active",
      projectId: idea.projectId || null,
      objectiveId: null,
      syncObjective: false,
      notes: idea.notes || "Créé depuis Idées / Inbox.",
      sourceIdeaId: idea.id,
      active: true,
      createdAt: now,
      updatedAt: now
    });
  }

  if (!linkedId) return;

  await putOne("ideas", {
    ...idea,
    status: "converted",
    convertedType: type,
    convertedId: linkedId,
    convertedAt: now,
    updatedAt: now
  });

  window.dispatchEvent(new CustomEvent("myhub:data-changed"));
  window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: conversionRoute(type) }));
}

export async function getIdeasSummary() {
  const data = await getData();
  return {
    inbox: data.ideas.filter(idea => (idea.status || "inbox") === "inbox").length,
    kept: data.ideas.filter(idea => idea.status === "kept").length,
    converted: data.ideas.filter(idea => idea.status === "converted").length,
    total: data.ideas.length
  };
}
