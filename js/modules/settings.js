import { escapeHtml, openModal, closeModal } from "../core/ui.js";
import {
  prepareBackup,
  downloadBackupRaw,
  backupFilename,
  recordBackupSuccess,
  getBackupStatus,
  setBackupReminderDays,
  readBackupFile,
  createSafetyBackupDownload,
  restoreBackup,
  formatBackupDate,
  formatBackupSize
} from "../core/backup.js";

function checksumLabel(value) {
  if (!value) return "Non disponible";
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

function historyLabel(type) {
  if (type === "safety-before-restore") return "Sauvegarde sécurité";
  if (type === "manual") return "Export manuel";
  return "Sauvegarde";
}

async function showImportPreview(parsed, input) {
  const { validation } = parsed;

  if (!validation.valid) {
    openModal(`
      <div class="modal-head">
        <div><p class="eyebrow">RESTAURATION</p><h2>Sauvegarde invalide</h2></div>
        <button class="icon-btn" id="backup-preview-close">×</button>
      </div>
      <div class="backup-validation danger">
        ${validation.errors.map(error => `<p>✕ ${escapeHtml(error)}</p>`).join("")}
      </div>
      <div class="actions"><button class="primary-btn" id="backup-invalid-ok">Fermer</button></div>
    `);
    document.querySelector("#backup-preview-close").addEventListener("click", closeModal);
    document.querySelector("#backup-invalid-ok").addEventListener("click", closeModal);
    return;
  }

  const stats = validation.stats;
  const warningHtml = validation.warnings.length
    ? `<div class="backup-validation warning">${validation.warnings.map(w => `<p>⚠ ${escapeHtml(w)}</p>`).join("")}</div>`
    : `<div class="backup-validation success"><p>✓ Structure de sauvegarde vérifiée.</p></div>`;

  openModal(`
    <div class="modal-head">
      <div><p class="eyebrow">RESTAURATION</p><h2>Vérifier la sauvegarde</h2></div>
      <button class="icon-btn" id="backup-preview-close">×</button>
    </div>

    <div class="backup-preview-grid">
      <article><span>Créée</span><strong>${escapeHtml(formatBackupDate(stats.exportedAt))}</strong></article>
      <article><span>Version</span><strong>${escapeHtml(stats.appVersion || "Ancienne")}</strong></article>
      <article><span>Éléments</span><strong>${stats.totalItems.toLocaleString("fr-FR")}</strong></article>
      <article><span>Taille</span><strong>${escapeHtml(parsed.sizeLabel)}</strong></article>
      <article><span>Zones</span><strong>${stats.storeCount}</strong></article>
      <article><span>Fichiers intégrés</span><strong>${stats.embeddedFiles}</strong></article>
    </div>

    ${warningHtml}

    <div class="backup-checksum">
      <span>Empreinte SHA-256</span>
      <code>${escapeHtml(checksumLabel(parsed.checksum))}</code>
    </div>

    <div class="backup-restore-choice">
      <button class="backup-choice-card" id="backup-restore-replace">
        <strong>Restaurer complètement</strong>
        <small>Remplace les données locales actuelles par cette sauvegarde.</small>
      </button>
      <button class="backup-choice-card" id="backup-restore-merge">
        <strong>Fusionner</strong>
        <small>Conserve les données actuelles et ajoute/met à jour les éléments portant le même identifiant.</small>
      </button>
    </div>

    <div class="backup-safety-note">
      <strong>Protection automatique</strong>
      <p>Avant la restauration, MyHub téléchargera une sauvegarde de sécurité de l'état actuel.</p>
    </div>

    <div class="actions"><button class="ghost-btn" id="backup-preview-cancel">Annuler</button></div>
  `);

  const cleanup = () => {
    closeModal();
    input.value = "";
  };

  document.querySelector("#backup-preview-close").addEventListener("click", cleanup);
  document.querySelector("#backup-preview-cancel").addEventListener("click", cleanup);

  async function execute(mode) {
    const label = mode === "replace" ? "restauration complète" : "fusion";
    const ok = confirm(`Confirmer la ${label} ? Une sauvegarde de sécurité sera téléchargée avant toute modification.`);
    if (!ok) return;

    const replaceBtn = document.querySelector("#backup-restore-replace");
    const mergeBtn = document.querySelector("#backup-restore-merge");
    replaceBtn.disabled = true;
    mergeBtn.disabled = true;
    replaceBtn.textContent = "Sauvegarde de sécurité…";

    try {
      await createSafetyBackupDownload();
      replaceBtn.textContent = "Restauration…";
      await restoreBackup(parsed.payload, mode);

      closeModal();
      input.value = "";

      alert(
        mode === "replace"
          ? "Sauvegarde restaurée avec succès. MyHub va recharger les données."
          : "Sauvegarde fusionnée avec succès. MyHub va recharger les données."
      );

      window.dispatchEvent(new CustomEvent("myhub:data-changed"));
      window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "dashboard" }));
    } catch (error) {
      console.error(error);
      alert(error?.message || "La restauration a échoué. Les modifications IndexedDB ont été annulées.");
      replaceBtn.disabled = false;
      mergeBtn.disabled = false;
      replaceBtn.textContent = "Restaurer complètement";
    }
  }

  document.querySelector("#backup-restore-replace").addEventListener("click", () => execute("replace"));
  document.querySelector("#backup-restore-merge").addEventListener("click", () => execute("merge"));
}

