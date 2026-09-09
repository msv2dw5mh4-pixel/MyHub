import { getAll, getOne, putOne, deleteOne } from "./db.js";
import { uid, todayISO } from "./ui.js";

function localDate(dateString) {
  return new Date(`${dateString}T12:00:00`);
}

function diffDays(fromDate, toDate) {
  return Math.ceil((localDate(toDate) - localDate(fromDate)) / 86400000);
}

export function documentDueKey(doc) {
  return `${doc.expiryDate || ""}`;
}

export function documentStatus(doc, referenceDate = todayISO()) {
  if (!doc?.expiryDate) {
    return {
      state: "none",
      remainingDays: null,
      dueDate: ""
    };
  }

  const remainingDays = diffDays(referenceDate, doc.expiryDate);
  const warn = Math.max(0, Number(doc.remindDays ?? 30));

  return {
    state: remainingDays < 0 ? "due" : remainingDays <= warn ? "soon" : "ok",
    remainingDays,
    dueDate: doc.expiryDate
  };
}

function taskDescription(doc, status) {
  const parts = [];
  if (doc.reference) parts.push(`Référence : ${doc.reference}`);
  if (doc.expiryDate) parts.push(`Échéance : ${doc.expiryDate}`);
  if (status.remainingDays !== null) {
    parts.push(
      status.remainingDays < 0
        ? `Dépassé de ${Math.abs(status.remainingDays)} jour(s)`
        : `Dans ${status.remainingDays} jour(s)`
    );
  }
  if (doc.category) parts.push(`Catégorie : ${doc.category}`);
  return parts.join(" · ");
}

export async function syncDocumentTasks() {
  const [documents, tasks] = await Promise.all([
    getAll("documents"),
    getAll("tasks")
  ]);

  for (const doc of documents.filter(doc => doc.active !== false)) {
    const status = documentStatus(doc);
    const dueKey = documentDueKey(doc);
    const linkedOpen = tasks.filter(task =>
      task.source === "document" &&
      task.documentId === doc.id &&
      !task.done
    );

    const shouldHaveTask = status.state === "due" || status.state === "soon";

    if (!shouldHaveTask) {
      for (const task of linkedOpen) {
        await deleteOne("tasks", task.id);
      }
      continue;
    }

    if (doc.taskDismissedKey === dueKey) continue;

    const title = `${status.state === "due" ? "📂 Document à renouveler" : "📂 Document bientôt à renouveler"} — ${doc.title}`;

    if (linkedOpen.length) {
      const keep = linkedOpen[0];
      await putOne("tasks", {
        ...keep,
        title,
        description: taskDescription(doc, status),
        folder: "Documents",
        dueDate: doc.expiryDate || todayISO(),
        projectId: doc.projectId || null,
        updatedAt: new Date().toISOString(),
        documentDueKey: dueKey
      });
      for (const duplicate of linkedOpen.slice(1)) {
        await deleteOne("tasks", duplicate.id);
      }
    } else {
      await putOne("tasks", {
        id: uid("task"),
        title,
        description: taskDescription(doc, status),
        folder: "Documents",
        dueDate: doc.expiryDate || todayISO(),
        reminderAt: "",
        objectiveId: null,
        projectId: doc.projectId || null,
        source: "document",
        documentId: doc.id,
        documentDueKey: dueKey,
        done: false,
        createdAt: new Date().toISOString(),
        completedAt: null
      });
    }
  }
}

export async function dismissDocumentTask(task) {
  if (task?.source !== "document" || !task.documentId) return;

  const doc = await getOne("documents", task.documentId);
  if (!doc) return;

  await putOne("documents", {
    ...doc,
    taskDismissedKey: documentDueKey(doc),
    updatedAt: new Date().toISOString()
  });
}
