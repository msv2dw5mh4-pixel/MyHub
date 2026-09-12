import { getAll, putOne } from "./db.js";
import { escapeHtml, uid, openModal, closeModal } from "./ui.js";

async function safeGetAll(storeName) {
  try {
    const rows = await getAll(storeName);
    return Array.isArray(rows)
      ? rows.filter(row => row && typeof row === "object")
      : [];
  } catch (error) {
    console.warn(`[Tâches V28.2] Lecture impossible du store ${storeName}:`, error);
    return [];
  }
}

function fillSelect(selectId, items, emptyLabel, getLabel, selectedValue = "") {
  const select = document.getElementById(selectId);
  if (!select) return;

  const options = [`<option value="">${escapeHtml(emptyLabel)}</option>`];

  for (const item of items) {
    try {
      const id = String(item?.id || "");
      if (!id) continue;

      const label = String(getLabel(item) || "").trim();
      if (!label) continue;

      options.push(
        `<option value="${escapeHtml(id)}" ${id === selectedValue ? "selected" : ""}>${escapeHtml(label)}</option>`
      );
    } catch (error) {
      console.warn("[Tâches V28.2] Élément lié ignoré :", error, item);
    }
  }

  select.innerHTML = options.join("");
  select.disabled = false;
}

async function hydrateTaskLinks(preset = {}) {
  const status = document.getElementById("task-links-status");

  try {
    const [objectives, projects, assets, people, aquariums, plants] = await Promise.all([
      safeGetAll("objectives"),
      safeGetAll("projects"),
      safeGetAll("maintenanceAssets"),
      safeGetAll("people"),
      safeGetAll("livingAquariums"),
      safeGetAll("livingPlants")
    ]);

    fillSelect(
      "task-objective-fast",
      objectives
        .filter(o => (o.status || "active") !== "completed" && o.status !== "cancelled")
        .sort((a, b) => String(a?.title || "").localeCompare(String(b?.title || ""), "fr")),
      "Aucun objectif",
      item => item.title || "Objectif",
      String(preset.objectiveId || "")
    );

    fillSelect(
      "task-project-fast",
      projects
        .filter(p => p.active !== false && (p.status || "active") !== "completed")
        .sort((a, b) => String(a?.title || "").localeCompare(String(b?.title || ""), "fr")),
      "Aucun projet",
      item => item.title || "Projet",
      String(preset.projectId || "")
    );

    fillSelect(
      "task-asset-fast",
      assets
        .filter(a => a.active !== false && !["sold", "retired"].includes(a.ownershipStatus))
        .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), "fr")),
      "Aucun bien",
      item => item.name || "Bien",
      String(preset.assetId || preset.maintenanceAssetId || "")
    );

    fillSelect(
      "task-person-fast",
      people
        .filter(p => p.active !== false)
        .sort((a, b) => {
          const an = [a?.firstName, a?.lastName].filter(Boolean).join(" ") || a?.nickname || "";
          const bn = [b?.firstName, b?.lastName].filter(Boolean).join(" ") || b?.nickname || "";
          return String(an).localeCompare(String(bn), "fr");
        }),
      "Aucune personne",
      item =>
        [item.firstName, item.lastName].filter(Boolean).join(" ").trim() ||
        item.nickname ||
        "Personne",
      String(preset.personId || "")
    );

    const living = [
      ...aquariums
        .filter(a => a.active !== false && a?.id)
        .map(a => ({
          id: `aquarium:${a.id}`,
          label: `Aquarium · ${a.name || "Sans nom"}`
        })),
      ...plants
        .filter(p => p.active !== false && p?.id)
        .map(p => ({
          id: `plant:${p.id}`,
          label: `Plante · ${p.name || "Sans nom"}`
        }))
    ];

    const selectedLiving =
      preset.livingEntityType && preset.livingEntityId
        ? `${preset.livingEntityType}:${preset.livingEntityId}`
        : "";

    fillSelect(
      "task-living-fast",
      living,
      "Aucun aquarium / plante",
      item => item.label,
      selectedLiving
    );

    if (status) status.textContent = "Liens chargés";
  } catch (error) {
    console.error("[Tâches V28.2] Chargement des liens impossible :", error);
    if (status) {
      status.textContent =
        "Liens indisponibles — la tâche peut quand même être créée.";
    }
  }
}

