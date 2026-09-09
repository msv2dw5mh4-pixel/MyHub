import { exportDatabase, validateBackup, importDatabase, getOne, putOne } from "./db.js";

function bytesToSize(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

function timestampName(date = new Date()) {
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function backupFilename(prefix = "MyHub_Backup") {
  return `${prefix}_${timestampName()}.json`;
}

export function serializeBackup(payload) {
  return JSON.stringify(payload);
}

export async function sha256(text) {
  if (!globalThis.crypto?.subtle) return "";
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function prepareBackup() {
  const payload = await exportDatabase();
  const validation = validateBackup(payload);

  if (!validation.valid) {
    throw new Error(validation.errors.join(" ") || "La sauvegarde générée n'est pas valide.");
  }

  const contentRaw = serializeBackup(payload);
  const checksum = await sha256(contentRaw);

  if (checksum) {
    payload.integrity = {
      algorithm: "SHA-256",
      checksum
    };
  }

  const raw = serializeBackup(payload);
  const bytes = new TextEncoder().encode(raw).length;

  return {
    payload,
    raw,
    checksum,
    bytes,
    sizeLabel: bytesToSize(bytes),
    validation
  };
}

export function downloadBackupRaw(raw, filename) {
  const blob = new Blob([raw], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function recordBackupSuccess(prepared, type = "manual") {
  const current = await getOne("settings", "backup.history");
  const history = Array.isArray(current?.value) ? current.value : [];
  const entry = {
    date: new Date().toISOString(),
    type,
    totalItems: prepared.validation.stats.totalItems,
    sizeBytes: prepared.bytes,
    checksum: prepared.checksum || "",
    appVersion: prepared.payload.appVersion || "",
    dbVersion: prepared.payload.dbVersion ?? null
  };

  await putOne("settings", {
    key: "backup.history",
    value: [entry, ...history].slice(0, 20)
  });

  await putOne("settings", {
    key: "backup.lastSuccess",
    value: entry
  });

  return entry;
}

export async function getBackupStatus() {
  const [last, history, reminderDays] = await Promise.all([
    getOne("settings", "backup.lastSuccess"),
    getOne("settings", "backup.history"),
    getOne("settings", "backup.reminderDays")
  ]);

  const days = Math.max(1, Number(reminderDays?.value || 14));
  const entry = last?.value || null;

  let ageDays = null;
  if (entry?.date) {
    ageDays = Math.floor((Date.now() - new Date(entry.date).getTime()) / 86400000);
  }

  return {
    last: entry,
    history: Array.isArray(history?.value) ? history.value : [],
    reminderDays: days,
    ageDays,
    due: !entry || ageDays >= days
  };
}

export async function setBackupReminderDays(days) {
  const value = Math.max(1, Math.min(365, Number(days || 14)));
  await putOne("settings", { key: "backup.reminderDays", value });
  return value;
}

export async function readBackupFile(file) {
  if (!file) throw new Error("Aucun fichier sélectionné.");
  const raw = await file.text();

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("Le fichier n'est pas un JSON valide.");
  }

  const validation = validateBackup(payload);
  const expectedChecksum = payload?.integrity?.checksum || "";
  let checksum = "";

  if (expectedChecksum) {
    const content = { ...payload };
    delete content.integrity;
    checksum = await sha256(serializeBackup(content));

    if (checksum && checksum !== expectedChecksum) {
      validation.valid = false;
      validation.errors.push("L'empreinte de la sauvegarde ne correspond pas au contenu. Le fichier semble avoir été modifié ou endommagé.");
    }
  } else {
    checksum = await sha256(raw);
    validation.warnings.push("Ancienne sauvegarde sans empreinte intégrée : structure vérifiée, mais contrôle SHA-256 interne indisponible.");
  }

  const bytes = new TextEncoder().encode(raw).length;

  return {
    file,
    raw,
    payload,
    validation,
    checksum: expectedChecksum || checksum,
    integrityValid: expectedChecksum ? checksum === expectedChecksum : null,
    bytes,
    sizeLabel: bytesToSize(bytes)
  };
}

export async function createSafetyBackupDownload() {
  const prepared = await prepareBackup();
  downloadBackupRaw(prepared.raw, backupFilename("MyHub_Safety_Before_Restore"));
  await recordBackupSuccess(prepared, "safety-before-restore");
  return prepared;
}

export async function restoreBackup(payload, mode = "replace") {
  return importDatabase(payload, { mode });
}

export function formatBackupDate(value) {
  if (!value) return "Jamais";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

export function formatBackupSize(bytes) {
  return bytesToSize(bytes);
}
