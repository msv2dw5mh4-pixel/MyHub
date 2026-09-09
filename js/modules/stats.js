import { getAll } from "../core/db.js";
import { escapeHtml, todayISO } from "../core/ui.js";
import { getObjectivesSummary } from "./objectives.js";
import { getProjectsSummary } from "./projects.js";
import { trackerItemScheduled, trackerThresholdResult } from "../core/tracker_automation.js";
import { maintenancePlanStatus } from "../core/maintenance_tasks.js";
import { documentStatus } from "../core/document_tasks.js";
import { getSportRecords } from "../core/sport_insights.js";

let periodType = "month";
let anchorDate = todayISO();
let lastContainer = null;
let statsView = "overview";

export async function renderStats(container) {
  lastContainer = container;
  container.innerHTML = `<section class="stats-shell" id="stats-shell"></section>`;
  await renderCurrent();
}

function localDate(dateString) {
  return new Date(`${dateString}T12:00:00`);
}

function iso(date) {
  const copy = new Date(date);
  const offset = copy.getTimezoneOffset();
  return new Date(copy.getTime() - offset * 60000).toISOString().slice(0,10);
}

function addDays(dateString, days) {
  const d = localDate(dateString);
  d.setDate(d.getDate() + Number(days || 0));
  return iso(d);
}

function addMonths(dateString, months) {
  const d = localDate(dateString);
  d.setDate(1);
  d.setMonth(d.getMonth() + Number(months || 0));
  return iso(d);
}

function addYears(dateString, years) {
  const d = localDate(dateString);
  d.setFullYear(d.getFullYear() + Number(years || 0));
  return iso(d);
}

function mondayOf(dateString) {
  const d = localDate(dateString);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return iso(d);
}

function firstOfMonth(dateString) {
  const d = localDate(dateString);
  d.setDate(1);
  return iso(d);
}

function lastOfMonth(dateString) {
  const d = localDate(dateString);
  d.setMonth(d.getMonth() + 1, 0);
  return iso(d);
}

function firstOfYear(dateString) {
  return `${String(dateString).slice(0,4)}-01-01`;
}

function lastOfYear(dateString) {
  return `${String(dateString).slice(0,4)}-12-31`;
}

function dateOnly(value) {
  if (!value) return "";
  return String(value).slice(0,10);
}

function inRange(date, range) {
  const value = dateOnly(date);
  return Boolean(value && value >= range.start && value <= range.end);
}

function formatDate(dateString, options = {}) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...options
  }).format(localDate(dateString));
}

function formatMoney(value) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

function formatDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

function signed(value, suffix = "") {
  const n = Number(value) || 0;
  return `${n > 0 ? "+" : ""}${n}${suffix}`;
}

function rangeFor(type, anchor) {
  if (type === "week") {
    const start = mondayOf(anchor);
    return { start, end: addDays(start, 6) };
  }

  if (type === "year") {
    return { start: firstOfYear(anchor), end: lastOfYear(anchor) };
  }

  if (type === "all") {
    return { start: "1900-01-01", end: todayISO() };
  }

  return { start: firstOfMonth(anchor), end: lastOfMonth(anchor) };
}

function previousRange(type, anchor) {
  if (type === "week") {
    const previousAnchor = addDays(anchor, -7);
    return rangeFor(type, previousAnchor);
  }

  if (type === "year") {
    return rangeFor(type, addYears(anchor, -1));
  }

  if (type === "month") {
    return rangeFor(type, addMonths(anchor, -1));
  }

  return null;
}

function periodLabel(type, range) {
  if (type === "week") {
    return `${formatDate(range.start, { year: undefined })} → ${formatDate(range.end)}`;
  }

  if (type === "year") {
    return String(range.start).slice(0,4);
  }

  if (type === "all") {
    return "Depuis le début";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric"
  }).format(localDate(range.start));
}

function previousAnchor() {
  if (periodType === "week") return addDays(anchorDate, -7);
  if (periodType === "month") return addMonths(anchorDate, -1);
  if (periodType === "year") return addYears(anchorDate, -1);
  return anchorDate;
}

