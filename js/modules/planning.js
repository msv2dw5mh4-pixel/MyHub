import {
  getAll,
  putOne,
  deleteOne
} from "../core/db.js";

import { showAddTaskModal } from "./tasks.js";

import {
  escapeHtml,
  uid,
  openModal,
  closeModal,
  todayISO
} from "../core/ui.js";

let currentView = "today";
let selectedDate = todayISO();
let selectedMonthDate = todayISO();
let sourceFilter = "all";
let currentEventId = null;
let lastContainer = null;

export async function renderPlanning(container) {
  lastContainer = container;
  container.innerHTML = `<section class="planning-shell" id="planning-shell"></section>`;
  await renderCurrentView();
}

export function requestNewPlanningEvent(preset = {}) {
  window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "planning" }));
  setTimeout(() => showEventModal(null, { date: preset.date || selectedDate || todayISO() }), 120);
}

function tabs(active) {
  return `
    <div class="planning-tabs">
      <button class="planning-tab ${active === "today" ? "active" : ""}" data-planning-view="today">Aujourd'hui</button>
      <button class="planning-tab ${active === "week" ? "active" : ""}" data-planning-view="week">Semaine</button>
      <button class="planning-tab ${active === "month" ? "active" : ""}" data-planning-view="month">Mois</button>
    </div>
  `;
}

function bindTabs(shell) {
  shell.querySelectorAll("[data-planning-view]").forEach(btn => {
    btn.addEventListener("click", async () => {
      currentView = btn.dataset.planningView;
      currentEventId = null;
      if (currentView === "today" && !selectedDate) selectedDate = todayISO();
      await renderCurrentView();
    });
  });
}

async function renderCurrentView() {
  if (!lastContainer) return;
  const shell = lastContainer.querySelector("#planning-shell") || lastContainer;

  if (currentView === "event-detail") return renderEventDetail(shell, currentEventId);
  if (currentView === "week") return renderWeek(shell);
  if (currentView === "month") return renderMonth(shell);
  return renderDay(shell);
}

function localDate(dateString) {
  return new Date(`${dateString}T12:00:00`);
}

function isoFromDate(date) {
  const copy = new Date(date);
  const offset = copy.getTimezoneOffset();
  return new Date(copy.getTime() - offset * 60000).toISOString().slice(0,10);
}

function addDays(dateString, days) {
  const date = localDate(dateString);
  date.setDate(date.getDate() + days);
  return isoFromDate(date);
}

function addMonths(dateString, months) {
  const date = localDate(dateString);
  date.setMonth(date.getMonth() + months);
  return isoFromDate(date);
}

function mondayOf(dateString) {
  const date = localDate(dateString);
  const day = date.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + delta);
  return isoFromDate(date);
}

function firstOfMonth(dateString) {
  const date = localDate(dateString);
  date.setDate(1);
  return isoFromDate(date);
}

function lastOfMonth(dateString) {
  const date = localDate(dateString);
  date.setMonth(date.getMonth() + 1, 0);
  return isoFromDate(date);
}

function formatLong(dateString) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(localDate(dateString));
}

function formatMedium(dateString) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short"
  }).format(localDate(dateString));
}

function formatMonth(dateString) {
  return new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric"
  }).format(localDate(dateString));
}

