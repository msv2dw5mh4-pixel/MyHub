const CACHE = "myhub-v30-2-repas-search-fix";

const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./css/dashboard.css",
  "./css/stats.css",
  "./css/stock.css",
  "./css/tracker.css",
  "./css/sport.css",
  "./css/objectives.css",
  "./css/planning.css",
  "./css/maintenance.css",
  "./css/living.css",
  "./css/documents.css",
  "./css/budget.css",
  "./css/projects.css",
  "./css/learning.css",
  "./css/ideas.css",
  "./css/search.css",
  "./css/people.css",
  "./css/meals.css",
  "./js/app.js",
  "./js/core/db.js",
  "./js/core/modules.js",
  "./js/core/ui.js",
  "./js/core/task_modal_guard.js",
  "./js/core/objective_tasks.js",
  "./js/core/maintenance_tasks.js",
  "./js/core/document_tasks.js",
  "./js/core/learning_sync.js",
  "./js/core/sport_planner.js",
  "./js/core/sport_insights.js",
  "./js/core/sport_catalog.js",
  "./js/core/tracker_automation.js",
  "./js/core/living_tasks.js",
  "./js/core/backup.js",
  "./js/core/people_tasks.js",
  "./js/core/meal_seed.js",
  "./js/modules/dashboard.js",
  "./js/modules/stats.js",
  "./js/modules/tasks.js",
  "./js/modules/stock.js",
  "./js/modules/tracker.js",
  "./js/modules/sport.js",
  "./js/modules/objectives.js",
  "./js/modules/planning.js",
  "./js/modules/maintenance.js",
  "./js/modules/living.js",
  "./js/modules/documents.js",
  "./js/modules/budget.js",
  "./js/modules/projects.js",
  "./js/modules/learning.js",
  "./js/modules/ideas.js",
  "./js/modules/modules.js",
  "./js/modules/settings.js",
  "./js/modules/search.js",
  "./js/modules/people.js",
  "./js/modules/meals.js",
  "./js/modules/shopping.js",
  "./manifest.webmanifest",
  "./assets/icons/icon-192.svg",
  "./assets/icons/icon-512.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(cached =>
          cached || caches.match("./index.html")
        )
      )
  );
});