function nextAnchor() {
  if (periodType === "week") return addDays(anchorDate, 7);
  if (periodType === "month") return addMonths(anchorDate, 1);
  if (periodType === "year") return addYears(anchorDate, 1);
  return anchorDate;
}

async function loadRaw() {
  const [
    tasks,
    trackerItems,
    trackerEntries,
    sportSessions,
    budgetTransactions,
    products,
    learningSessions,
    maintenanceRecords,
    maintenanceAssets,
    maintenancePlans,
    documents,
    ideas,
    calendarEvents,
    objectives,
    projects
  ] = await Promise.all([
    getAll("tasks"),
    getAll("trackerItems"),
    getAll("trackerEntries"),
    getAll("sportSessions"),
    getAll("budgetTransactions"),
    getAll("products"),
    getAll("learningSessions"),
    getAll("maintenanceRecords"),
    getAll("maintenanceAssets"),
    getAll("maintenancePlans"),
    getAll("documents"),
    getAll("ideas"),
    getAll("calendarEvents"),
    getAll("objectives"),
    getAll("projects")
  ]);

  return {
    tasks,
    trackerItems,
    trackerEntries,
    sportSessions,
    budgetTransactions,
    products,
    learningSessions,
    maintenanceRecords,
    maintenanceAssets,
    maintenancePlans,
    documents,
    ideas,
    calendarEvents,
    objectives,
    projects
  };
}

function liveMaintenanceSummary(data) {
  const activeAssets = new Map(
    data.maintenanceAssets
      .filter(asset => asset.active !== false && !["sold", "retired"].includes(asset.ownershipStatus))
      .map(asset => [asset.id, asset])
  );

  const statuses = data.maintenancePlans
    .filter(plan => plan.active !== false && activeAssets.has(plan.assetId))
    .map(plan => maintenancePlanStatus(plan, activeAssets.get(plan.assetId)));

  return {
    due: statuses.filter(status => status.state === "due").length,
    soon: statuses.filter(status => status.state === "soon").length
  };
}

function liveDocumentsSummary(data) {
  const statuses = data.documents
    .filter(doc => doc.active !== false)
    .map(doc => documentStatus(doc));

  return {
    due: statuses.filter(status => status.state === "due").length,
    soon: statuses.filter(status => status.state === "soon").length
  };
}

function trackerStats(data, range) {
  const itemMap = new Map(
    data.trackerItems
      .filter(item =>
        item.active !== false &&
        item.scoreIncluded !== false &&
        (item.type === "habit" || item.thresholdEnabled === true)
      )
      .map(item => [item.id, item])
  );

  let yes = 0;
  let no = 0;
  const days = new Set();

  data.trackerEntries
    .filter(entry => itemMap.has(entry.itemId) && inRange(entry.date, range))
    .forEach(entry => {
      const item = itemMap.get(entry.itemId);
      if (!trackerItemScheduled(item, entry.date)) return;
      if (item.type === "habit" && entry.value === "na") return;

      let result = null;
      if (item.type === "habit") {
        if (entry.value === "yes") result = true;
        if (entry.value === "no") result = false;
      } else {
        result = trackerThresholdResult(item, entry.value);
      }

      if (result === true) {
        yes++;
        days.add(entry.date);
      } else if (result === false) {
        no++;
        days.add(entry.date);
      }
    });

  const score = yes + no ? Math.round((yes / (yes + no)) * 100) : null;
  return { yes, no, score, days: days.size };
}

function taskStats(data, range) {
  const due = data.tasks.filter(task => inRange(task.dueDate, range));
  const dueDone = due.filter(task => task.done).length;
  const completed = data.tasks.filter(task => inRange(task.completedAt, range)).length;
  const created = data.tasks.filter(task => inRange(task.createdAt, range)).length;

  return {
    due: due.length,
    dueDone,
    rate: due.length ? Math.round((dueDone / due.length) * 100) : null,
    completed,
    created
  };
}