export function openImmediateTaskModal(preset = {}) {
  const editing = Boolean(preset?.id);

  // Important : affichage AVANT toute lecture des autres stores IndexedDB.
  openModal(`
    <div class="modal-head">
      <div>
        <p class="eyebrow">TÂCHE</p>
        <h2>${editing ? "Modifier la tâche" : "Nouvelle tâche"}</h2>
      </div>
      <button class="icon-btn" id="task-fast-close" type="button">×</button>
    </div>

    <form class="form-grid" id="task-fast-form">
      <div class="field">
        <label for="task-title-fast">Nom de la tâche</label>
        <input
          id="task-title-fast"
          name="title"
          required
          maxlength="120"
          value="${escapeHtml(preset.title || "")}"
          placeholder="Ex. Appeler le garage"
        >
      </div>

      <div class="field">
        <label for="task-desc-fast">Description</label>
        <textarea
          id="task-desc-fast"
          name="description"
          placeholder="Informations complémentaires"
        >${escapeHtml(preset.description || "")}</textarea>
      </div>

      <div class="field">
        <label for="task-folder-fast">Dossier</label>
        <input
          id="task-folder-fast"
          name="folder"
          maxlength="60"
          value="${escapeHtml(preset.folder || "")}"
          placeholder="Général, Maison, Travail…"
        >
      </div>

      <div class="row">
        <div class="field">
          <label for="task-due-fast">Échéance</label>
          <input
            id="task-due-fast"
            type="date"
            name="dueDate"
            value="${escapeHtml(preset.dueDate || "")}"
          >
        </div>

        <div class="field">
          <label for="task-reminder-fast">Rappel</label>
          <input
            id="task-reminder-fast"
            type="datetime-local"
            name="reminderAt"
            value="${escapeHtml(preset.reminderAt || "")}"
          >
        </div>
      </div>

      <details>
        <summary style="cursor:pointer;font-weight:700">Liens optionnels</summary>
        <p id="task-links-status" class="muted" style="margin:8px 0">
          Chargement des liens…
        </p>

        <div class="field">
          <label for="task-objective-fast">Objectif lié</label>
          <select id="task-objective-fast" name="objectiveId" disabled>
            <option value="">Chargement…</option>
          </select>
        </div>

        <div class="field">
          <label for="task-project-fast">Projet lié</label>
          <select id="task-project-fast" name="projectId" disabled>
            <option value="">Chargement…</option>
          </select>
        </div>

        <div class="field">
          <label for="task-asset-fast">Bien lié</label>
          <select id="task-asset-fast" name="assetId" disabled>
            <option value="">Chargement…</option>
          </select>
        </div>

        <div class="field">
          <label for="task-person-fast">Personne liée</label>
          <select id="task-person-fast" name="personId" disabled>
            <option value="">Chargement…</option>
          </select>
        </div>

        <div class="field">
          <label for="task-living-fast">Aquarium / plante lié(e)</label>
          <select id="task-living-fast" name="livingLink" disabled>
            <option value="">Chargement…</option>
          </select>
        </div>
      </details>

      <div class="actions">
        <button type="button" class="ghost-btn" id="task-fast-cancel">Annuler</button>
        <button class="primary-btn" id="task-fast-submit" type="submit">
          ${editing ? "Enregistrer" : "Créer"}
        </button>
      </div>
    </form>
  `);

  document
    .getElementById("task-fast-close")
    ?.addEventListener("click", closeModal);

  document
    .getElementById("task-fast-cancel")
    ?.addEventListener("click", closeModal);

  document
    .getElementById("task-fast-form")
    ?.addEventListener("submit", async event => {
      event.preventDefault();

      const form = event.currentTarget;
      const fd = new FormData(form);

      const title = String(fd.get("title") || "").trim();
      if (!title) return;

      const livingLink = String(fd.get("livingLink") || "");
      const [livingEntityType, livingEntityId] = livingLink.includes(":")
        ? livingLink.split(":")
        : [null, null];

      const task = {
        ...preset,
        id: preset.id || uid("task"),
        title,
        description: String(fd.get("description") || "").trim(),
        folder: String(fd.get("folder") || "").trim() || "Général",
        dueDate: String(fd.get("dueDate") || ""),
        reminderAt: String(fd.get("reminderAt") || ""),
        objectiveId: String(fd.get("objectiveId") || "") || null,
        projectId: String(fd.get("projectId") || "") || null,
        assetId: String(fd.get("assetId") || "") || null,
        personId: String(fd.get("personId") || "") || null,
        livingEntityType,
        livingEntityId,
        done: preset.done === true,
        createdAt: preset.createdAt || new Date().toISOString(),
        completedAt: preset.completedAt || null,
        updatedAt: new Date().toISOString()
      };

      const submit = document.getElementById("task-fast-submit");

      if (submit) {
        submit.disabled = true;
        submit.textContent = editing ? "Enregistrement…" : "Création…";
      }

      try {
        await putOne("tasks", task);

        closeModal();

        window.dispatchEvent(
          new CustomEvent("myhub:navigate", { detail: "tasks" })
        );

        window.dispatchEvent(
          new CustomEvent("myhub:data-changed")
        );
      } catch (error) {
        console.error("[Tâches V28.2] Enregistrement impossible :", error);

        alert(
          `Impossible d'enregistrer la tâche. ${
            error?.message || "Erreur IndexedDB."
          }`
        );

        if (submit) {
          submit.disabled = false;
          submit.textContent = editing ? "Enregistrer" : "Créer";
        }
      }
    });

  // Chargement secondaire : il ne peut plus bloquer l'ouverture du formulaire.
  hydrateTaskLinks(preset);

  setTimeout(() => {
    document.getElementById("task-title-fast")?.focus();
  }, 0);
}

// Capture le clic avant les anciens listeners de tasks.js et app.js.
document.addEventListener(
  "click",
  event => {
    const button = event.target?.closest?.("#add-task, #quick-add-task");
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (button.id === "quick-add-task") {
      closeModal();
    }

    queueMicrotask(() => openImmediateTaskModal());
  },
  true
);
