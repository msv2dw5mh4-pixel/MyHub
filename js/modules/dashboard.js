import { getTasksSummary } from "./tasks.js";
import { getStockSummary } from "./stock.js";
import { getTrackerSummary } from "./tracker.js";
import { getSportSummary } from "./sport.js";
import { getObjectivesSummary } from "./objectives.js";
import { getPlanningSummary, getPlanningDayItems } from "./planning.js";
import { getMaintenanceSummary } from "./maintenance.js";
import { syncMaintenanceTasks } from "../core/maintenance_tasks.js";
import { getDocumentsSummary } from "./documents.js";
import { getBudgetSummary } from "./budget.js";
import { getProjectsSummary } from "./projects.js";
import { syncDocumentTasks } from "../core/document_tasks.js";
import { getLearningSummary } from "./learning.js";
import { getIdeasSummary } from "./ideas.js";
import { syncLearningObjective } from "../core/learning_sync.js";
import { getGlobalStatsSummary } from "./stats.js";
import { getLivingSummary } from "./living.js";
import { syncLivingCareTasks } from "../core/living_tasks.js";
import { getBackupStatus } from "../core/backup.js";
import { getPeopleSummary } from "./people.js";

function formatMoney(value) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

function formatSignedMoney(value) {
  const n = Number(value) || 0;
  const f = formatMoney(Math.abs(n));
  return n > 0 ? `+${f}` : n < 0 ? `-${f}` : f;
}

function formatDuration(minutes) {
  const total = Number(minutes) || 0;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

function moduleCard({ icon, name, value, sub, route }) {
  return `
    <article class="dashboard-module" data-route="${route}">
      <div class="icon">${icon}</div>
      <div class="label">${name}</div>
      <div class="value">${value}</div>
      <div class="sub">${sub}</div>
    </article>
  `;
}

function alertRow({ icon, title, subtitle, count, route, level = "warning" }) {
  return `
    <article class="dashboard-alert ${level}" data-route="${route}">
      <div class="icon">${icon}</div>
      <div class="dashboard-alert-main">
        <strong>${title}</strong>
        <small>${subtitle}</small>
      </div>
      <div class="count">${count}</div>
    </article>
  `;
}

function sourceLabel(source) {
  if (source === "task") return "Tâche";
  if (source === "objective") return "Objectif";
  if (source === "sport") return "Sport";
  if (source === "project") return "Projet";
  if (source === "learning") return "Apprentissage";
  return "Événement";
}

function sourceRoute(row) {
  if (row.route) return row.route;
  if (row.source === "task") return "tasks";
  if (row.source === "objective") return "objectives";
  if (row.source === "sport") return "sport";
  if (row.source === "project") return "projects";
  if (row.source === "learning") return "learning";
  return "planning";
}

function bindRoutes(container) {
  container.querySelectorAll("[data-route]").forEach(item => {
    item.addEventListener("click", () => {
      const route = item.dataset.route;
      if (!route) return;
      window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: route }));
    });
  });
}