function sportStats(data, range) {
  const sessions = data.sportSessions.filter(session =>
    session.status === "completed" &&
    inRange(session.date, range)
  );

  const workout = sessions.filter(session => session.type === "workout").length;
  const free = sessions.filter(session => session.type === "activity").length;
  const duration = sessions.reduce((sum, session) => sum + Number(session.duration || session.durationMin || 0), 0);
  const distance = sessions.reduce((sum, session) => sum + Number(session.distanceKm || 0), 0);

  return {
    sessions: sessions.length,
    workout,
    free,
    duration,
    distance
  };
}

function learningStats(data, range) {
  const sessions = data.learningSessions.filter(session => inRange(session.date, range));
  return {
    sessions: sessions.length,
    minutes: sessions.reduce((sum, session) => sum + Number(session.minutes || 0), 0)
  };
}

function financeStats(data, range) {
  const tx = data.budgetTransactions.filter(row => inRange(row.date, range));
  const income = tx.filter(row => row.type === "income").reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const expenses = tx.filter(row => row.type === "expense").reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const savings = tx.filter(row => row.type === "saving").reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const stockSold = data.products.filter(product =>
    product.status === "sold" &&
    inRange(product.saleDate, range)
  );

  const stockProfit = stockSold.reduce((sum, product) =>
    sum +
    Number(product.salePrice || 0) -
    Number(product.purchasePrice || 0) -
    Number(product.fees || 0)
  , 0);

  return {
    income,
    expenses,
    savings,
    available: income - expenses - savings,
    stockProfit,
    stockSales: stockSold.length
  };
}

function adminStats(data, range) {
  const maintenance = data.maintenanceRecords.filter(row => inRange(row.date, range));
  const convertedIdeas = data.ideas.filter(idea =>
    idea.status === "converted" &&
    inRange(idea.convertedAt, range)
  );

  const objectiveCompleted = data.objectives.filter(objective =>
    objective.status === "completed" &&
    inRange(objective.completedAt, range)
  );

  const projectsCompleted = data.projects.filter(project =>
    project.status === "completed" &&
    inRange(project.completedAt || project.updatedAt, range)
  );

  const eventStarts = data.calendarEvents.filter(event => inRange(event.date, range));

  return {
    maintenance: maintenance.length,
    maintenanceCost: maintenance.reduce((sum, row) => sum + Number(row.cost || 0), 0),
    ideasConverted: convertedIdeas.length,
    objectivesCompleted: objectiveCompleted.length,
    projectsCompleted: projectsCompleted.length,
    events: eventStarts.length
  };
}

function aggregate(data, range) {
  return {
    tracker: trackerStats(data, range),
    tasks: taskStats(data, range),
    sport: sportStats(data, range),
    learning: learningStats(data, range),
    finance: financeStats(data, range),
    admin: adminStats(data, range)
  };
}

function deltaClass(value, goodWhenPositive = true) {
  const n = Number(value) || 0;
  if (!n) return "";
  const good = goodWhenPositive ? n > 0 : n < 0;
  return good ? "good" : "bad";
}

function numberDelta(current, previous, suffix = "", goodWhenPositive = true) {
  if (previous === null || previous === undefined) return "";
  const diff = Math.round((Number(current) || 0) - (Number(previous) || 0));
  if (!diff) return `<span class="stats-delta">= période précédente</span>`;
  return `<span class="stats-delta ${deltaClass(diff, goodWhenPositive)}">${signed(diff, suffix)} vs précédente</span>`;
}

function moneyDelta(current, previous, goodWhenPositive = true) {
  if (previous === null || previous === undefined) return "";
  const diff = (Number(current) || 0) - (Number(previous) || 0);
  if (Math.abs(diff) < 0.01) return `<span class="stats-delta">= période précédente</span>`;
  const raw = formatMoney(Math.abs(diff));
  const label = `${diff > 0 ? "+" : "-"}${raw} vs précédente`;
  return `<span class="stats-delta ${deltaClass(diff, goodWhenPositive)}">${label}</span>`;
}

function pctDelta(current, previous, goodWhenPositive = true) {
  if (current === null || previous === null || previous === undefined) return "";
  const diff = Number(current) - Number(previous);
  if (!diff) return `<span class="stats-delta">= période précédente</span>`;
  return `<span class="stats-delta ${deltaClass(diff, goodWhenPositive)}">${signed(diff, " pts")} vs précédente</span>`;
}

