import { getAll, getOne, putOne } from "./db.js";

const SETTINGS_KEY = "tasks.folders.v1";
const DEFAULT_FOLDER = "Général";

const SYSTEM_SOURCES = new Set([
  "maintenance",
  "document",
  "sport-plan",
  "living-care",
  "objective-recurring",
  "objective-milestone",
  "people-reminder"
]);

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 60);
}

function keyFor(value) {
  return cleanName(value).toLocaleLowerCase("fr-FR");
}

function isUserTask(task) {
  if (!task) return false;
  if (task.generated === true) return false;
  return !SYSTEM_SOURCES.has(task.source);
}

function dedupe(names) {
  const seen = new Set();
  const result = [];

  for (const raw of names) {
    const name = cleanName(raw);
    if (!name) continue;
    const key = keyFor(name);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }

  return result;
}

export async function getTaskFolders() {
  const [setting, tasks] = await Promise.all([
    getOne("settings", SETTINGS_KEY).catch(() => null),
    getAll("tasks").catch(() => [])
  ]);

  const saved = Array.isArray(setting?.value) ? setting.value : [];
  const discovered = tasks
    .filter(isUserTask)
    .map(task => task.folder || DEFAULT_FOLDER);

  const folders = dedupe([DEFAULT_FOLDER, ...saved, ...discovered]);

  // Général reste toujours en tête. Les dossiers créés conservent leur ordre.
  return [
    DEFAULT_FOLDER,
    ...folders.filter(name => keyFor(name) !== keyFor(DEFAULT_FOLDER))
  ];
}

async function persistFolders(names) {
  const folders = dedupe([DEFAULT_FOLDER, ...names]);
  await putOne("settings", {
    key: SETTINGS_KEY,
    value: folders,
    updatedAt: new Date().toISOString()
  });
  return folders;
}

export async function ensureTaskFolder(name) {
  const cleaned = cleanName(name) || DEFAULT_FOLDER;
  const folders = await getTaskFolders();

  if (!folders.some(folder => keyFor(folder) === keyFor(cleaned))) {
    await persistFolders([...folders, cleaned]);
  }

  return cleaned;
}

export async function createTaskFolder(name) {
  const cleaned = cleanName(name);
  if (!cleaned) throw new Error("Le nom du dossier est obligatoire.");

  const folders = await getTaskFolders();
  if (folders.some(folder => keyFor(folder) === keyFor(cleaned))) {
    throw new Error("Ce dossier existe déjà.");
  }

  await persistFolders([...folders, cleaned]);
  return cleaned;
}

export async function renameTaskFolder(oldName, newName) {
  const oldClean = cleanName(oldName);
  const next = cleanName(newName);

  if (!oldClean || !next) throw new Error("Le nom du dossier est obligatoire.");
  if (keyFor(oldClean) === keyFor(DEFAULT_FOLDER)) {
    throw new Error("Le dossier Général ne peut pas être renommé.");
  }

  const folders = await getTaskFolders();
  if (folders.some(folder =>
    keyFor(folder) === keyFor(next) &&
    keyFor(folder) !== keyFor(oldClean)
  )) {
    throw new Error("Un dossier porte déjà ce nom.");
  }

  const tasks = await getAll("tasks");
  for (const task of tasks) {
    if (keyFor(task.folder || DEFAULT_FOLDER) !== keyFor(oldClean)) continue;
    await putOne("tasks", {
      ...task,
      folder: next,
      updatedAt: new Date().toISOString()
    });
  }

  await persistFolders(
    folders.map(folder => keyFor(folder) === keyFor(oldClean) ? next : folder)
  );

  return next;
}

export async function deleteTaskFolder(name) {
  const cleaned = cleanName(name);

  if (!cleaned || keyFor(cleaned) === keyFor(DEFAULT_FOLDER)) {
    throw new Error("Le dossier Général ne peut pas être supprimé.");
  }

  const tasks = await getAll("tasks");
  for (const task of tasks) {
    if (keyFor(task.folder || DEFAULT_FOLDER) !== keyFor(cleaned)) continue;
    await putOne("tasks", {
      ...task,
      folder: DEFAULT_FOLDER,
      updatedAt: new Date().toISOString()
    });
  }

  const folders = await getTaskFolders();
  await persistFolders(
    folders.filter(folder => keyFor(folder) !== keyFor(cleaned))
  );

  return DEFAULT_FOLDER;
}

export function sameTaskFolder(a, b) {
  return keyFor(a || DEFAULT_FOLDER) === keyFor(b || DEFAULT_FOLDER);
}

export const DEFAULT_TASK_FOLDER = DEFAULT_FOLDER;
