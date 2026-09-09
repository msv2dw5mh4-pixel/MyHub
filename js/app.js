import { renderDashboard } from "./modules/dashboard.js";
import { renderStats } from "./modules/stats.js";
import { renderTasks, showAddTaskModal } from "./modules/tasks.js";
import { renderStock, requestNewProduct } from "./modules/stock.js";
import { renderTracker, requestNewTrackerItem, syncTrackerForToday } from "./modules/tracker.js";
import { renderSport, requestNewSportActivity } from "./modules/sport.js";
import { renderObjectives, requestNewObjective } from "./modules/objectives.js";
import { renderPlanning, requestNewPlanningEvent } from "./modules/planning.js";
import { renderMaintenance, requestNewMaintenanceAsset } from "./modules/maintenance.js";
import { renderLiving, requestNewLivingItem } from "./modules/living.js";
import { renderDocuments, requestNewDocument } from "./modules/documents.js";
import { renderBudget, requestNewBudgetEntry } from "./modules/budget.js";
import { renderProjects, requestNewProject } from "./modules/projects.js";
import { renderLearning, requestNewLearningTopic } from "./modules/learning.js";
import { renderIdeas, requestNewIdea } from "./modules/ideas.js";
import { renderPeople, requestNewPerson } from "./modules/people.js";
import { renderMeals, requestNewMeal, ensureMealsSeeded } from "./modules/meals.js";
import { renderShopping, requestNewShoppingItem } from "./modules/shopping.js";
import { renderModules } from "./modules/modules.js";
import { renderSettings } from "./modules/settings.js";
import { renderSearch } from "./modules/search.js";
import { openModal, closeModal } from "./core/ui.js";
import { syncRecurringObjectiveTasks } from "./core/objective_tasks.js";
import { syncMaintenanceTasks } from "./core/maintenance_tasks.js";
import { syncDocumentTasks } from "./core/document_tasks.js";
import { syncLearningObjective } from "./core/learning_sync.js";
import { syncSportPlanTasks } from "./core/sport_planner.js";
import { syncLivingCareTasks } from "./core/living_tasks.js";
import { syncPeopleReminderTasks } from "./core/people_tasks.js";

const view = document.getElementById("view");
const pageTitle = document.getElementById("page-title");

const routes = {
  dashboard: { title: "Tableau de bord", render: renderDashboard },
  stats: { title: "Stats globales", render: renderStats },
  planning: { title: "Planning", render: renderPlanning },
  maintenance: { title: "Entretien", render: renderMaintenance },
  living: { title: "Aquariums & Plantes", render: renderLiving },
  documents: { title: "Documents", render: renderDocuments },
  budget: { title: "Budget", render: renderBudget },
  projects: { title: "Projets", render: renderProjects },
  learning: { title: "Apprentissage", render: renderLearning },
  ideas: { title: "Idées", render: renderIdeas },
  people: { title: "Personnes", render: renderPeople },
  meals: { title: "Repas", render: renderMeals },
  shopping: { title: "Courses", render: renderShopping },
  tasks: { title: "Tâches", render: renderTasks },
  stock: { title: "Stock", render: renderStock },
  tracker: { title: "Tracker", render: renderTracker },
  sport: { title: "Sport", render: renderSport },
  objectives: { title: "Objectifs", render: renderObjectives },
  modules: { title: "Modules", render: renderModules },
  settings: { title: "Réglages", render: renderSettings },
  search: { title: "Recherche", render: renderSearch }
};

let currentRoute = "dashboard";

async function navigate(routeName) {
  const route = routes[routeName] || routes.dashboard;
  currentRoute = routes[routeName] ? routeName : "dashboard";
  pageTitle.textContent = route.title;

  document.querySelectorAll(".nav-item[data-route]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.route === currentRoute);
  });

  await route.render(view);
  window.scrollTo({ top: 0, behavior: "instant" });
}