export async function renderSettings(container) {
  const status = await getBackupStatus();

  const lastText = status.last
    ? formatBackupDate(status.last.date)
    : "Aucune sauvegarde enregistrée";

  const backupState = status.due
    ? `<span class="backup-status danger">⚠ Sauvegarde recommandée</span>`
    : `<span class="backup-status success">✓ Sauvegarde récente</span>`;

  container.innerHTML = `
    <section>
      <div class="section-head">
        <div>
          <h2>Réglages</h2>
          <p class="muted" style="margin:4px 0 0">Tes données restent sur cet appareil.</p>
        </div>
      </div>

      <div class="settings-list">
        <article class="setting-card backup-main-card">
          <div class="backup-card-head">
            <div>
              <strong>Sauvegarde complète MyHub</strong>
              <p class="muted">Toutes les données IndexedDB, y compris les photos et fichiers intégrés aux fiches.</p>
            </div>
            ${backupState}
          </div>

          <div class="backup-last">
            <span>Dernière sauvegarde réussie</span>
            <strong>${escapeHtml(lastText)}</strong>
            ${status.last ? `<small>${status.last.totalItems?.toLocaleString("fr-FR") || 0} éléments · ${formatBackupSize(status.last.sizeBytes || 0)}</small>` : ""}
          </div>

          <button class="primary-btn" id="export-btn">Créer une sauvegarde</button>
          <div id="backup-export-result"></div>
        </article>

        <article class="setting-card">
          <strong>Restaurer / fusionner</strong>
          <p class="muted">MyHub vérifie le fichier avant toute modification et crée automatiquement une sauvegarde de sécurité.</p>
          <input type="file" id="import-file" accept="application/json,.json" hidden>
          <button class="ghost-btn" id="import-btn">Choisir une sauvegarde</button>
        </article>

        <article class="setting-card">
          <strong>Rappel de sauvegarde</strong>
          <p class="muted">Le Dashboard te prévient quand ta dernière sauvegarde devient trop ancienne.</p>
          <div class="backup-reminder-row">
            <label for="backup-reminder-days">Me rappeler après</label>
            <select id="backup-reminder-days">
              ${[7,14,21,30,60,90].map(days => `<option value="${days}" ${status.reminderDays===days?"selected":""}>${days} jours</option>`).join("")}
            </select>
          </div>
        </article>

        <article class="setting-card">
          <strong>Historique des sauvegardes</strong>
          <div class="backup-history">
            ${status.history.length
              ? status.history.slice(0,8).map(entry => `
                <div class="backup-history-row">
                  <div>
                    <strong>${historyLabel(entry.type)}</strong>
                    <small>${formatBackupDate(entry.date)}</small>
                  </div>
                  <span>${formatBackupSize(entry.sizeBytes || 0)}</span>
                </div>`).join("")
              : `<p class="muted">Aucun export enregistré pour le moment.</p>`}
          </div>
        </article>

        <article class="setting-card">
          <strong>Confidentialité</strong>
          <p class="muted">Aucune sauvegarde n'est envoyée automatiquement sur GitHub ou dans le cloud. Le fichier exporté doit être conservé par toi dans Fichiers, iCloud Drive, ton Mac ou un autre emplacement de confiance.</p>
        </article>
      </div>
    </section>
  `;

  container.querySelector("#export-btn").addEventListener("click", async () => {
    const button = container.querySelector("#export-btn");
    const result = container.querySelector("#backup-export-result");
    button.disabled = true;
    button.textContent = "Vérification…";
    result.innerHTML = "";

    try {
      const prepared = await prepareBackup();
      button.textContent = "Téléchargement…";

      downloadBackupRaw(prepared.raw, backupFilename());
      await recordBackupSuccess(prepared, "manual");

      result.innerHTML = `
        <div class="backup-export-success">
          <strong>✓ Sauvegarde vérifiée et créée</strong>
          <span>${prepared.validation.stats.totalItems.toLocaleString("fr-FR")} éléments · ${prepared.validation.stats.storeCount} zones · ${prepared.validation.stats.embeddedFiles} fichiers intégrés · ${escapeHtml(prepared.sizeLabel)}</span>
          ${prepared.checksum ? `<small>SHA-256 : ${escapeHtml(checksumLabel(prepared.checksum))}</small>` : ""}
        </div>`;

      setTimeout(() => renderSettings(container), 1200);
    } catch (error) {
      console.error(error);
      result.innerHTML = `<div class="backup-export-error">✕ ${escapeHtml(error?.message || "Impossible de créer la sauvegarde.")}</div>`;
    } finally {
      button.disabled = false;
      button.textContent = "Créer une sauvegarde";
    }
  });

  const input = container.querySelector("#import-file");
  container.querySelector("#import-btn").addEventListener("click", () => input.click());

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const parsed = await readBackupFile(file);
      await showImportPreview(parsed, input);
    } catch (error) {
      console.error(error);
      alert(error?.message || "Impossible de lire cette sauvegarde.");
      input.value = "";
    }
  });

  container.querySelector("#backup-reminder-days").addEventListener("change", async event => {
    await setBackupReminderDays(Number(event.target.value));
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
  });
}