export async function renderDashboard(container) {
  await syncMaintenanceTasks();
  await syncDocumentTasks();
  await syncLearningObjective();
  await syncLivingCareTasks();

  const [
    planning,
    dayItems,
    maintenance,
    documents,
    budget,
    projects,
    learning,
    ideas,
    tasks,
    stock,
    tracker,
    sport,
    objectives,
    globalStats,
    living,
    backup,
    people
  ] = await Promise.all([
    getPlanningSummary(),
    getPlanningDayItems(),
    getMaintenanceSummary(),
    getDocumentsSummary(),
    getBudgetSummary(),
    getProjectsSummary(),
    getLearningSummary(),
    getIdeasSummary(),
    getTasksSummary(),
    getStockSummary(),
    getTrackerSummary(),
    getSportSummary(),
    getObjectivesSummary(),
    getGlobalStatsSummary(),
    getLivingSummary(),
    getBackupStatus(),
    getPeopleSummary()
  ]);

  const today = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(new Date());

  const alerts = [
    backup.due
      ? {
          icon: "💾",
          title: "Sauvegarde MyHub recommandée",
          subtitle: backup.last
            ? `Dernière sauvegarde il y a ${backup.ageDays} jour${backup.ageDays > 1 ? "s" : ""}.`
            : "Aucune sauvegarde complète enregistrée sur cet appareil.",
          count: "!",
          route: "settings",
          level: "warning"
        }
      : null,
    people.upcoming
      ? {
          icon: "👥",
          title: "Personnes à ne pas oublier",
          subtitle: people.nextLabel
            ? `${people.nextLabel}${people.nextDate ? ` · ${people.nextDate.split("-").reverse().join("/")}` : ""}.`
            : "Un anniversaire ou événement approche.",
          count: people.upcoming,
          route: "people",
          level: "warning"
        }
      : null,
    tasks.late
      ? {
          icon: "✓",
          title: "Tâches en retard",
          subtitle: "À traiter pour remettre la journée à plat.",
          count: tasks.late,
          route: "tasks",
          level: "danger"
        }
      : null,
    tracker.configured && tracker.essentialUnanswered
      ? {
          icon: "⭐",
          title: "Essentiels du Tracker",
          subtitle: `${tracker.essentialUnanswered} habitude${tracker.essentialUnanswered > 1 ? "s" : ""} essentielle${tracker.essentialUnanswered > 1 ? "s" : ""} reste${tracker.essentialUnanswered > 1 ? "nt" : ""} à renseigner.`,
          count: tracker.essentialUnanswered,
          route: "tracker"
        }
      : null,
    maintenance.due
      ? {
          icon: "🔧",
          title: "Entretiens à réaliser",
          subtitle: `${maintenance.soon} autre${maintenance.soon > 1 ? "s" : ""} approche${maintenance.soon > 1 ? "nt" : ""}.`,
          count: maintenance.due,
          route: "maintenance",
          level: "danger"
        }
      : null,
    documents.due
      ? {
          icon: "📂",
          title: "Documents à renouveler",
          subtitle: `${documents.soon} échéance${documents.soon > 1 ? "s" : ""} bientôt.`,
          count: documents.due,
          route: "documents",
          level: "danger"
        }
      : null,
    objectives.behind
      ? {
          icon: "🎯",
          title: "Objectifs à surveiller",
          subtitle: `${objectives.averageProgress} % de progression moyenne.`,
          count: objectives.behind,
          route: "objectives"
        }
      : null,
    ideas.inbox
      ? {
          icon: "💡",
          title: "Idées à traiter",
          subtitle: "Décide lesquelles transformer en action.",
          count: ideas.inbox,
          route: "ideas"
        }
      : null,
    living.due
      ? {
          icon: "🌿",
          title: "Aquariums & plantes",
          subtitle: `${living.upcoming} soin${living.upcoming > 1 ? "s" : ""} à venir.`,
          count: living.due,
          route: "living"
        }
      : null
  ].filter(Boolean);

  const moduleCards = [
    {
      icon: "📊",
      name: "Stats globales",
      value: `${globalStats.tasksCompleted} tâches`,
      sub: `${globalStats.sportSessions} sport · ${formatDuration(globalStats.learningMinutes)} appris`,
      route: "stats"
    },
    {
      icon: "📅",
      name: "Planning",
      value: `${planning.today} aujourd'hui`,
      sub: planning.nextLabel
        ? `${planning.nextTime ? `${planning.nextTime} · ` : ""}${planning.nextLabel}`
        : "Journée libre",
      route: "planning"
    },
    {
      icon: "✓",
      name: "Tâches",
      value: `${tasks.open} en cours`,
      sub: tasks.late ? `${tasks.late} en retard` : "Rien en retard",
      route: "tasks"
    },
    {
      icon: "✅",
      name: "Tracker",
      value: tracker.configured && tracker.score !== null ? `${tracker.score} %` : "— %",
      sub: tracker.configured
        ? (tracker.essentialTotal ? `⭐ Essentiel ${tracker.essentialScore ?? "—"} % · objectif ${tracker.goal} %` : `Objectif ${tracker.goal} %`)
        : "À configurer",
      route: "tracker"
    },
    {
      icon: "🏋️",
      name: "Sport",
      value: `${sport.countWeek} cette semaine`,
      sub: sport.nextPlannedLabel
        ? `Prochaine : ${sport.nextPlannedLabel}`
        : (sport.latestLabel ? `Dernier : ${sport.latestLabel}` : "Aucune activité"),
      route: "sport"
    },
    {
      icon: "🧠",
      name: "Apprentissage",
      value: formatDuration(learning.weekMinutes),
      sub: `${learning.active} actif${learning.active > 1 ? "s" : ""}`,
      route: "learning"
    },
    {
      icon: "🎯",
      name: "Objectifs",
      value: `${objectives.active} actif${objectives.active > 1 ? "s" : ""}`,
      sub: `${objectives.averageProgress} % moyen`,
      route: "objectives"
    },
    {
      icon: "🏠",
      name: "Projets",
      value: `${projects.active} actif${projects.active > 1 ? "s" : ""}`,
      sub: `${projects.averageProgress} % moyen`,
      route: "projects"
    },
    {
      icon: "💰",
      name: "Budget",
      value: formatSignedMoney(budget.available),
      sub: `${formatMoney(budget.savings)} épargnés`,
      route: "budget"
    },
    {
      icon: "📦",
      name: "Stock",
      value: formatSignedMoney(stock.profit),
      sub: `${stock.forSale} en vente`,
      route: "stock"
    },
    {
      icon: "🔧",
      name: "Entretien",
      value: maintenance.due ? `${maintenance.due} à faire` : `${maintenance.assets} biens`,
      sub: maintenance.soon ? `${maintenance.soon} bientôt` : "À jour",
      route: "maintenance"
    },
    {
      icon: "📂",
      name: "Documents",
      value: documents.due ? `${documents.due} à renouveler` : `${documents.total} suivis`,
      sub: documents.soon ? `${documents.soon} bientôt` : "À jour",
      route: "documents"
    },
    {
      icon: "🌿",
      name: "Aquariums & Plantes",
      value: `${living.aquariums} bac${living.aquariums > 1 ? "s" : ""} · ${living.plants} plante${living.plants > 1 ? "s" : ""}`,
      sub: living.due ? `${living.due} soin${living.due > 1 ? "s" : ""} à faire` : "À jour",
      route: "living"
    },
    {
      icon: "👥",
      name: "Personnes",
      value: `${people.people} personne${people.people === 1 ? "" : "s"}`,
      sub: people.upcoming
        ? `${people.upcoming} rappel${people.upcoming === 1 ? "" : "s"} à surveiller`
        : `${people.groups} groupe${people.groups === 1 ? "" : "s"}`,
      route: "people"
    },
    {
      icon: "💡",
      name: "Idées",
      value: `${ideas.inbox} à traiter`,
      sub: `${ideas.converted} transformée${ideas.converted > 1 ? "s" : ""}`,
      route: "ideas"
    }
  ];

  container.innerHTML = `
    <section class="dashboard-shell">
      <div class="dashboard-hero-v27">
        <div class="dashboard-hero-copy">
          <p class="date">${today}</p>
          <div class="dashboard-hero-line">
            <h2>${planning.today ? `${planning.today} élément${planning.today > 1 ? "s" : ""} aujourd'hui` : "Rien d'urgent aujourd'hui"}</h2>
            ${alerts.length ? `<span class="dashboard-attention-badge">${alerts.length} à voir</span>` : `<span class="dashboard-attention-badge calm">À jour</span>`}
          </div>
          <p>${planning.nextLabel ? `Prochain : ${planning.nextTime ? `${planning.nextTime} · ` : ""}${planning.nextLabel}` : "Ta journée est légère."}</p>
        </div>
        <div class="dashboard-hero-actions-v27">
          <button class="dashboard-main-action" data-route="planning">Voir ma journée</button>
          <button class="dashboard-secondary-action" id="dashboard-quick-add">＋ Ajouter</button>
        </div>
      </div>

      <section class="dashboard-glance" aria-label="Résumé du jour">
        <article data-route="tasks" class="dashboard-glance-card ${tasks.late ? "danger" : ""}">
          <span>✓ Tâches</span>
          <strong>${tasks.late ? `${tasks.late} retard${tasks.late > 1 ? "s" : ""}` : `${tasks.dueToday} aujourd'hui`}</strong>
          <small>${tasks.open} ouvertes</small>
        </article>
        <article data-route="tracker" class="dashboard-glance-card">
          <span>✅ Tracker</span>
          <strong>${tracker.configured && tracker.score !== null ? `${tracker.score} %` : "À remplir"}</strong>
          <small>${tracker.essentialTotal ? `⭐ ${tracker.essentialScore ?? "—"} % essentiel` : `Objectif ${tracker.goal ?? "—"} %`}</small>
        </article>
        <article data-route="sport" class="dashboard-glance-card">
          <span>🏋️ Sport</span>
          <strong>${sport.countWeek} cette semaine</strong>
          <small>${sport.nextPlannedLabel ? sport.nextPlannedLabel : (sport.latestLabel || "Aucune activité")}</small>
        </article>
        <article data-route="budget" class="dashboard-glance-card">
          <span>💰 Budget</span>
          <strong>${formatSignedMoney(budget.available)}</strong>
          <small>disponible ce mois</small>
        </article>
      </section>

      ${alerts.length ? `
        <section class="dashboard-section dashboard-attention-section">
          <div class="dashboard-section-head">
            <div>
              <h2>À traiter</h2>
              <p>Uniquement ce qui demande vraiment ton attention.</p>
            </div>
          </div>
          <div class="dashboard-alerts">
            ${alerts.map(alertRow).join("")}
          </div>
        </section>
      ` : ""}

      <section class="dashboard-section dashboard-today-section">
        <div class="dashboard-section-head">
          <div>
            <h2>Aujourd'hui</h2>
            <p>Ton prochain passage à l'action.</p>
          </div>
          <button class="dashboard-text-btn" data-route="planning">Tout voir</button>
        </div>

        <div class="dashboard-timeline">
          ${
            dayItems.length
              ? dayItems.slice(0,5).map(row => `
                  <article class="dashboard-timeline-item" data-route="${sourceRoute(row)}">
                    <div class="dashboard-timeline-time">${row.time || "Journée"}</div>
                    <i class="dashboard-timeline-dot ${row.source}"></i>
                    <div class="dashboard-timeline-main">
                      <strong>${row.done ? "✓ " : ""}${String(row.title || "").replace(/[&<>"']/g, ch => ({
                        "&": "&amp;",
                        "<": "&lt;",
                        ">": "&gt;",
                        '"': "&quot;",
                        "'": "&#039;"
                      }[ch]))}</strong>
                      <small>${sourceLabel(row.source)}${row.subtitle ? ` · ${String(row.subtitle).replace(/[&<>"']/g, "")}` : ""}</small>
                    </div>
                    <span class="dashboard-row-chevron">›</span>
                  </article>
                `).join("")
              : `<div class="dashboard-empty-v27"><strong>Journée libre</strong><span>Rien n'est prévu aujourd'hui.</span></div>`
          }
        </div>
      </section>

      <section class="dashboard-section">
        <div class="dashboard-section-head">
          <div>
            <h2>Mes modules</h2>
            <p>Accès rapide à tout MyHub.</p>
          </div>
          <button class="dashboard-text-btn" data-route="modules">Tous</button>
        </div>

        <div class="dashboard-module-grid dashboard-module-grid-v27">
          ${moduleCards.map(moduleCard).join("")}
        </div>
      </section>
    </section>
  `;

  bindRoutes(container);
  container.querySelector("#dashboard-quick-add")?.addEventListener("click", () => {
    document.getElementById("quick-add")?.click();
  });
}