function showQuickAdd() {
  openModal(`
    <div class="modal-head">
      <div>
        <p class="eyebrow">AJOUT RAPIDE</p>
        <h2>Ajouter</h2>
      </div>
      <button class="icon-btn" id="quick-add-close">×</button>
    </div>

    <div class="list">
      <button class="list-item" id="quick-add-task" style="width:100%;text-align:left;cursor:pointer">
        <div style="font-size:24px">✓</div>
        <div class="task-main">
          <div class="task-title">Nouvelle tâche</div>
          <div class="task-desc">Ajouter une tâche, une échéance ou un rappel.</div>
        </div>
      </button>

      <button class="list-item" id="quick-add-stock" style="width:100%;text-align:left;cursor:pointer">
        <div style="font-size:24px">📦</div>
        <div class="task-main">
          <div class="task-title">Nouveau produit</div>
          <div class="task-desc">Ajouter un bien dans Stock & Marge.</div>
        </div>
      </button>

      <button class="list-item" id="quick-add-tracker" style="width:100%;text-align:left;cursor:pointer">
        <div style="font-size:24px">✅</div>
        <div class="task-main">
          <div class="task-title">Nouvelle ligne Tracker</div>
          <div class="task-desc">Ajouter une habitude ou une valeur au Tracker.</div>
        </div>
      </button>

      <button class="list-item" id="quick-add-sport" style="width:100%;text-align:left;cursor:pointer">
        <div style="font-size:24px">🏅</div>
        <div class="task-main">
          <div class="task-title">Activité sportive</div>
          <div class="task-desc">Ajouter rapidement du foot, une course, du tennis ou autre.</div>
        </div>
      </button>

      <button class="list-item" id="quick-add-objective" style="width:100%;text-align:left;cursor:pointer">
        <div style="font-size:24px">🎯</div>
        <div class="task-main">
          <div class="task-title">Nouvel objectif</div>
          <div class="task-desc">Créer un objectif, une échéance et des jalons.</div>
        </div>
      </button>

      <button class="list-item" id="quick-add-planning" style="width:100%;text-align:left;cursor:pointer">
        <div style="font-size:24px">📅</div>
        <div class="task-main">
          <div class="task-title">Nouvel événement</div>
          <div class="task-desc">Ajouter un rendez-vous ou un événement personnel au Planning.</div>
        </div>
      </button>

      <button class="list-item" id="quick-add-maintenance" style="width:100%;text-align:left;cursor:pointer">
        <div style="font-size:24px">🔧</div>
        <div class="task-main">
          <div class="task-title">Nouveau bien à entretenir</div>
          <div class="task-desc">Ajouter une voiture, un vélo, un équipement ou du matériel.</div>
        </div>
      </button>


      <button class="list-item" id="quick-add-living" style="width:100%;text-align:left;cursor:pointer">
        <div style="font-size:24px">🌿</div>
        <div class="task-main">
          <div class="task-title">Aquarium ou plante</div>
          <div class="task-desc">Ajouter un bac, une plante ou un suivi du vivant.</div>
        </div>
      </button>

      <button class="list-item" id="quick-add-document" style="width:100%;text-align:left;cursor:pointer">
        <div style="font-size:24px">📂</div>
        <div class="task-main"><div class="task-title">Nouveau document</div><div class="task-desc">Ajouter un document important ou une échéance.</div></div>
      </button>

      <button class="list-item" id="quick-add-budget" style="width:100%;text-align:left;cursor:pointer">
        <div style="font-size:24px">💰</div>
        <div class="task-main"><div class="task-title">Nouveau mouvement</div><div class="task-desc">Ajouter un revenu, une dépense ou de l'épargne.</div></div>
      </button>

      <button class="list-item" id="quick-add-project" style="width:100%;text-align:left;cursor:pointer">
        <div style="font-size:24px">🏠</div>
        <div class="task-main"><div class="task-title">Nouveau projet</div><div class="task-desc">Regrouper tâches, budget, documents et objectifs.</div></div>
      </button>

      <button class="list-item" id="quick-add-learning" style="width:100%;text-align:left;cursor:pointer">
        <div style="font-size:24px">🧠</div>
        <div class="task-main"><div class="task-title">Nouvel apprentissage</div><div class="task-desc">Suivre une compétence, une formation ou une langue.</div></div>
      </button>

      <button class="list-item" id="quick-add-idea" style="width:100%;text-align:left;cursor:pointer">
        <div style="font-size:24px">💡</div>
        <div class="task-main"><div class="task-title">Capturer une idée</div><div class="task-desc">Ajouter une idée à l'Inbox pour la traiter plus tard.</div></div>
      </button>


      <button class="list-item" id="quick-add-meal" style="width:100%;text-align:left;cursor:pointer">
        <div style="font-size:24px">🍽️</div>
        <div class="task-main"><div class="task-title">Nouveau repas</div><div class="task-desc">Ajouter un plat à la bibliothèque Repas.</div></div>
      </button>

      <button class="list-item" id="quick-add-shopping" style="width:100%;text-align:left;cursor:pointer">
        <div style="font-size:24px">🛒</div>
        <div class="task-main"><div class="task-title">Article de courses</div><div class="task-desc">Ajouter rapidement quelque chose à acheter.</div></div>
      </button>

      <button class="list-item" id="quick-add-person" style="width:100%;text-align:left;cursor:pointer">
        <div style="font-size:24px">👥</div>
        <div class="task-main"><div class="task-title">Nouvelle personne</div><div class="task-desc">Ajouter quelqu'un, ses groupes, son anniversaire et tes notes.</div></div>
      </button>
    </div>
  `);

  document.getElementById("quick-add-close").addEventListener("click", closeModal);
  document.getElementById("quick-add-task").addEventListener("click", () => {
    closeModal();
    showAddTaskModal();
  });
  document.getElementById("quick-add-stock").addEventListener("click", () => {
    closeModal();
    requestNewProduct();
  });
  document.getElementById("quick-add-tracker").addEventListener("click", () => {
    closeModal();
    requestNewTrackerItem();
  });
  document.getElementById("quick-add-sport").addEventListener("click", () => {
    closeModal();
    requestNewSportActivity();
  });
  document.getElementById("quick-add-objective").addEventListener("click", () => {
    closeModal();
    requestNewObjective();
  });
  document.getElementById("quick-add-planning").addEventListener("click", () => {
    closeModal();
    requestNewPlanningEvent();
  });
  document.getElementById("quick-add-maintenance").addEventListener("click", () => {
    closeModal();
    requestNewMaintenanceAsset();
  });
  document.getElementById("quick-add-living").addEventListener("click", () => {
    closeModal();
    requestNewLivingItem();
  });
  document.getElementById("quick-add-document").addEventListener("click", () => { closeModal(); requestNewDocument(); });
  document.getElementById("quick-add-budget").addEventListener("click", () => { closeModal(); requestNewBudgetEntry(); });
  document.getElementById("quick-add-project").addEventListener("click", () => { closeModal(); requestNewProject(); });
  document.getElementById("quick-add-learning").addEventListener("click", () => { closeModal(); requestNewLearningTopic(); });
  document.getElementById("quick-add-idea").addEventListener("click", () => { closeModal(); requestNewIdea(); });
  document.getElementById("quick-add-person").addEventListener("click", () => { closeModal(); requestNewPerson(); });
  document.getElementById("quick-add-meal").addEventListener("click", () => { closeModal(); requestNewMeal(); });
  document.getElementById("quick-add-shopping").addEventListener("click", () => { closeModal(); requestNewShoppingItem(); });
}

