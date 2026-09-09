const DB_NAME = "myhub";
const DB_VERSION = 20;

const STORES = {
  settings: { keyPath: "key" },
  tasks: { keyPath: "id" },
  products: { keyPath: "id" },
  trackerCategories: { keyPath: "id" },
  trackerItems: { keyPath: "id" },
  trackerEntries: { keyPath: "id" },
  sportPrograms: { keyPath: "id" },
  sportExercises: { keyPath: "id" },
  sportSessions: { keyPath: "id" },
  sportSets: { keyPath: "id" },
  sportGoals: { keyPath: "id" },
  sportTrainingPlans: { keyPath: "id" },
  sportPlanSessions: { keyPath: "id" },
  sportStrengthGoalExercises: { keyPath: "id" },
  objectives: { keyPath: "id" },
  objectiveMilestones: { keyPath: "id" },
  objectiveActions: { keyPath: "id" },
  calendarEvents: { keyPath: "id" },
  maintenanceAssets: { keyPath: "id" },
  maintenancePlans: { keyPath: "id" },
  maintenanceRecords: { keyPath: "id" },
  documents: { keyPath: "id" },
  budgetTransactions: { keyPath: "id" },
  projects: { keyPath: "id" },
  learningTopics: { keyPath: "id" },
  learningSessions: { keyPath: "id" },
  ideas: { keyPath: "id" },
  livingAquariums: { keyPath: "id" },
  livingPlants: { keyPath: "id" },
  livingSpecies: { keyPath: "id" },
  livingEvents: { keyPath: "id" },
  livingCarePlans: { keyPath: "id" },
  livingCareRecords: { keyPath: "id" },
  people: { keyPath: "id" },
  peopleGroups: { keyPath: "id" },
  peopleRelations: { keyPath: "id" },
  peopleEvents: { keyPath: "id" },
  meals: { keyPath: "id" },
  mealPlans: { keyPath: "id" },
  shoppingItems: { keyPath: "id" },
  moduleData: { keyPath: "id" }
};

let dbPromise;

export function getDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        Object.entries(STORES).forEach(([name, options]) => {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, options);
          }
        });
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

export async function getAll(storeName) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getOne(storeName, key) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putOne(storeName, value) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).put(value);
    req.onsuccess = () => resolve(value);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteOne(storeName, key) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearStore(storeName) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function replaceStore(storeName, values = []) {
  await clearStore(storeName);
  for (const value of values) await putOne(storeName, value);
}

export function getStoreNames() {
  return Object.keys(STORES);
}

export async function exportDatabase() {
  const stores = {};
  const counts = {};
  let totalItems = 0;

  for (const storeName of Object.keys(STORES)) {
    const rows = await getAll(storeName);
    stores[storeName] = rows;
    counts[storeName] = rows.length;
    totalItems += rows.length;
  }

  return {
    app: "MyHub",
    backupFormat: 2,
    appVersion: "V28",
    dbVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    totalItems,
    counts,
    stores
  };
}

export function validateBackup(payload) {
  const errors = [];
  const warnings = [];

  if (!payload || typeof payload !== "object") {
    errors.push("Le fichier ne contient pas un objet de sauvegarde.");
    return { valid: false, errors, warnings, stats: null };
  }

  if (payload.app !== "MyHub") errors.push("Cette sauvegarde n'appartient pas à MyHub.");
  if (!payload.stores || typeof payload.stores !== "object") errors.push("Les données IndexedDB sont absentes.");

  const knownStores = Object.keys(STORES);
  const sourceStores = payload.stores && typeof payload.stores === "object"
    ? Object.keys(payload.stores)
    : [];

  if (!errors.length) {
    for (const name of sourceStores) {
      if (!Array.isArray(payload.stores[name])) {
        errors.push(`Le store "${name}" n'est pas valide.`);
      }
    }

    const missing = knownStores.filter(name => !sourceStores.includes(name));
    if (missing.length) {
      warnings.push(`${missing.length} zone${missing.length > 1 ? "s" : ""} absente${missing.length > 1 ? "s" : ""} de cette sauvegarde. Elles seront vides en restauration complète.`);
    }

    const unknown = sourceStores.filter(name => !knownStores.includes(name));
    if (unknown.length) {
      warnings.push(`${unknown.length} zone${unknown.length > 1 ? "s" : ""} inconnue${unknown.length > 1 ? "s" : ""} sera${unknown.length > 1 ? "ont" : ""} ignorée${unknown.length > 1 ? "s" : ""}.`);
    }
  }

  const counts = {};
  let totalItems = 0;
  let embeddedFiles = 0;

  if (payload.stores && typeof payload.stores === "object") {
    for (const [name, rows] of Object.entries(payload.stores)) {
      if (!Array.isArray(rows)) continue;
      counts[name] = rows.length;
      totalItems += rows.length;

      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        for (const value of Object.values(row)) {
          if (typeof value === "string" && value.startsWith("data:")) embeddedFiles++;
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      totalItems,
      storeCount: Object.keys(counts).length,
      counts,
      embeddedFiles,
      exportedAt: payload.exportedAt || null,
      appVersion: payload.appVersion || `ancienne sauvegarde`,
      dbVersion: payload.dbVersion ?? payload.version ?? null,
      backupFormat: payload.backupFormat || 1
    }
  };
}

export async function importDatabase(payload, options = {}) {
  const mode = options.mode === "merge" ? "merge" : "replace";
  const validation = validateBackup(payload);

  if (!validation.valid) {
    throw new Error(validation.errors.join(" ") || "Sauvegarde MyHub invalide.");
  }

  const db = await getDb();
  const storeNames = Object.keys(STORES);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, "readwrite");
    let written = 0;

    tx.oncomplete = () => resolve({ mode, written });
    tx.onerror = () => reject(tx.error || new Error("La restauration IndexedDB a échoué."));
    tx.onabort = () => reject(tx.error || new Error("La restauration a été annulée."));

    for (const storeName of storeNames) {
      const store = tx.objectStore(storeName);
      const rows = Array.isArray(payload.stores?.[storeName]) ? payload.stores[storeName] : [];

      if (mode === "replace") store.clear();

      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        store.put(row);
        written++;
      }
    }
  });
}