function periodTabs() {
  return `
    <div class="stats-tabs">
      <button class="stats-tab ${periodType === "week" ? "active" : ""}" data-stats-period="week">Semaine</button>
      <button class="stats-tab ${periodType === "month" ? "active" : ""}" data-stats-period="month">Mois</button>
      <button class="stats-tab ${periodType === "year" ? "active" : ""}" data-stats-period="year">Année</button>
      <button class="stats-tab ${periodType === "all" ? "active" : ""}" data-stats-period="all">Global</button>
    </div>
  `;
}


function statsViewTabs() {
  return `
    <div class="stats-view-tabs">
      <button class="stats-view-tab ${statsView === "overview" ? "active" : ""}" data-stats-view="overview">Vue d'ensemble</button>
      <button class="stats-view-tab ${statsView === "records" ? "active" : ""}" data-stats-view="records">Records</button>
    </div>
  `;
}

function bindStatsViewTabs(shell) {
  shell.querySelectorAll("[data-stats-view]").forEach(btn => {
    btn.addEventListener("click", async () => {
      statsView = btn.dataset.statsView;
      await renderCurrent();
    });
  });
}

async function renderRecordsView(shell) {
  shell.innerHTML = `
    ${statsViewTabs()}
    <div class="stats-loading-card"><strong>Chargement des records…</strong><small>Lecture de tes séances sport enregistrées.</small></div>
  `;
  bindStatsViewTabs(shell);
  await new Promise(resolve => requestAnimationFrame(() => resolve()));

  try {
    const records = await getSportRecords();
    const formatRecordDate = value => value ? formatDate(String(value).slice(0,10)) : "Date inconnue";
    shell.innerHTML = `
      ${statsViewTabs()}
      <div class="stats-records-hero"><span>Records sportifs</span><strong>Sport → performance → date</strong><small>Les records sont calculés uniquement à partir des séances réellement terminées.</small></div>

      <section class="stats-record-sport">
        <div class="stats-section-head"><h2>🏃 Course à pied</h2><p>Meilleurs temps sur les distances de référence.</p></div>
        <div class="stats-record-list">
          ${records.running.length ? records.running.map(record => `<div class="stats-record-row"><div><strong>${escapeHtml(record.distanceLabel)}</strong><small>${formatRecordDate(record.date)}</small></div><b>${escapeHtml(record.valueLabel)}</b></div>`).join("") : `<div class="stats-empty-record">Aucun record course.</div>`}
        </div>
      </section>

      <section class="stats-record-sport">
        <div class="stats-section-head"><h2>🏊 Natation</h2><p>Meilleurs temps par distance.</p></div>
        <div class="stats-record-list">
          ${records.swimming.length ? records.swimming.map(record => `<div class="stats-record-row"><div><strong>${escapeHtml(record.distanceLabel)}</strong><small>${formatRecordDate(record.date)}</small></div><b>${escapeHtml(record.valueLabel)}</b></div>`).join("") : `<div class="stats-empty-record">Aucun record natation.</div>`}
        </div>
      </section>

      <section class="stats-record-sport">
        <div class="stats-section-head"><h2>🏋️ Musculation</h2><p>Ouvre un exercice pour voir ses records et leur historique.</p></div>
        <div class="stats-record-list">
          ${records.strength.length ? records.strength.map(record => `
            <details class="stats-record-exercise">
              <summary class="stats-record-row">
                <div><strong>${escapeHtml(record.name)}</strong><small>Record du ${formatRecordDate(record.bestSetDate || record.maxWeightDate)}</small></div>
                <b>${Number(record.bestSetWeight || 0).toLocaleString("fr-FR", {maximumFractionDigits:2})} kg × ${record.bestSetReps}</b>
              </summary>
              <div class="stats-record-detail">
                <div><span>Charge max</span><strong>${Number(record.maxWeight || 0).toLocaleString("fr-FR", {maximumFractionDigits:2})} kg × ${record.maxWeightReps}</strong><small>${formatRecordDate(record.maxWeightDate)}</small></div>
                <div><span>Meilleure série</span><strong>${Number(record.bestSetWeight || 0).toLocaleString("fr-FR", {maximumFractionDigits:2})} kg × ${record.bestSetReps}</strong><small>${formatRecordDate(record.bestSetDate)}</small></div>
                <div><span>Record répétitions</span><strong>${Number(record.bestRepsWeight || 0).toLocaleString("fr-FR", {maximumFractionDigits:2})} kg × ${record.bestReps}</strong><small>${formatRecordDate(record.bestRepsDate)}</small></div>
                ${record.history?.length ? `<div class="stats-record-history"><b>Historique des records</b>${[...record.history].reverse().map(item => `<span>${formatRecordDate(item.date)} · ${Number(item.weight || 0).toLocaleString("fr-FR", {maximumFractionDigits:2})} kg × ${item.reps}</span>`).join("")}</div>` : ""}
              </div>
            </details>
          `).join("") : `<div class="stats-empty-record">Aucun record musculation.</div>`}
        </div>
      </section>
    `;
    bindStatsViewTabs(shell);
  } catch (error) {
    console.error("Stats records :", error);
    shell.innerHTML = `${statsViewTabs()}<div class="stats-error-card"><strong>Impossible de charger les records</strong><small>${escapeHtml(error?.message || "Erreur de lecture locale.")}</small><button class="primary-btn" id="stats-records-retry">Réessayer</button></div>`;
    bindStatsViewTabs(shell);
    shell.querySelector("#stats-records-retry")?.addEventListener("click", () => renderRecordsView(shell));
  }
}