document.querySelectorAll("[data-route]").forEach(btn => {
  btn.addEventListener("click", () => navigate(btn.dataset.route));
});

document.getElementById("settings-btn").addEventListener("click", () => navigate("settings"));
document.getElementById("search-btn").addEventListener("click", () => navigate("search"));
document.getElementById("quick-add").addEventListener("click", showQuickAdd);

window.addEventListener("myhub:navigate", event => navigate(event.detail));

window.addEventListener("myhub:data-changed", async () => {
  try {
    await syncTrackerForToday();
    await syncLivingCareTasks();
    await syncPeopleReminderTasks();
    await ensureMealsSeeded();
  } catch (error) {
    console.error("Synchronisation Tracker :", error);
  }

  if (currentRoute === "dashboard") {
    navigate("dashboard");
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(console.error);
  });
}

(async () => {
  try {
    await syncRecurringObjectiveTasks(30);
    await syncMaintenanceTasks();
    await syncDocumentTasks();
    await syncLearningObjective();
    await syncSportPlanTasks();
    await syncTrackerForToday();
    await syncLivingCareTasks();
    await syncPeopleReminderTasks();
    await ensureMealsSeeded();
  } catch (error) {
    console.error("Synchronisation MyHub :", error);
  }

  await navigate("dashboard");
})();