function capitalize(value = "") {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function recurrenceLabel(value) {
  if (value === "daily") return "Tous les jours";
  if (value === "weekly") return "Toutes les semaines";
  if (value === "monthly") return "Tous les mois";
  return "Aucune";
}

function sourceLabel(source) {
  if (source === "task") return "Tâche";
  if (source === "objective") return "Objectif";
  if (source === "sport") return "Sport";
  if (source === "project") return "Projet";
  if (source === "learning") return "Apprentissage";
  return "Événement";
}

function sourceIcon(source) {
  if (source === "task") return "✓";
  if (source === "objective") return "🎯";
  if (source === "sport") return "🏋️";
  if (source === "project") return "🏠";
  if (source === "learning") return "🧠";
  return "📅";
}

function timeFromReminder(task) {
  if (!task.reminderAt) return "";
  const raw = String(task.reminderAt);
  const reminderDate = raw.slice(0,10);
  if (task.dueDate && reminderDate !== task.dueDate) return "";
  return raw.slice(11,16);
}

function eventOccursOn(event, date) {
  if (!event?.date || date < event.date) return false;
  if (event.repeatUntil && date > event.repeatUntil) return false;

  const recurrence = event.recurrence || "none";
  if (recurrence === "none") return date === event.date;

  const start = localDate(event.date);
  const current = localDate(date);
  const diffDays = Math.round((current - start) / 86400000);

  if (diffDays < 0) return false;
  if (recurrence === "daily") return true;
  if (recurrence === "weekly") return diffDays % 7 === 0;

  if (recurrence === "monthly") {
    return current.getDate() === start.getDate();
  }

  return false;
}

function expandCalendarEvents(events, startDate, endDate) {
  const rows = [];
  for (
    let date = startDate;
    date <= endDate;
    date = addDays(date, 1)
  ) {
    events.forEach(event => {
      if (!eventOccursOn(event, date)) return;
      rows.push({
        id: `event:${event.id}:${date}`,
        sourceId: event.id,
        source: "event",
        date,
        time: event.time || "",
        title: event.title || "Événement",
        subtitle: [
          event.category,
          event.location
        ].filter(Boolean).join(" · "),
        duration: Number(event.duration || 0),
        recurrence: event.recurrence || "none",
        route: null
      });
    });
  }
  return rows;
}

async function getPlanningData(startDate, endDate) {
  const [tasks, objectives, milestones, sports, events, projects, learningTopics] = await Promise.all([
    getAll("tasks"),
    getAll("objectives"),
    getAll("objectiveMilestones"),
    getAll("sportSessions"),
    getAll("calendarEvents"),
    getAll("projects"),
    getAll("learningTopics")
  ]);

  const rows = [];

  tasks.forEach(task => {
    if (!task.dueDate || task.dueDate < startDate || task.dueDate > endDate) return;

    rows.push({
      id: `task:${task.id}`,
      sourceId: task.id,
      source: "task",
      date: task.dueDate,
      time: timeFromReminder(task),
      title: task.title,
      subtitle: [
        task.folder || "Général",
        task.done ? "Terminée" : (task.objectiveId ? "Liée à un objectif" : "")
      ].filter(Boolean).join(" · "),
      done: task.done === true,
      taskSource: task.source || null,
      route: "tasks"
    });
  });

  objectives.forEach(objective => {
    if (
      !objective.targetDate ||
      objective.targetDate < startDate ||
      objective.targetDate > endDate ||
      objective.status === "cancelled"
    ) return;

    rows.push({
      id: `objective:${objective.id}`,
      sourceId: objective.id,
      source: "objective",
      date: objective.targetDate,
      time: "",
      title: objective.title,
      subtitle: objective.status === "completed" ? "Objectif terminé" : "Échéance objectif",
      done: objective.status === "completed",
      route: "objectives"
    });
  });

  milestones.forEach(milestone => {
    if (!milestone.dueDate || milestone.dueDate < startDate || milestone.dueDate > endDate) return;

    // Un jalon déjà transformé en tâche est affiché via la tâche pour éviter un doublon dans le Planning.
    if (milestone.taskId && tasks.some(task => task.id === milestone.taskId)) return;

    const objective = objectives.find(o => o.id === milestone.objectiveId);
    if (objective?.status === "cancelled") return;

    rows.push({
      id: `milestone:${milestone.id}`,
      sourceId: milestone.id,
      source: "objective",
      date: milestone.dueDate,
      time: "",
      title: milestone.title,
      subtitle: `Jalon${objective?.title ? ` · ${objective.title}` : ""}`,
      done: milestone.done === true,
      route: "objectives"
    });
  });


  projects.forEach(project => {
    if (!project.targetDate || project.targetDate < startDate || project.targetDate > endDate || project.active === false) return;
    rows.push({
      id: `project:${project.id}`,
      sourceId: project.id,
      source: "project",
      date: project.targetDate,
      time: "",
      title: project.title,
      subtitle: project.status === "completed" ? "Projet terminé" : "Échéance projet",
      done: project.status === "completed",
      route: "projects"
    });
  });

  learningTopics.forEach(topic => {
    if (!topic.deadline || topic.deadline < startDate || topic.deadline > endDate || topic.active === false) return;
    rows.push({
      id: `learning:${topic.id}`,
      sourceId: topic.id,
      source: "learning",
      date: topic.deadline,
      time: "",
      title: topic.title,
      subtitle: topic.status === "completed" ? "Apprentissage terminé" : "Échéance apprentissage",
      done: topic.status === "completed",
      route: "learning"
    });
  });

  sports.forEach(session => {
    if (!session.date || session.date < startDate || session.date > endDate) return;

    rows.push({
      id: `sport:${session.id}`,
      sourceId: session.id,
      source: "sport",
      date: session.date,
      time: session.plannedTime || "",
      title: session.type === "activity"
        ? (session.activityType || "Activité sportive")
        : (session.programName || "Séance"),
      subtitle: session.status === "completed"
        ? "Activité enregistrée"
        : session.status === "in_progress"
          ? "Séance en cours"
          : "Sport",
      route: "sport"
    });
  });

  rows.push(...expandCalendarEvents(events, startDate, endDate));

  return {
    rows: sortRows(rows),
    events,
    tasks,
    objectives,
    milestones,
    sports,
    projects,
    learningTopics
  };
}

function sortRows(rows) {
  return [...rows].sort((a,b) =>
    String(a.date || "").localeCompare(String(b.date || "")) ||
    String(a.time || "00:00").localeCompare(String(b.time || "00:00")) ||
    String(a.title || "").localeCompare(String(b.title || ""))
  );
}

function filteredRows(rows) {
  if (sourceFilter === "all") return rows;
  return rows.filter(row => row.source === sourceFilter);
}

function filters() {
  const items = [
    ["all", "Tout"],
    ["event", "📅 Événements"],
    ["task", "✓ Tâches"],
    ["objective", "🎯 Objectifs"],
    ["project", "🏠 Projets"],
    ["learning", "🧠 Apprentissage"],
    ["sport", "🏋️ Sport"]
  ];

  return `
    <div class="planning-filters">
      ${items.map(([key,label]) => `
        <button class="planning-filter ${sourceFilter === key ? "active" : ""}" data-planning-filter="${key}">${label}</button>
      `).join("")}
    </div>
  `;
}

function bindFilters(shell) {
  shell.querySelectorAll("[data-planning-filter]").forEach(btn => {
    btn.addEventListener("click", async () => {
      sourceFilter = btn.dataset.planningFilter;
      await renderCurrentView();
    });
  });
}

function itemHtml(row) {
  const time = row.time || "Journée";
  return `
    <article class="planning-item" data-planning-item="${row.id}" data-source="${row.source}" data-source-id="${row.sourceId || ""}" data-route="${row.route || ""}">
      <div class="planning-time">${escapeHtml(time)}</div>
      <i class="planning-dot ${row.source}"></i>
      <div class="planning-item-main">
        <strong>${row.done ? "✓ " : ""}${escapeHtml(row.title || "")}</strong>
        <small>${escapeHtml(row.subtitle || sourceLabel(row.source))}</small>
      </div>
      <div class="planning-item-type">${sourceIcon(row.source)} ${sourceLabel(row.source)}</div>
      ${row.source === "task" && !row.taskSource ? `<button class="planning-task-edit" type="button" data-planning-edit-task="${row.sourceId}">Modifier</button>` : ""}
    </article>
  `;
}

function bindItems(parent) {
  parent.querySelectorAll("[data-planning-edit-task]").forEach(btn => {
    btn.addEventListener("click", async event => {
      event.stopPropagation();
      const tasks = await getAll("tasks");
      const task = tasks.find(t => t.id === btn.dataset.planningEditTask);
      if (task) showAddTaskModal(task);
    });
  });

  parent.querySelectorAll("[data-planning-item]").forEach(item => {
    item.addEventListener("click", async event => {
      if (event.target.closest("[data-planning-edit-task]")) return;
      const source = item.dataset.source;

      if (source === "event") {
        currentEventId = item.dataset.sourceId;
        currentView = "event-detail";
        await renderCurrentView();
        return;
      }

      const route = item.dataset.route;
      if (route) {
        window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: route }));
      }
    });
  });
}