async function renderCurrent() {
  if (!lastContainer) return;
  const shell = lastContainer.querySelector("#stats-shell") || lastContainer;
  if (statsView === "records") return renderRecordsView(shell);

  shell.innerHTML = `
    ${statsViewTabs()}
    ${periodTabs()}
    <div class="stats-loading-card">
      <strong>Calcul des statistiques…</strong>
      <small>Lecture locale de tes données MyHub.</small>
    </div>
  `;

  // Laisse iOS afficher l'écran de chargement avant les calculs.
  await new Promise(resolve => requestAnimationFrame(() => resolve()));

  let data;
  let objectives;
  let projects;

  try {
    [data, objectives, projects] = await Promise.all([
      loadRaw(),
      getObjectivesSummary(),
      getProjectsSummary()
    ]);
  } catch (error) {
    console.error("Stats globales :", error);
    shell.innerHTML = `
      ${statsViewTabs()}
      ${periodTabs()}
      <div class="stats-error-card">
        <strong>Impossible de charger les statistiques</strong>
        <small>${escapeHtml(error?.message || "Erreur de lecture locale.")}</small>
        <button class="primary-btn" id="stats-retry">Réessayer</button>
      </div>
    `;
    shell.querySelector("#stats-retry")?.addEventListener("click", () => renderCurrent());
    bindStatsViewTabs(shell);
    shell.querySelectorAll("[data-stats-period]").forEach(btn => {
      btn.addEventListener("click", async () => {
        periodType = btn.dataset.statsPeriod;
        anchorDate = todayISO();
        await renderCurrent();
      });
    });
    return;
  }

  const maintenance = liveMaintenanceSummary(data);
  const documents = liveDocumentsSummary(data);
  const range = rangeFor(periodType, anchorDate);
  const prevRange = previousRange(periodType, anchorDate);
  const current = aggregate(data, range);
  const previous = prevRange ? aggregate(data, prevRange) : null;

  const trackerLabel = current.tracker.score === null ? "— %" : `${current.tracker.score} %`;
  const taskLabel = current.tasks.rate === null ? "— %" : `${current.tasks.rate} %`;
  const isAll = periodType === "all";

  shell.innerHTML = `
    ${statsViewTabs()}
    ${periodTabs()}

    <div class="stats-toolbar">
      <button class="stats-arrow" id="stats-prev" ${isAll ? "disabled" : ""}>‹</button>
      <div class="stats-period">
        <strong>${escapeHtml(periodLabel(periodType, range))}</strong>
        <small>${isAll ? "Toutes les données enregistrées" : `${formatDate(range.start)} → ${formatDate(range.end)}`}</small>
      </div>
      <button class="stats-arrow" id="stats-next" ${isAll ? "disabled" : ""}>›</button>
    </div>

    <div class="stats-hero">
      <span>Bilan global MyHub</span>
      <strong>${trackerLabel} Tracker · ${current.sport.sessions} sport</strong>
      <small>
        ${current.tasks.completed} tâche${current.tasks.completed > 1 ? "s" : ""} terminée${current.tasks.completed > 1 ? "s" : ""}
        · ${formatDuration(current.learning.minutes)} d'apprentissage
        · ${formatMoney(current.finance.savings)} d'épargne
      </small>
    </div>

    <section class="stats-section">
      <div class="stats-section-head">
        <h2>Rythme & habitudes</h2>
        <p>Tracker, tâches, sport et apprentissage.</p>
      </div>

      <div class="stats-grid">
        <article class="stats-card">
          <span>✅ Tracker moyen</span>
          <strong>${trackerLabel}</strong>
          <small>${current.tracker.days} jour${current.tracker.days > 1 ? "s" : ""} renseigné${current.tracker.days > 1 ? "s" : ""}</small>
          ${previous ? pctDelta(current.tracker.score, previous.tracker.score, true) : ""}
        </article>

        <article class="stats-card">
          <span>✓ Tâches à échéance faites</span>
          <strong>${taskLabel}</strong>
          <small>${current.tasks.dueDone}/${current.tasks.due} tâche${current.tasks.due > 1 ? "s" : ""} arrivée${current.tasks.due > 1 ? "s" : ""} à échéance</small>
          ${previous ? pctDelta(current.tasks.rate, previous.tasks.rate, true) : ""}
        </article>

        <article class="stats-card">
          <span>🏋️ Activités sportives</span>
          <strong>${current.sport.sessions}</strong>
          <small>${current.sport.workout} structurée${current.sport.workout > 1 ? "s" : ""} · ${current.sport.free} libre${current.sport.free > 1 ? "s" : ""}${current.sport.duration ? ` · ${formatDuration(current.sport.duration)}` : ""}${current.sport.distance ? ` · ${current.sport.distance.toFixed(1)} km` : ""}</small>
          ${previous ? numberDelta(current.sport.sessions, previous.sport.sessions, "", true) : ""}
        </article>

        <article class="stats-card">
          <span>🧠 Apprentissage</span>
          <strong>${formatDuration(current.learning.minutes)}</strong>
          <small>${current.learning.sessions} session${current.learning.sessions > 1 ? "s" : ""}</small>
          ${previous ? numberDelta(current.learning.minutes, previous.learning.minutes, " min", true) : ""}
        </article>
      </div>
    </section>

    <section class="stats-section">
      <div class="stats-section-head">
        <h2>Finances</h2>
        <p>Budget personnel et activité Stock.</p>
      </div>

      <div class="stats-grid">
        <article class="stats-card">
          <span>💰 Revenus</span>
          <strong>${formatMoney(current.finance.income)}</strong>
          ${previous ? moneyDelta(current.finance.income, previous.finance.income, true) : ""}
        </article>

        <article class="stats-card">
          <span>💳 Dépenses</span>
          <strong>${formatMoney(current.finance.expenses)}</strong>
          ${previous ? moneyDelta(current.finance.expenses, previous.finance.expenses, false) : ""}
        </article>

        <article class="stats-card">
          <span>🏦 Épargne</span>
          <strong>${formatMoney(current.finance.savings)}</strong>
          ${previous ? moneyDelta(current.finance.savings, previous.finance.savings, true) : ""}
        </article>

        <article class="stats-card">
          <span>📦 Marge Stock</span>
          <strong>${current.finance.stockProfit >= 0 ? "+" : ""}${formatMoney(current.finance.stockProfit)}</strong>
          <small>${current.finance.stockSales} vente${current.finance.stockSales > 1 ? "s" : ""}</small>
          ${previous ? moneyDelta(current.finance.stockProfit, previous.finance.stockProfit, true) : ""}
        </article>
      </div>
    </section>

    <section class="stats-section">
      <div class="stats-section-head">
        <h2>Projets & objectifs</h2>
        <p>Situation actuelle et réalisations de la période.</p>
      </div>

      <div class="stats-bars">
        <div class="stats-bar-row">
          <div class="stats-bar-head"><strong>🎯 Objectifs actifs</strong><span>${objectives.active} · ${objectives.averageProgress} % moyen</span></div>
          <div class="stats-bar"><i style="width:${Math.max(0, Math.min(100, objectives.averageProgress))}%"></i></div>
        </div>

        <div class="stats-bar-row">
          <div class="stats-bar-head"><strong>🏠 Projets actifs</strong><span>${projects.active} · ${projects.averageProgress} % moyen</span></div>
          <div class="stats-bar"><i style="width:${Math.max(0, Math.min(100, projects.averageProgress))}%"></i></div>
        </div>
      </div>

      <div class="stats-grid" style="margin-top:10px">
        <article class="stats-card">
          <span>Objectifs terminés sur la période</span>
          <strong>${current.admin.objectivesCompleted}</strong>
          ${previous ? numberDelta(current.admin.objectivesCompleted, previous.admin.objectivesCompleted, "", true) : ""}
        </article>

        <article class="stats-card">
          <span>Projets terminés sur la période</span>
          <strong>${current.admin.projectsCompleted}</strong>
          ${previous ? numberDelta(current.admin.projectsCompleted, previous.admin.projectsCompleted, "", true) : ""}
        </article>
      </div>
    </section>

    <section class="stats-section">
      <div class="stats-section-head">
        <h2>Vie pratique</h2>
        <p>Maintenance, documents, idées et événements.</p>
      </div>

      <div class="stats-table">
        <div class="stats-row">
          <strong>🔧 Entretiens réalisés</strong>
          <span>${formatMoney(current.admin.maintenanceCost)} dépensés</span>
          <b>${current.admin.maintenance}</b>
        </div>
        <div class="stats-row">
          <strong>💡 Idées transformées</strong>
          <span>Passées en action</span>
          <b>${current.admin.ideasConverted}</b>
        </div>
        <div class="stats-row">
          <strong>📅 Événements créés dans la période</strong>
          <span>Événements personnels</span>
          <b>${current.admin.events}</b>
        </div>
        <div class="stats-row">
          <strong>📂 Documents à renouveler maintenant</strong>
          <span>${documents.soon} bientôt</span>
          <b>${documents.due}</b>
        </div>
        <div class="stats-row">
          <strong>🔧 Entretiens à faire maintenant</strong>
          <span>${maintenance.soon} bientôt</span>
          <b>${maintenance.due}</b>
        </div>
        <div class="stats-row">
          <strong>🎯 Objectifs à surveiller maintenant</strong>
          <span>${objectives.active} actifs</span>
          <b>${objectives.behind}</b>
        </div>
      </div>
    </section>
  `;

  bindStatsViewTabs(shell);
  shell.querySelectorAll("[data-stats-period]").forEach(btn => {
    btn.addEventListener("click", async () => {
      periodType = btn.dataset.statsPeriod;
      anchorDate = todayISO();
      await renderCurrent();
    });
  });

  const prev = shell.querySelector("#stats-prev");
  const next = shell.querySelector("#stats-next");

  prev.addEventListener("click", async () => {
    if (periodType === "all") return;
    anchorDate = previousAnchor();
    await renderCurrent();
  });

  next.addEventListener("click", async () => {
    if (periodType === "all") return;
    anchorDate = nextAnchor();
    await renderCurrent();
  });
}

export async function getGlobalStatsSummary() {
  const data = await loadRaw();
  const range = rangeFor("month", todayISO());
  const current = aggregate(data, range);

  return {
    trackerScore: current.tracker.score,
    tasksCompleted: current.tasks.completed,
    sportSessions: current.sport.sessions,
    learningMinutes: current.learning.minutes,
    savings: current.finance.savings,
    stockProfit: current.finance.stockProfit
  };
}