function bindToolbar(shell, previousAction, nextAction) {
  shell.querySelector("#planning-prev").addEventListener("click", previousAction);
  shell.querySelector("#planning-next").addEventListener("click", nextAction);

  const todayBtn = shell.querySelector("#planning-go-today");
  if (todayBtn) {
    todayBtn.addEventListener("click", async () => {
      selectedDate = todayISO();
      selectedMonthDate = todayISO();
      await renderCurrentView();
    });
  }
}

async function renderDay(shell) {
  const data = await getPlanningData(selectedDate, selectedDate);
  const rows = filteredRows(data.rows);
  const openTasks = data.tasks.filter(t => !t.done && t.dueDate && t.dueDate < selectedDate).length;
  const isToday = selectedDate === todayISO();

  shell.innerHTML = `
    ${tabs("today")}

    <div class="planning-toolbar">
      <button class="planning-arrow" id="planning-prev">‹</button>
      <div class="planning-period-title">
        <strong>${capitalize(formatLong(selectedDate))}</strong>
        <small>${isToday ? "Aujourd'hui" : `<button id="planning-go-today" style="border:0;background:transparent;color:#2563eb;font-weight:800;cursor:pointer">Revenir à aujourd'hui</button>`}</small>
      </div>
      <button class="planning-arrow" id="planning-next">›</button>
    </div>

    <div class="planning-hero">
      <span>${isToday ? "Aujourd'hui" : "Agenda du jour"}</span>
      <strong>${rows.length} élément${rows.length > 1 ? "s" : ""}</strong>
      <small>${isToday && openTasks ? `${openTasks} tâche${openTasks > 1 ? "s" : ""} antérieure${openTasks > 1 ? "s" : ""} non terminée${openTasks > 1 ? "s" : ""}` : "Tâches, objectifs, sport et événements au même endroit."}</small>
    </div>

    ${isToday && openTasks ? `<section class="planning-overdue"><strong>${openTasks} tâche${openTasks>1?"s":""} en retard</strong><span>Elles restent visibles dans Tâches pour ne pas polluer l'agenda du jour.</span><button class="ghost-btn" id="planning-open-late">Traiter</button></section>` : ""}

    ${filters()}

    <section class="planning-section">
      <div class="planning-section-head">
        <div>
          <h2>Agenda</h2>
          <p>${rows.length ? "Trié par heure puis par type." : "Rien de prévu pour cette journée."}</p>
        </div>
        <div class="planning-head-actions"><button class="ghost-btn" id="planning-add-task">+ Tâche</button><button class="primary-btn" id="planning-add-event">+ Événement</button></div>
      </div>

      <div class="planning-agenda">
        ${
          rows.length
            ? rows.map(itemHtml).join("")
            : `<div class="planning-empty"><h3>Journée libre</h3><p>Aucun élément dans cette vue.</p></div>`
        }
      </div>
    </section>
  `;

  bindTabs(shell);
  bindFilters(shell);
  bindItems(shell);

  bindToolbar(
    shell,
    async () => { selectedDate = addDays(selectedDate, -1); await renderDay(shell); },
    async () => { selectedDate = addDays(selectedDate, 1); await renderDay(shell); }
  );

  shell.querySelector("#planning-add-event").addEventListener("click", () =>
    showEventModal(null, { date: selectedDate })
  );
  shell.querySelector("#planning-add-task")?.addEventListener("click", () => showAddTaskModal({ dueDate: selectedDate }));
  shell.querySelector("#planning-open-late")?.addEventListener("click", () => window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "tasks" })));
}

async function renderWeek(shell) {
  const monday = mondayOf(selectedDate);
  const sunday = addDays(monday, 6);
  const data = await getPlanningData(monday, sunday);
  const rows = filteredRows(data.rows);

  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));

  shell.innerHTML = `
    ${tabs("week")}

    <div class="planning-toolbar">
      <button class="planning-arrow" id="planning-prev">‹</button>
      <div class="planning-period-title">
        <strong>${formatMedium(monday)} → ${formatMedium(sunday)}</strong>
        <small><button id="planning-go-today" style="border:0;background:transparent;color:#2563eb;font-weight:800;cursor:pointer">Semaine actuelle</button></small>
      </div>
      <button class="planning-arrow" id="planning-next">›</button>
    </div>

    ${filters()}

    <section class="planning-week">
      ${days.map(date => {
        const dayRows = rows.filter(row => row.date === date);
        const weekday = new Intl.DateTimeFormat("fr-FR", { weekday: "long" }).format(localDate(date));

        return `
          <section class="planning-day-card">
            <div class="planning-day-head ${date === todayISO() ? "today" : ""}" data-week-date="${date}">
              <strong>${capitalize(weekday)} ${formatMedium(date)}</strong>
              <span>${dayRows.length} élément${dayRows.length > 1 ? "s" : ""}</span>
            </div>

            <div class="planning-day-items">
              ${
                dayRows.length
                  ? dayRows.map(itemHtml).join("")
                  : `<div style="padding:12px;color:#98a2b3;font-size:12px">Rien de prévu</div>`
              }
            </div>
          </section>
        `;
      }).join("")}
    </section>
  `;

  bindTabs(shell);
  bindFilters(shell);
  bindItems(shell);

  bindToolbar(
    shell,
    async () => { selectedDate = addDays(selectedDate, -7); await renderWeek(shell); },
    async () => { selectedDate = addDays(selectedDate, 7); await renderWeek(shell); }
  );

  shell.querySelectorAll("[data-week-date]").forEach(head => {
    head.addEventListener("click", async event => {
      if (event.target.closest("[data-planning-item]")) return;
      selectedDate = head.dataset.weekDate;
      currentView = "today";
      await renderCurrentView();
    });
  });
}

function monthGridDates(monthDate) {
  const first = firstOfMonth(monthDate);
  const last = lastOfMonth(monthDate);
  const firstDay = localDate(first).getDay();
  const offsetToMonday = firstDay === 0 ? -6 : 1 - firstDay;
  const gridStart = addDays(first, offsetToMonday);

  const lastDay = localDate(last).getDay();
  const offsetToSunday = lastDay === 0 ? 0 : 7 - lastDay;
  const gridEnd = addDays(last, offsetToSunday);

  const dates = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d,1)) dates.push(d);
  return { first, last, gridStart, gridEnd, dates };
}

async function renderMonth(shell) {
  const monthBase = firstOfMonth(selectedMonthDate || selectedDate);
  const grid = monthGridDates(monthBase);
  const data = await getPlanningData(grid.gridStart, grid.gridEnd);
  const rows = filteredRows(data.rows);

  if (selectedMonthDate < grid.first || selectedMonthDate > grid.last) {
    selectedMonthDate = grid.first;
  }

  const selectedRows = rows.filter(row => row.date === selectedMonthDate);
  const monthNum = localDate(monthBase).getMonth();

  shell.innerHTML = `
    ${tabs("month")}

    <div class="planning-toolbar">
      <button class="planning-arrow" id="planning-prev">‹</button>
      <div class="planning-period-title">
        <strong>${capitalize(formatMonth(monthBase))}</strong>
        <small><button id="planning-go-today" style="border:0;background:transparent;color:#2563eb;font-weight:800;cursor:pointer">Ce mois-ci</button></small>
      </div>
      <button class="planning-arrow" id="planning-next">›</button>
    </div>

    ${filters()}

    <div class="planning-month-weekdays">
      <span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span>
    </div>

    <div class="planning-month-grid">
      ${grid.dates.map(date => {
        const dayRows = rows.filter(row => row.date === date);
        const outside = localDate(date).getMonth() !== monthNum;

        return `
          <button class="planning-month-day ${outside ? "outside" : ""} ${date === todayISO() ? "today" : ""} ${date === selectedMonthDate ? "selected" : ""}" data-month-date="${date}">
            <span class="planning-month-number">${localDate(date).getDate()}</span>
            <span class="planning-month-dots">
              ${dayRows.slice(0,5).map(row => `<i class="${row.source}"></i>`).join("")}
            </span>
            ${dayRows.length ? `<span class="planning-month-count">${dayRows.length}</span>` : ""}
          </button>
        `;
      }).join("")}
    </div>

    <section class="planning-section">
      <div class="planning-section-head">
        <div>
          <h2>${capitalize(formatLong(selectedMonthDate))}</h2>
          <p>${selectedRows.length} élément${selectedRows.length > 1 ? "s" : ""}</p>
        </div>
        <button class="primary-btn" id="planning-add-event">+ Événement</button>
      </div>

      <div class="planning-agenda">
        ${
          selectedRows.length
            ? selectedRows.map(itemHtml).join("")
            : `<div class="planning-empty"><h3>Rien ce jour-là</h3><p>Tu peux ajouter un événement personnel.</p></div>`
        }
      </div>
    </section>
  `;

  bindTabs(shell);
  bindFilters(shell);
  bindItems(shell);

  bindToolbar(
    shell,
    async () => {
      selectedMonthDate = addMonths(firstOfMonth(selectedMonthDate), -1);
      selectedDate = selectedMonthDate;
      await renderMonth(shell);
    },
    async () => {
      selectedMonthDate = addMonths(firstOfMonth(selectedMonthDate), 1);
      selectedDate = selectedMonthDate;
      await renderMonth(shell);
    }
  );

  shell.querySelectorAll("[data-month-date]").forEach(btn => {
    btn.addEventListener("click", async () => {
      selectedMonthDate = btn.dataset.monthDate;

      const clickedMonth = localDate(selectedMonthDate).getMonth();
      if (clickedMonth !== monthNum) {
        selectedDate = selectedMonthDate;
      }

      await renderMonth(shell);
    });
  });

  shell.querySelector("#planning-add-event").addEventListener("click", () =>
    showEventModal(null, { date: selectedMonthDate })
  );
}

async function showEventModal(eventId = null, preset = {}) {
  const [events, projects] = await Promise.all([getAll("calendarEvents"), getAll("projects")]);
  const event = events.find(e => e.id === eventId);
  const activeProjects = projects.filter(project => project.active !== false && (project.status || "active") !== "completed");

  openModal(`
    <div class="modal-head">
      <div>
        <p class="eyebrow">PLANNING</p>
        <h2>${event ? "Modifier" : "Nouvel"} événement</h2>
      </div>
      <button class="icon-btn" id="planning-event-close">×</button>
    </div>

    <form class="form-grid" id="planning-event-form">
      <div class="field">
        <label>Titre</label>
        <input name="title" required maxlength="120" value="${escapeHtml(event?.title || preset.title || "")}" placeholder="Ex : Dentiste">
      </div>

      <div class="row">
        <div class="field">
          <label>Date</label>
          <input type="date" name="date" required value="${event?.date || preset.date || todayISO()}">
        </div>

        <div class="field">
          <label>Heure</label>
          <input type="time" name="time" value="${event?.time || preset.time || ""}">
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>Durée (min)</label>
          <input type="number" name="duration" min="0" step="5" value="${event?.duration ?? preset.duration ?? ""}" placeholder="60">
        </div>

        <div class="field">
          <label>Catégorie</label>
          <input name="category" maxlength="50" value="${escapeHtml(event?.category || preset.category || "")}" placeholder="Perso, Santé…">
        </div>
      </div>

      <div class="field">
        <label>Lieu</label>
        <input name="location" maxlength="120" value="${escapeHtml(event?.location || preset.location || "")}" placeholder="Facultatif">
      </div>

      <div class="field">
        <label>Répétition</label>
        <select name="recurrence" id="planning-recurrence">
          <option value="none" ${!event || event.recurrence === "none" ? "selected" : ""}>Aucune</option>
          <option value="daily" ${event?.recurrence === "daily" ? "selected" : ""}>Tous les jours</option>
          <option value="weekly" ${event?.recurrence === "weekly" ? "selected" : ""}>Toutes les semaines</option>
          <option value="monthly" ${event?.recurrence === "monthly" ? "selected" : ""}>Tous les mois</option>
        </select>
      </div>

      <div class="field" id="planning-repeat-until-wrap">
        <label>Répéter jusqu'au</label>
        <input type="date" name="repeatUntil" value="${event?.repeatUntil || ""}">
      </div>

      <div class="field">
        <label>Projet lié</label>
        <select name="projectId">
          <option value="">Aucun projet</option>
          ${activeProjects.map(project => `<option value="${project.id}" ${(event?.projectId || preset.projectId || "") === project.id ? "selected" : ""}>${escapeHtml(project.title)}</option>`).join("")}
        </select>
      </div>

      <div class="field">
        <label>Notes</label>
        <textarea name="notes" placeholder="Informations complémentaires">${escapeHtml(event?.notes || preset.notes || "")}</textarea>
      </div>

      <div class="actions">
        <button type="button" class="ghost-btn" id="planning-event-cancel">Annuler</button>
        <button class="primary-btn" type="submit">Enregistrer</button>
      </div>
    </form>
  `);

  const recurrence = document.querySelector("#planning-recurrence");
  const untilWrap = document.querySelector("#planning-repeat-until-wrap");

  const refreshRepeat = () => {
    untilWrap.style.display = recurrence.value === "none" ? "none" : "block";
  };

  refreshRepeat();
  recurrence.addEventListener("change", refreshRepeat);

  document.querySelector("#planning-event-close").addEventListener("click", closeModal);
  document.querySelector("#planning-event-cancel").addEventListener("click", closeModal);

  document.querySelector("#planning-event-form").addEventListener("submit", async submitEvent => {
    submitEvent.preventDefault();

    const fd = new FormData(submitEvent.target);
    const date = String(fd.get("date") || todayISO());
    const repeatUntil = String(fd.get("repeatUntil") || "");
    const recurrenceValue = String(fd.get("recurrence") || "none");

    if (repeatUntil && repeatUntil < date) {
      alert("La fin de répétition doit être postérieure à la date de départ.");
      return;
    }

    const saved = {
      ...(event || {}),
      id: event?.id || uid("calendar_event"),
      title: String(fd.get("title") || "").trim(),
      date,
      time: String(fd.get("time") || ""),
      duration: Number(fd.get("duration") || 0),
      category: String(fd.get("category") || "").trim(),
      location: String(fd.get("location") || "").trim(),
      recurrence: recurrenceValue,
      repeatUntil: recurrenceValue === "none" ? "" : repeatUntil,
      projectId: String(fd.get("projectId") || "") || null,
      notes: String(fd.get("notes") || "").trim(),
      createdAt: event?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await putOne("calendarEvents", saved);

    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));

    selectedDate = saved.date;
    selectedMonthDate = saved.date;
    currentView = "today";
    await renderCurrentView();
  });
}

async function renderEventDetail(shell, eventId) {
  const events = await getAll("calendarEvents");
  const event = events.find(e => e.id === eventId);

  if (!event) {
    currentEventId = null;
    currentView = "today";
    await renderCurrentView();
    return;
  }

  shell.innerHTML = `
    <button class="stock-back" id="planning-detail-back">‹ Planning</button>

    <div class="planning-hero">
      <span>ÉVÉNEMENT</span>
      <strong>${escapeHtml(event.title)}</strong>
      <small>${formatLong(event.date)}${event.time ? ` · ${event.time}` : ""}</small>
    </div>

    <section class="planning-detail-card">
      <h3>Informations</h3>
      <div class="planning-detail-row"><span>Date</span><strong>${formatLong(event.date)}</strong></div>
      <div class="planning-detail-row"><span>Heure</span><strong>${event.time || "Toute la journée"}</strong></div>
      <div class="planning-detail-row"><span>Durée</span><strong>${event.duration ? `${event.duration} min` : "Non renseignée"}</strong></div>
      <div class="planning-detail-row"><span>Catégorie</span><strong>${escapeHtml(event.category || "Personnel")}</strong></div>
      <div class="planning-detail-row"><span>Lieu</span><strong>${escapeHtml(event.location || "—")}</strong></div>
      <div class="planning-detail-row"><span>Répétition</span><strong>${recurrenceLabel(event.recurrence)}</strong></div>
      ${
        event.recurrence && event.recurrence !== "none"
          ? `<div class="planning-detail-row"><span>Jusqu'au</span><strong>${event.repeatUntil ? formatLong(event.repeatUntil) : "Sans fin"}</strong></div>`
          : ""
      }
    </section>

    ${
      event.notes
        ? `<section class="planning-detail-card"><h3>Notes</h3><p class="muted" style="margin:0;line-height:1.55">${escapeHtml(event.notes)}</p></section>`
        : ""
    }

    <div class="planning-detail-actions">
      <button class="primary-btn" id="planning-detail-edit">Modifier</button>
      <button class="danger-btn" id="planning-detail-delete">Supprimer${event.recurrence && event.recurrence !== "none" ? " la série" : ""}</button>
    </div>
  `;

  shell.querySelector("#planning-detail-back").addEventListener("click", async () => {
    currentEventId = null;
    currentView = "today";
    selectedDate = event.date;
    await renderCurrentView();
  });

  shell.querySelector("#planning-detail-edit").addEventListener("click", () => showEventModal(event.id));

  shell.querySelector("#planning-detail-delete").addEventListener("click", async () => {
    const message = event.recurrence && event.recurrence !== "none"
      ? `Supprimer "${event.title}" et toute sa série ?`
      : `Supprimer "${event.title}" ?`;

    if (!confirm(message)) return;

    await deleteOne("calendarEvents", event.id);
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));

    currentEventId = null;
    currentView = "today";
    selectedDate = event.date;
    await renderCurrentView();
  });
}

export async function getPlanningSummary() {
  const today = todayISO();
  const data = await getPlanningData(today, today);
  const rows = data.rows;

  return {
    today: rows.length,
    events: rows.filter(r => r.source === "event").length,
    tasks: rows.filter(r => r.source === "task" && !r.done).length,
    objectives: rows.filter(r => r.source === "objective" && !r.done).length,
    sports: rows.filter(r => r.source === "sport").length,
    nextLabel: rows[0]?.title || null,
    nextTime: rows[0]?.time || ""
  };
}


export async function getPlanningDayItems(date = todayISO()) {
  const data = await getPlanningData(date, date);
  return data.rows;
}
