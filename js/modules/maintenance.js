import {
  getAll,
  putOne,
  deleteOne
} from "../core/db.js";

import {
  escapeHtml,
  uid,
  openModal,
  closeModal,
  todayISO
} from "../core/ui.js";

import {
  syncMaintenanceTasks,
  maintenancePlanStatus,
  completeMaintenancePlan,
  deleteMaintenanceTasksForPlan
} from "../core/maintenance_tasks.js";

import { showAddTaskModal } from "./tasks.js";

let currentView = "overview";
let currentAssetId = null;
let dueFilter = "all";
let lastContainer = null;

export async function renderMaintenance(container) {
  lastContainer = container;
  container.innerHTML = `<section class="maintenance-shell" id="maintenance-shell"></section>`;
  await syncMaintenanceTasks();
  await renderCurrentView();
}

export function requestNewMaintenanceAsset() {
  currentView = "assets";
  window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "maintenance" }));
  setTimeout(() => showAssetModal(), 120);
}

function tabs(active) {
  return `
    <div class="maintenance-tabs">
      <button class="maintenance-tab ${active === "overview" ? "active" : ""}" data-maint-view="overview">Résumé</button>
      <button class="maintenance-tab ${active === "assets" ? "active" : ""}" data-maint-view="assets">Biens</button>
      <button class="maintenance-tab ${active === "upcoming" ? "active" : ""}" data-maint-view="upcoming">Échéances</button>
      <button class="maintenance-tab ${active === "history" ? "active" : ""}" data-maint-view="history">Historique</button>
    </div>
  `;
}

function bindTabs(shell) {
  shell.querySelectorAll("[data-maint-view]").forEach(btn => {
    btn.addEventListener("click", async () => {
      currentView = btn.dataset.maintView;
      currentAssetId = null;
      await renderCurrentView();
    });
  });
}

async function renderCurrentView() {
  if (!lastContainer) return;
  const shell = lastContainer.querySelector("#maintenance-shell") || lastContainer;

  await syncMaintenanceTasks();

  if (currentView === "asset-detail") return renderAssetDetail(shell, currentAssetId);
  if (currentView === "assets") return renderAssets(shell);
  if (currentView === "upcoming") return renderUpcoming(shell);
  if (currentView === "history") return renderHistory(shell);

  return renderOverview(shell);
}

async function getData() {
  const [assets, plans, records, tasks, documents, products] = await Promise.all([
    getAll("maintenanceAssets"),
    getAll("maintenancePlans"),
    getAll("maintenanceRecords"),
    getAll("tasks"),
    getAll("documents"),
    getAll("products")
  ]);

  return {
    assets: assets
      .filter(asset => asset.active !== false)
      .sort((a,b) => String(a.name || "").localeCompare(String(b.name || ""))),
    plans: plans
      .filter(plan => plan.active !== false)
      .sort((a,b) => String(a.title || "").localeCompare(String(b.title || ""))),
    records: [...records].sort((a,b) =>
      String(b.date || "").localeCompare(String(a.date || "")) ||
      String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    ),
    tasks: [...tasks].sort((a,b) => String(a.dueDate || "9999-12-31").localeCompare(String(b.dueDate || "9999-12-31"))),
    documents: documents.filter(doc => doc.active !== false),
    products
  };
}

function assetIcon(asset) {
  const category = String(asset?.category || "").toLowerCase();
  if (category.includes("voiture") || category.includes("auto") || category.includes("véhic")) return "🚗";
  if (category.includes("moto")) return "🏍️";
  if (category.includes("vélo") || category.includes("velo")) return "🚲";
  if (category.includes("maison") || category.includes("logement")) return "🏠";
  if (category.includes("jardin")) return "🌿";
  if (category.includes("électro") || category.includes("electro")) return "🔌";
  if (category.includes("informat")) return "💻";
  if (category.includes("bateau") || category.includes("naut")) return "⛵";
  return "🔧";
}

function formatDate(date) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(`${date}T12:00:00`));
}

function formatMoney(value) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

function ownershipLabel(asset) {
  const status = asset?.ownershipStatus || "active";
  if (status === "watch") return "À surveiller";
  if (status === "replace") return "À remplacer";
  if (status === "sale") return "À vendre";
  if (status === "sold") return "Vendu";
  if (status === "retired") return "Retiré / recyclé";
  return "En service";
}

function ownershipClass(asset) {
  const status = asset?.ownershipStatus || "active";
  if (status === "watch") return "soon";
  if (status === "replace" || status === "retired") return "due";
  if (status === "sale") return "sale";
  if (status === "sold") return "none";
  return "ok";
}

function warrantyInfo(asset) {
  if (!asset?.warrantyEnd) return { state: "none", label: "Non renseignée", days: null };
  const today = new Date(`${todayISO()}T12:00:00`);
  const end = new Date(`${asset.warrantyEnd}T12:00:00`);
  const days = Math.ceil((end - today) / 86400000);
  if (days < 0) return { state: "expired", label: `Expirée depuis ${Math.abs(days)} j`, days };
  if (days <= 30) return { state: "soon", label: `Expire dans ${days} j`, days };
  return { state: "ok", label: `Jusqu'au ${formatDate(asset.warrantyEnd)}`, days };
}

function purchaseDateFromAsset(asset) {
  if (asset?.purchaseDate) return asset.purchaseDate;
  if (asset?.purchaseYear) return `${asset.purchaseYear}-01-01`;
  return "";
}

function stockCategoryFromAsset(asset) {
  const category = String(asset?.category || "").toLowerCase();
  if (category.includes("télé") || category.includes("tele") || category.includes("électron")) return "Électronique";
  if (category.includes("informat") || category.includes("ordinateur") || category.includes("mac")) return "Informatique";
  if (category.includes("outil")) return "Outillage";
  if (category.includes("sport") || category.includes("vélo") || category.includes("velo")) return "Sport";
  if (category.includes("maison") || category.includes("électro") || category.includes("electro")) return "Maison";
  if (category.includes("meuble") || category.includes("mobilier")) return "Mobilier";
  return "Autre";
}

function assetDescriptionForStock(asset) {
  return [
    asset.brand && `Marque : ${asset.brand}`,
    (asset.model || asset.reference) && `Modèle : ${asset.model || asset.reference}`,
    asset.serialNumber && `N° de série : ${asset.serialNumber}`,
    asset.condition && `État : ${asset.condition}`,
    asset.notes
  ].filter(Boolean).join("\n");
}

function compressAssetImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const max = 1200;
        let width = image.width;
        let height = image.height;
        const ratio = Math.min(1, max / width, max / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      image.onerror = reject;
      image.src = event.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function meterLabel(asset, value) {
  if (value === null || value === undefined || value === "") return "—";
  return `${Number(value).toLocaleString("fr-FR")} ${asset?.meterUnit || ""}`.trim();
}

function statusLabel(status) {
  if (status.state === "due") return "À faire";
  if (status.state === "soon") return "Bientôt";
  if (status.state === "ok") return "À jour";
  return "Sans échéance";
}

function statusClass(status) {
  if (status.state === "due") return "due";
  if (status.state === "soon") return "soon";
  if (status.state === "ok") return "ok";
  return "none";
}

function dueText(plan, asset, status) {
  const lines = [];

  if (plan.nextDueDate) {
    if (status.dateRemaining < 0) {
      lines.push(`Date dépassée de ${Math.abs(status.dateRemaining)} j`);
    } else if (status.dateRemaining === 0) {
      lines.push("Échéance aujourd'hui");
    } else {
      lines.push(`${formatDate(plan.nextDueDate)} · dans ${status.dateRemaining} j`);
    }
  }

  if (plan.nextDueMeter !== null && plan.nextDueMeter !== undefined && plan.nextDueMeter !== "") {
    if (status.meterRemaining <= 0) {
      lines.push(`Seuil dépassé de ${Math.abs(Math.round(status.meterRemaining)).toLocaleString("fr-FR")} ${asset.meterUnit || "unités"}`);
    } else {
      lines.push(`${meterLabel(asset, plan.nextDueMeter)} · reste ${Math.round(status.meterRemaining).toLocaleString("fr-FR")} ${asset.meterUnit || "unités"}`);
    }
  }

  return lines.join("<br>") || "Aucune prochaine échéance";
}

function nextPlans(data) {
  return data.plans
    .map(plan => {
      const asset = data.assets.find(asset => asset.id === plan.assetId);
      if (!asset || ["sold", "retired"].includes(asset.ownershipStatus)) return null;
      const status = maintenancePlanStatus(plan, asset);
      return { plan, asset, status };
    })
    .filter(Boolean)
    .sort((a,b) => {
      const rank = { due: 0, soon: 1, ok: 2, none: 3 };
      const stateSort = rank[a.status.state] - rank[b.status.state];
      if (stateSort) return stateSort;

      const ad = a.plan.nextDueDate || "9999-12-31";
      const bd = b.plan.nextDueDate || "9999-12-31";
      return ad.localeCompare(bd);
    });
}

function planCard(entry, { showAsset = true } = {}) {
  const { plan, asset, status } = entry;

  return `
    <article class="maintenance-plan-card">
      <div class="maintenance-plan-head">
        <div>
          <h3>${escapeHtml(plan.title)}</h3>
          <p>${showAsset ? `${escapeHtml(asset.name)} · ` : ""}${escapeHtml(plan.category || "Entretien")}</p>
          <span class="maintenance-status ${statusClass(status)}">${statusLabel(status)}</span>
        </div>
        <div class="maintenance-plan-actions">
          <button class="icon-btn" data-maint-edit-plan="${plan.id}" aria-label="Modifier">✎</button>
        </div>
      </div>

      <div class="maintenance-due-line ${status.state === "due" ? "due" : status.state === "soon" ? "soon" : ""}">
        ${dueText(plan, asset, status)}
      </div>

      <div class="maintenance-actions">
        <button class="primary-btn" data-maint-complete-plan="${plan.id}">Enregistrer l'entretien</button>
        <button class="ghost-btn" data-maint-open-asset="${asset.id}">Voir le bien</button>
      </div>
    </article>
  `;
}

function bindPlanActions(shell, data) {
  shell.querySelectorAll("[data-maint-complete-plan]").forEach(btn => {
    btn.addEventListener("click", () => showCompleteModal(btn.dataset.maintCompletePlan));
  });

  shell.querySelectorAll("[data-maint-edit-plan]").forEach(btn => {
    btn.addEventListener("click", () => showPlanModal(null, btn.dataset.maintEditPlan));
  });

  shell.querySelectorAll("[data-maint-open-asset]").forEach(btn => {
    btn.addEventListener("click", async () => {
      currentAssetId = btn.dataset.maintOpenAsset;
      currentView = "asset-detail";
      await renderCurrentView();
    });
  });
}

async function renderOverview(shell) {
  const data = await getData();
  const entries = nextPlans(data);
  const due = entries.filter(entry => entry.status.state === "due");
  const soon = entries.filter(entry => entry.status.state === "soon");
  const totalCost = data.records.reduce((sum, record) => sum + Number(record.cost || 0), 0);
  const warrantySoon = data.assets.filter(asset => warrantyInfo(asset).state === "soon").length;
  const assetTasksOpen = data.tasks.filter(task => !task.done && (task.assetId || task.maintenanceAssetId)).length;

  shell.innerHTML = `
    ${tabs("overview")}

    <div class="maintenance-hero">
      <span>Entretien</span>
      <strong>${due.length} à faire</strong>
      <small>${soon.length} entretien${soon.length > 1 ? "s" : ""} bientôt · ${assetTasksOpen} tâche${assetTasksOpen > 1 ? "s" : ""} liée${assetTasksOpen > 1 ? "s" : ""} · ${warrantySoon} garantie${warrantySoon > 1 ? "s" : ""} à surveiller</small>
    </div>

    <section class="maintenance-section">
      <div class="maintenance-section-head">
        <div>
          <h2>Priorités</h2>
          <p>Les entretiens les plus proches ou déjà dépassés.</p>
        </div>
        <button class="primary-btn" id="maintenance-add-asset">+ Bien</button>
      </div>

      <div class="maintenance-list">
        ${
          entries.filter(entry => ["due","soon"].includes(entry.status.state)).length
            ? entries.filter(entry => ["due","soon"].includes(entry.status.state)).slice(0,5).map(entry => planCard(entry)).join("")
            : `
              <div class="maintenance-empty">
                <h3>Tout est à jour</h3>
                <p>Aucune échéance d'entretien proche.</p>
              </div>
            `
        }
      </div>
    </section>

    <section class="maintenance-section">
      <div class="maintenance-section-head">
        <div>
          <h2>Mes biens</h2>
          <p>Voiture, vélo, maison, matériel ou équipement.</p>
        </div>
      </div>

      <div class="maintenance-list">
        ${
          data.assets.length
            ? data.assets.slice(0,4).map(asset => {
                const assetPlans = entries.filter(entry => entry.asset.id === asset.id);
                const urgent = assetPlans.find(entry => entry.status.state === "due")
                  || assetPlans.find(entry => entry.status.state === "soon");
                return `
                  <article class="maintenance-asset-card" data-maint-asset="${asset.id}">
                    <div class="maintenance-asset-head">
                      <div style="display:flex;gap:12px;align-items:center">
                        <div class="maintenance-icon">${assetIcon(asset)}</div>
                        <div>
                          <h3>${escapeHtml(asset.name)}</h3>
                          <p>${escapeHtml(asset.category || "Autre")}${asset.meterUnit ? ` · ${meterLabel(asset, asset.currentMeter)}` : ""}</p>
                        </div>
                      </div>
                      <span class="maintenance-status ${urgent ? statusClass(urgent.status) : "ok"}">${urgent ? statusLabel(urgent.status) : "À jour"}</span>
                    </div>
                  </article>
                `;
              }).join("")
            : `
              <div class="maintenance-empty">
                <h3>Aucun bien suivi</h3>
                <p>Ajoute ta voiture, ton vélo ou un équipement pour commencer.</p>
              </div>
            `
        }
      </div>
    </section>
  `;

  bindTabs(shell);
  bindPlanActions(shell, data);

  shell.querySelector("#maintenance-add-asset").addEventListener("click", () => showAssetModal());

  shell.querySelectorAll("[data-maint-asset]").forEach(card => {
    card.addEventListener("click", async () => {
      currentAssetId = card.dataset.maintAsset;
      currentView = "asset-detail";
      await renderCurrentView();
    });
  });
}

async function renderAssets(shell) {
  const data = await getData();
  const entries = nextPlans(data);

  shell.innerHTML = `
    ${tabs("assets")}

    <section class="maintenance-section">
      <div class="maintenance-section-head">
        <div>
          <h2>Mes biens</h2>
          <p>${data.assets.length} bien${data.assets.length > 1 ? "s" : ""} suivi${data.assets.length > 1 ? "s" : ""}</p>
        </div>
        <button class="primary-btn" id="maintenance-assets-add">+ Bien</button>
      </div>

      <div class="maintenance-list">
        ${
          data.assets.length
            ? data.assets.map(asset => {
                const plans = entries.filter(entry => entry.asset.id === asset.id);
                const dueCount = plans.filter(entry => entry.status.state === "due").length;
                const soonCount = plans.filter(entry => entry.status.state === "soon").length;
                const records = data.records.filter(record => record.assetId === asset.id);
                const cost = records.reduce((sum, record) => sum + Number(record.cost || 0), 0);
                const openTasks = data.tasks.filter(task => task.assetId === asset.id && !task.done).length;
                const warranty = warrantyInfo(asset);

                return `
                  <article class="maintenance-asset-card" data-maint-asset="${asset.id}">
                    <div class="maintenance-asset-head">
                      <div class="maintenance-asset-identity">
                        ${asset.photo ? `<img class="maintenance-asset-thumb" src="${asset.photo}" alt="${escapeHtml(asset.name)}">` : `<div class="maintenance-icon">${assetIcon(asset)}</div>`}
                        <div>
                          <h3>${escapeHtml(asset.name)}</h3>
                          <p>${escapeHtml(asset.category || "Autre")}${asset.brand ? ` · ${escapeHtml(asset.brand)}` : ""}${(asset.model || asset.reference) ? ` · ${escapeHtml(asset.model || asset.reference)}` : ""}</p>
                          <div class="maintenance-inline-badges">
                            <span class="maintenance-status ${ownershipClass(asset)}">${ownershipLabel(asset)}</span>
                            ${warranty.state === "soon" ? `<span class="maintenance-status soon">Garantie · ${warranty.label}</span>` : ""}
                          </div>
                        </div>
                      </div>
                      <span class="maintenance-status ${dueCount ? "due" : soonCount ? "soon" : "ok"}">${dueCount ? `${dueCount} à faire` : soonCount ? `${soonCount} bientôt` : "À jour"}</span>
                    </div>

                    <div class="maintenance-metrics">
                      <div class="maintenance-metric"><span>Tâches</span><strong>${openTasks}</strong></div>
                      <div class="maintenance-metric"><span>Plans</span><strong>${plans.length}</strong></div>
                      <div class="maintenance-metric"><span>Coût entretien</span><strong>${formatMoney(cost)}</strong></div>
                    </div>
                  </article>
                `;
              }).join("")
            : `
              <div class="maintenance-empty">
                <h3>Aucun bien</h3>
                <p>Ajoute le premier élément que tu veux entretenir.</p>
                <button class="primary-btn" id="maintenance-empty-add">Ajouter un bien</button>
              </div>
            `
        }
      </div>
    </section>
  `;

  bindTabs(shell);
  shell.querySelector("#maintenance-assets-add").addEventListener("click", () => showAssetModal());

  const empty = shell.querySelector("#maintenance-empty-add");
  if (empty) empty.addEventListener("click", () => showAssetModal());

  shell.querySelectorAll("[data-maint-asset]").forEach(card => {
    card.addEventListener("click", async () => {
      currentAssetId = card.dataset.maintAsset;
      currentView = "asset-detail";
      await renderCurrentView();
    });
  });
}

async function renderUpcoming(shell) {
  const data = await getData();
  let entries = nextPlans(data);

  if (dueFilter !== "all") {
    entries = entries.filter(entry => entry.status.state === dueFilter);
  }

  const warranties = data.assets
    .map(asset => ({ asset, warranty: warrantyInfo(asset) }))
    .filter(row => ["soon", "expired"].includes(row.warranty.state))
    .sort((a,b) => String(a.asset.warrantyEnd || "").localeCompare(String(b.asset.warrantyEnd || "")));

  shell.innerHTML = `
    ${tabs("upcoming")}

    <section class="maintenance-section">
      <div class="maintenance-section-head">
        <div>
          <h2>Échéances</h2>
          <p>Les tâches sont créées automatiquement lorsqu'un entretien approche.</p>
        </div>
      </div>

      <div class="maintenance-filter-row">
        <button class="maintenance-filter ${dueFilter === "all" ? "active" : ""}" data-due-filter="all">Toutes</button>
        <button class="maintenance-filter ${dueFilter === "due" ? "active" : ""}" data-due-filter="due">À faire</button>
        <button class="maintenance-filter ${dueFilter === "soon" ? "active" : ""}" data-due-filter="soon">Bientôt</button>
        <button class="maintenance-filter ${dueFilter === "ok" ? "active" : ""}" data-due-filter="ok">À jour</button>
      </div>

      <div class="maintenance-list" style="margin-top:12px">
        ${
          entries.length
            ? entries.map(entry => planCard(entry)).join("")
            : `<div class="maintenance-empty"><h3>Aucune échéance</h3><p>Aucun entretien dans ce filtre.</p></div>`
        }
      </div>
    </section>

    ${warranties.length ? `<section class="maintenance-section">
      <div class="maintenance-section-head"><div><h2>Garanties</h2><p>Les garanties expirées ou à moins de 30 jours.</p></div></div>
      <div class="maintenance-list">
        ${warranties.map(row => `<article class="maintenance-plan-card">
          <div class="maintenance-plan-head"><div><h3>${escapeHtml(row.asset.name)}</h3><p>Fin de garantie · ${formatDate(row.asset.warrantyEnd)}</p><span class="maintenance-status ${row.warranty.state === "expired" ? "due" : "soon"}">${escapeHtml(row.warranty.label)}</span></div></div>
          <div class="maintenance-actions"><button class="ghost-btn" data-maint-open-warranty-asset="${row.asset.id}">Voir le bien</button></div>
        </article>`).join("")}
      </div>
    </section>` : ""}
  `;

  bindTabs(shell);
  bindPlanActions(shell, data);

  shell.querySelectorAll("[data-due-filter]").forEach(btn => {
    btn.addEventListener("click", async () => {
      dueFilter = btn.dataset.dueFilter;
      await renderUpcoming(shell);
    });
  });

  shell.querySelectorAll("[data-maint-open-warranty-asset]").forEach(btn => {
    btn.addEventListener("click", async () => {
      currentAssetId = btn.dataset.maintOpenWarrantyAsset;
      currentView = "asset-detail";
      await renderCurrentView();
    });
  });
}

async function renderHistory(shell) {
  const data = await getData();

  shell.innerHTML = `
    ${tabs("history")}

    <section class="maintenance-section">
      <div class="maintenance-section-head">
        <div>
          <h2>Historique</h2>
          <p>${data.records.length} entretien${data.records.length > 1 ? "s" : ""} enregistré${data.records.length > 1 ? "s" : ""}</p>
        </div>
      </div>

      <div class="maintenance-list">
        ${
          data.records.length
            ? data.records.map(record => {
                const asset = data.assets.find(asset => asset.id === record.assetId);
                return `
                  <article class="maintenance-record-card">
                    <div class="maintenance-record-head">
                      <div>
                        <strong>${escapeHtml(record.title || "Entretien")}</strong>
                        <small>${asset ? escapeHtml(asset.name) : "Bien supprimé"} · ${formatDate(record.date)}${record.meter !== null && record.meter !== undefined && asset?.meterUnit ? ` · ${meterLabel(asset, record.meter)}` : ""}</small>
                      </div>
                      <div class="maintenance-cost">${formatMoney(record.cost)}</div>
                    </div>
                    ${record.notes ? `<small style="margin-top:9px">${escapeHtml(record.notes)}</small>` : ""}
                  </article>
                `;
              }).join("")
            : `<div class="maintenance-empty"><h3>Aucun historique</h3><p>Les entretiens terminés apparaîtront ici.</p></div>`
        }
      </div>
    </section>
  `;

  bindTabs(shell);
}

async function renderAssetDetail(shell, assetId) {
  const data = await getData();
  const asset = data.assets.find(asset => asset.id === assetId);

  if (!asset) {
    currentView = "assets";
    currentAssetId = null;
    await renderCurrentView();
    return;
  }

  const plans = nextPlans(data).filter(entry => entry.asset.id === asset.id);
  const records = data.records.filter(record => record.assetId === asset.id);
  const linkedTasks = data.tasks.filter(task => task.assetId === asset.id);
  const openTasks = linkedTasks.filter(task => !task.done);
  const doneTasks = linkedTasks.filter(task => task.done);
  const documents = data.documents.filter(doc => doc.assetId === asset.id);
  const maintenanceCost = records.reduce((sum, record) => sum + Number(record.cost || 0), 0);
  const purchasePrice = Number(asset.purchasePrice || 0);
  const totalOwnershipCost = purchasePrice + maintenanceCost;
  const warranty = warrantyInfo(asset);
  const linkedProduct = asset.stockProductId
    ? data.products.find(product => String(product.id) === String(asset.stockProductId))
    : data.products.find(product => product.sourceAssetId === asset.id);

  const timeline = [
    ...records.map(record => ({
      date: record.date || String(record.createdAt || "").slice(0,10),
      icon: "🔧",
      title: record.title || "Entretien",
      subtitle: `${formatMoney(record.cost || 0)}${record.meter !== null && record.meter !== undefined && asset.meterUnit ? ` · ${meterLabel(asset, record.meter)}` : ""}`
    })),
    ...doneTasks.map(task => ({
      date: String(task.completedAt || task.dueDate || task.createdAt || "").slice(0,10),
      icon: "✓",
      title: task.title,
      subtitle: "Tâche terminée"
    })),
    ...(purchaseDateFromAsset(asset) ? [{
      date: purchaseDateFromAsset(asset),
      icon: "🛍️",
      title: "Achat du bien",
      subtitle: purchasePrice ? formatMoney(purchasePrice) : "Prix non renseigné"
    }] : [])
  ].filter(item => item.date).sort((a,b) => String(b.date).localeCompare(String(a.date)));

  shell.innerHTML = `
    <button class="stock-back" id="maintenance-detail-back">‹ Entretien</button>

    <div class="maintenance-detail-top maintenance-asset-profile">
      ${asset.photo ? `<img class="maintenance-detail-photo" src="${asset.photo}" alt="${escapeHtml(asset.name)}">` : `<div class="maintenance-detail-photo-placeholder">${assetIcon(asset)}</div>`}
      <div class="maintenance-asset-profile-content">
        <span class="eyebrow" style="color:#d0d5dd">${escapeHtml(asset.category || "BIEN")}</span>
        <h2>${escapeHtml(asset.name)}</h2>
        <p>${[asset.brand, asset.model || asset.reference].filter(Boolean).map(escapeHtml).join(" · ") || "Bien personnel"}${asset.meterUnit ? ` · ${meterLabel(asset, asset.currentMeter)}` : ""}</p>

        <div class="maintenance-inline-badges">
          <span class="maintenance-status ${ownershipClass(asset)}">${ownershipLabel(asset)}</span>
          ${warranty.state !== "none" ? `<span class="maintenance-status ${warranty.state === "soon" ? "soon" : warranty.state === "expired" ? "due" : "ok"}">Garantie · ${escapeHtml(warranty.label)}</span>` : ""}
        </div>

        <div class="maintenance-actions">
          <button class="ghost-btn" id="maintenance-edit-asset">Modifier</button>
          <button class="primary-btn" id="maintenance-add-linked-task">+ Tâche liée</button>
          ${asset.meterUnit ? `<button class="ghost-btn" id="maintenance-update-meter">Mettre à jour le compteur</button>` : ""}
        </div>
      </div>
    </div>

    ${warranty.state === "soon" ? `<div class="maintenance-warranty-alert"><strong>Garantie bientôt terminée</strong><span>${escapeHtml(asset.name)} : ${escapeHtml(warranty.label)}. Pense à vérifier son état avant l'échéance.</span></div>` : ""}

    <section class="maintenance-detail-card" style="margin-top:12px">
      <div class="maintenance-detail-head"><div><h3>Informations du bien</h3><p class="muted" style="margin:4px 0 0">Achat, identification et état.</p></div></div>
      <div class="maintenance-info-grid">
        <div><span>Année d'achat</span><strong>${asset.purchaseYear || (asset.purchaseDate ? String(asset.purchaseDate).slice(0,4) : "—")}</strong></div>
        <div><span>Prix d'achat</span><strong>${purchasePrice ? formatMoney(purchasePrice) : "—"}</strong></div>
        <div><span>Fin de garantie</span><strong>${asset.warrantyEnd ? formatDate(asset.warrantyEnd) : "—"}</strong></div>
        <div><span>État</span><strong>${escapeHtml(asset.condition || "Non renseigné")}</strong></div>
        <div><span>N° de série</span><strong>${escapeHtml(asset.serialNumber || "—")}</strong></div>
        <div><span>Lieu d'achat</span><strong>${escapeHtml(asset.purchasePlace || "—")}</strong></div>
      </div>
    </section>

    <section class="maintenance-detail-card" style="margin-top:12px">
      <div class="maintenance-detail-head">
        <div><h3>Tâches liées</h3><p class="muted" style="margin:4px 0 0">${openTasks.length} en cours · ${doneTasks.length} terminée${doneTasks.length > 1 ? "s" : ""}</p></div>
        <button class="primary-btn" id="maintenance-add-linked-task-2">+ Tâche</button>
      </div>
      <div class="maintenance-list" style="margin-top:12px">
        ${openTasks.length ? openTasks.slice(0,6).map(task => `
          <article class="maintenance-linked-task">
            <div><strong>${escapeHtml(task.title)}</strong><small>${task.dueDate ? `Échéance · ${formatDate(task.dueDate)}` : "Sans échéance"}</small></div>
            <span class="maintenance-status ${task.dueDate && task.dueDate < todayISO() ? "due" : task.dueDate === todayISO() ? "soon" : "none"}">${task.dueDate === todayISO() ? "Aujourd'hui" : task.dueDate && task.dueDate < todayISO() ? "En retard" : "À faire"}</span>
          </article>`).join("") : `<p class="muted">Aucune tâche en cours pour ce bien.</p>`}
      </div>
    </section>

    <section class="maintenance-detail-card" style="margin-top:12px">
      <div class="maintenance-detail-head">
        <div><h3>Plans d'entretien</h3><p class="muted" style="margin:4px 0 0">${plans.length} plan${plans.length > 1 ? "s" : ""}</p></div>
        <div class="maintenance-detail-actions">
          <button class="ghost-btn" id="maintenance-add-event">+ Événement fait</button>
          <button class="primary-btn" id="maintenance-add-plan">+ Entretien</button>
        </div>
      </div>
      <div class="maintenance-list" style="margin-top:12px">
        ${plans.length ? plans.map(entry => planCard(entry, { showAsset: false })).join("") : `<div class="maintenance-empty"><h3>Aucun plan</h3><p>Ajoute une vidange, un contrôle, un remplacement ou tout autre entretien.</p></div>`}
      </div>
    </section>

    <section class="maintenance-detail-card" style="margin-top:12px">
      <div class="maintenance-detail-head"><div><h3>Coût du bien</h3><p class="muted" style="margin:4px 0 0">Achat + dépenses d'entretien enregistrées.</p></div></div>
      <div class="maintenance-metrics">
        <div class="maintenance-metric"><span>Achat</span><strong>${purchasePrice ? formatMoney(purchasePrice) : "—"}</strong></div>
        <div class="maintenance-metric"><span>Entretien</span><strong>${formatMoney(maintenanceCost)}</strong></div>
        <div class="maintenance-metric"><span>Total</span><strong>${formatMoney(totalOwnershipCost)}</strong></div>
      </div>
    </section>

    <section class="maintenance-detail-card" style="margin-top:12px">
      <div class="maintenance-detail-head">
        <div><h3>Documents liés</h3><p class="muted" style="margin:4px 0 0">${documents.length} document${documents.length > 1 ? "s" : ""}</p></div>
        <button class="ghost-btn" id="maintenance-open-documents">Documents</button>
      </div>
      <div class="maintenance-list" style="margin-top:12px">
        ${documents.length ? documents.slice(0,5).map(doc => `<article class="maintenance-document-row"><div><strong>📄 ${escapeHtml(doc.title)}</strong><small>${escapeHtml(doc.category || "Document")}${doc.expiryDate ? ` · expire le ${formatDate(doc.expiryDate)}` : ""}</small></div></article>`).join("") : `<p class="muted">Aucun document relié à ce bien.</p>`}
      </div>
    </section>

    <section class="maintenance-detail-card" style="margin-top:12px">
      <h3>Historique du bien</h3>
      <div class="maintenance-timeline" style="margin-top:12px">
        ${timeline.length ? timeline.slice(0,12).map(item => `<article><span class="maintenance-timeline-icon">${item.icon}</span><div><strong>${escapeHtml(item.title)}</strong><small>${formatDate(item.date)} · ${escapeHtml(item.subtitle)}</small></div></article>`).join("") : `<p class="muted">Aucun événement enregistré.</p>`}
      </div>
    </section>

    ${asset.notes ? `<section class="maintenance-detail-card" style="margin-top:12px"><h3>Notes</h3><p class="muted" style="margin:8px 0 0;line-height:1.55">${escapeHtml(asset.notes)}</p></section>` : ""}

    <section class="maintenance-detail-card maintenance-sale-card" style="margin-top:12px">
      <div><h3>${linkedProduct ? "Bien transféré vers Stock" : "Tu ne l'utilises plus ?"}</h3><p>${linkedProduct ? `Ce bien possède une fiche Stock (${linkedProduct.status === "sold" ? "vendue" : "en vente / stock"}).` : "Transfère-le vers Stock sans ressaisir la photo, le prix d'achat ou sa description."}</p></div>
      ${linkedProduct ? `<button class="ghost-btn" id="maintenance-open-stock">Ouvrir Stock</button>` : `<button class="primary-btn" id="maintenance-transfer-stock">Passer en vente</button>`}
    </section>

    <button class="danger-btn" id="maintenance-delete-asset" style="margin-top:12px;width:100%">Supprimer ce bien</button>
  `;

  shell.querySelector("#maintenance-detail-back").addEventListener("click", async () => {
    currentAssetId = null;
    currentView = "assets";
    await renderCurrentView();
  });

  shell.querySelector("#maintenance-edit-asset").addEventListener("click", () => showAssetModal(asset.id));
  shell.querySelector("#maintenance-add-plan").addEventListener("click", () => showPlanModal(asset.id));
  shell.querySelector("#maintenance-add-event").addEventListener("click", () => showManualMaintenanceEventModal(asset.id));

  const addLinkedTask = () => showAddTaskModal({ assetId: asset.id, folder: "Entretien" });
  shell.querySelector("#maintenance-add-linked-task").addEventListener("click", addLinkedTask);
  shell.querySelector("#maintenance-add-linked-task-2").addEventListener("click", addLinkedTask);

  const meterButton = shell.querySelector("#maintenance-update-meter");
  if (meterButton) meterButton.addEventListener("click", () => showMeterModal(asset.id));

  shell.querySelector("#maintenance-open-documents").addEventListener("click", () => window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "documents" })));

  const transferButton = shell.querySelector("#maintenance-transfer-stock");
  if (transferButton) transferButton.addEventListener("click", () => showTransferToStockModal(asset));
  const openStock = shell.querySelector("#maintenance-open-stock");
  if (openStock) openStock.addEventListener("click", () => window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "stock" })));

  bindPlanActions(shell, data);

  shell.querySelector("#maintenance-delete-asset").addEventListener("click", async () => {
    if (!confirm(`Supprimer "${asset.name}", ses plans et son historique d'entretien ? Les tâches et documents liés seront conservés mais détachés du bien.`)) return;

    for (const plan of data.plans.filter(plan => plan.assetId === asset.id)) {
      await deleteMaintenanceTasksForPlan(plan.id);
      await deleteOne("maintenancePlans", plan.id);
    }

    for (const record of data.records.filter(record => record.assetId === asset.id)) {
      await deleteOne("maintenanceRecords", record.id);
    }

    for (const task of linkedTasks) {
      await putOne("tasks", { ...task, assetId: null, updatedAt: new Date().toISOString() });
    }

    for (const doc of documents) {
      await putOne("documents", { ...doc, assetId: null, updatedAt: new Date().toISOString() });
    }

    await deleteOne("maintenanceAssets", asset.id);
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    currentAssetId = null;
    currentView = "assets";
    await renderCurrentView();
  });
}

async function showAssetModal(assetId = null) {
  const assets = await getAll("maintenanceAssets");
  const asset = assets.find(asset => asset.id === assetId);
  let selectedPhoto = asset?.photo || null;

  openModal(`
    <div class="modal-head">
      <div><p class="eyebrow">ENTRETIEN · MES BIENS</p><h2>${asset ? "Modifier" : "Nouveau"} bien</h2></div>
      <button class="icon-btn" id="maintenance-asset-close">×</button>
    </div>

    <form class="form-grid" id="maintenance-asset-form">
      <div>
        <input class="maintenance-photo-input" type="file" id="maintenance-asset-photo" accept="image/*" capture="environment">
        <label class="maintenance-photo-preview" for="maintenance-asset-photo" id="maintenance-photo-preview">
          ${selectedPhoto ? `<img src="${selectedPhoto}" alt="Photo du bien">` : `<div><span>📷</span><strong>Ajouter une photo</strong><small>Appareil photo ou photothèque</small></div>`}
        </label>
      </div>

      <div class="field"><label>Nom</label><input name="name" required maxlength="100" value="${escapeHtml(asset?.name || "")}" placeholder="Ex : iPhone, Peugeot 208, MacBook..."></div>
      <div class="field"><label>Catégorie</label><input name="category" maxlength="60" value="${escapeHtml(asset?.category || "")}" placeholder="Téléphone, Voiture, Informatique, Maison..."></div>

      <div class="row">
        <div class="field"><label>Marque</label><input name="brand" maxlength="80" value="${escapeHtml(asset?.brand || "")}" placeholder="Apple, Peugeot..."></div>
        <div class="field"><label>Modèle</label><input name="model" maxlength="100" value="${escapeHtml(asset?.model || asset?.reference || "")}" placeholder="iPhone 14, 208 GT..."></div>
      </div>

      <div class="field"><label>Numéro de série / identification</label><input name="serialNumber" maxlength="120" value="${escapeHtml(asset?.serialNumber || "")}" placeholder="N° de série, immatriculation..."></div>

      <div class="row">
        <div class="field"><label>Année d'achat</label><input type="number" name="purchaseYear" min="1900" max="2100" step="1" value="${asset?.purchaseYear || (asset?.purchaseDate ? String(asset.purchaseDate).slice(0,4) : "")}" placeholder="2026"></div>
        <div class="field"><label>Prix d'achat</label><input type="number" name="purchasePrice" min="0" step="0.01" value="${asset?.purchasePrice ?? ""}" placeholder="0"></div>
      </div>

      <div class="row">
        <div class="field"><label>Fin de garantie</label><input type="date" name="warrantyEnd" value="${asset?.warrantyEnd || ""}"></div>
        <div class="field"><label>Lieu d'achat</label><input name="purchasePlace" maxlength="100" value="${escapeHtml(asset?.purchasePlace || "")}" placeholder="Apple Store, Fnac..."></div>
      </div>

      <div class="row">
        <div class="field"><label>État</label><select name="condition">
          <option value="" ${!asset?.condition ? "selected" : ""}>Non renseigné</option>
          <option value="Excellent" ${asset?.condition === "Excellent" ? "selected" : ""}>Excellent</option>
          <option value="Bon" ${asset?.condition === "Bon" ? "selected" : ""}>Bon</option>
          <option value="Moyen" ${asset?.condition === "Moyen" ? "selected" : ""}>Moyen</option>
          <option value="À réparer" ${asset?.condition === "À réparer" ? "selected" : ""}>À réparer</option>
        </select></div>
        <div class="field"><label>Statut du bien</label><select name="ownershipStatus">
          <option value="active" ${(asset?.ownershipStatus || "active") === "active" ? "selected" : ""}>En service</option>
          <option value="watch" ${asset?.ownershipStatus === "watch" ? "selected" : ""}>À surveiller</option>
          <option value="replace" ${asset?.ownershipStatus === "replace" ? "selected" : ""}>À remplacer</option>
          <option value="sale" ${asset?.ownershipStatus === "sale" ? "selected" : ""}>À vendre</option>
          <option value="sold" ${asset?.ownershipStatus === "sold" ? "selected" : ""}>Vendu</option>
          <option value="retired" ${asset?.ownershipStatus === "retired" ? "selected" : ""}>Retiré / recyclé</option>
        </select></div>
      </div>

      <div class="row">
        <div class="field">
          <label>Compteur suivi</label>
          <select name="meterUnit" id="maintenance-meter-unit">
            <option value="" ${!asset?.meterUnit ? "selected" : ""}>Aucun</option>
            <option value="km" ${asset?.meterUnit === "km" ? "selected" : ""}>Kilomètres</option>
            <option value="h" ${asset?.meterUnit === "h" ? "selected" : ""}>Heures</option>
            <option value="cycles" ${asset?.meterUnit === "cycles" ? "selected" : ""}>Cycles</option>
          </select>
        </div>
        <div class="field" id="maintenance-current-meter-wrap"><label>Valeur actuelle</label><input type="number" name="currentMeter" min="0" step="1" value="${asset?.currentMeter ?? 0}"></div>
      </div>

      <div class="field"><label>Notes</label><textarea name="notes" placeholder="Informations utiles, état, accessoires, détails...">${escapeHtml(asset?.notes || "")}</textarea></div>

      <div class="actions"><button type="button" class="ghost-btn" id="maintenance-asset-cancel">Annuler</button><button class="primary-btn" type="submit">Enregistrer</button></div>
    </form>
  `);

  const unit = document.querySelector("#maintenance-meter-unit");
  const meterWrap = document.querySelector("#maintenance-current-meter-wrap");
  const photoInput = document.querySelector("#maintenance-asset-photo");
  const photoPreview = document.querySelector("#maintenance-photo-preview");

  const updateMeterVisibility = () => { meterWrap.style.display = unit.value ? "block" : "none"; };
  updateMeterVisibility();
  unit.addEventListener("change", updateMeterVisibility);

  photoInput.addEventListener("change", async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    try {
      selectedPhoto = await compressAssetImage(file);
      photoPreview.innerHTML = `<img src="${selectedPhoto}" alt="Photo du bien">`;
    } catch (error) {
      console.error(error);
      alert("Impossible de traiter cette photo.");
    }
  });

  document.querySelector("#maintenance-asset-close").addEventListener("click", closeModal);
  document.querySelector("#maintenance-asset-cancel").addEventListener("click", closeModal);

  document.querySelector("#maintenance-asset-form").addEventListener("submit", async event => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const meterUnit = String(fd.get("meterUnit") || "");
    const model = String(fd.get("model") || "").trim();

    const saved = {
      ...(asset || {}),
      id: asset?.id || uid("maintenance_asset"),
      name: String(fd.get("name") || "").trim(),
      category: String(fd.get("category") || "").trim(),
      brand: String(fd.get("brand") || "").trim(),
      model,
      reference: model,
      serialNumber: String(fd.get("serialNumber") || "").trim(),
      purchaseYear: String(fd.get("purchaseYear") || ""),
      purchasePrice: Number(fd.get("purchasePrice") || 0),
      warrantyEnd: String(fd.get("warrantyEnd") || ""),
      purchasePlace: String(fd.get("purchasePlace") || "").trim(),
      condition: String(fd.get("condition") || ""),
      ownershipStatus: String(fd.get("ownershipStatus") || "active"),
      photo: selectedPhoto,
      meterUnit,
      currentMeter: meterUnit ? Number(fd.get("currentMeter") || 0) : 0,
      notes: String(fd.get("notes") || "").trim(),
      active: true,
      createdAt: asset?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await putOne("maintenanceAssets", saved);
    await syncMaintenanceTasks();
    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    currentAssetId = saved.id;
    currentView = "asset-detail";
    await renderCurrentView();
  });
}

async function showTransferToStockModal(asset) {
  const existing = (await getAll("products")).find(product => product.sourceAssetId === asset.id || String(product.id) === String(asset.stockProductId || ""));
  if (existing) {
    alert("Ce bien possède déjà une fiche dans Stock.");
    window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "stock" }));
    return;
  }

  openModal(`
    <div class="modal-head"><div><p class="eyebrow">ENTRETIEN → STOCK</p><h2>Passer ${escapeHtml(asset.name)} en vente</h2></div><button class="icon-btn" id="asset-stock-close">×</button></div>
    <form class="form-grid" id="asset-stock-form">
      <div class="maintenance-transfer-preview">
        ${asset.photo ? `<img src="${asset.photo}" alt="${escapeHtml(asset.name)}">` : `<div>${assetIcon(asset)}</div>`}
        <div><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml([asset.brand, asset.model || asset.reference].filter(Boolean).join(" · ") || asset.category || "Bien personnel")}</small></div>
      </div>
      <div class="row">
        <div class="field"><label>Prix d'achat repris</label><input value="${formatMoney(asset.purchasePrice || 0)}" disabled></div>
        <div class="field"><label>Prix de vente souhaité</label><input type="number" min="0" step="0.01" name="targetPrice" placeholder="0"></div>
      </div>
      <div class="field"><label>Description de vente</label><textarea name="description">${escapeHtml(assetDescriptionForStock(asset))}</textarea></div>
      <div class="actions"><button type="button" class="ghost-btn" id="asset-stock-cancel">Annuler</button><button type="submit" class="primary-btn">Créer la fiche Stock</button></div>
    </form>
  `);

  document.querySelector("#asset-stock-close").addEventListener("click", closeModal);
  document.querySelector("#asset-stock-cancel").addEventListener("click", closeModal);
  document.querySelector("#asset-stock-form").addEventListener("submit", async event => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const productId = uid("product");
    const product = {
      id: productId,
      name: asset.name,
      category: stockCategoryFromAsset(asset),
      purchasePrice: Number(asset.purchasePrice || 0),
      targetPrice: Number(fd.get("targetPrice") || 0),
      purchaseDate: purchaseDateFromAsset(asset),
      description: String(fd.get("description") || "").trim(),
      status: "sale",
      photo: asset.photo || null,
      salePrice: null,
      fees: 0,
      saleDate: null,
      source: "maintenance-asset",
      sourceAssetId: asset.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await putOne("products", product);
    await putOne("maintenanceAssets", {
      ...asset,
      ownershipStatus: "sale",
      stockProductId: productId,
      updatedAt: new Date().toISOString()
    });

    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrentView();
  });
}

async function showMeterModal(assetId) {
  const assets = await getAll("maintenanceAssets");
  const asset = assets.find(asset => asset.id === assetId);
  if (!asset) return;

  openModal(`
    <div class="modal-head">
      <div>
        <p class="eyebrow">COMPTEUR</p>
        <h2>${escapeHtml(asset.name)}</h2>
      </div>
      <button class="icon-btn" id="maintenance-meter-close">×</button>
    </div>

    <form class="form-grid" id="maintenance-meter-form">
      <div class="field">
        <label>Valeur actuelle (${escapeHtml(asset.meterUnit)})</label>
        <input type="number" name="currentMeter" min="0" step="1" value="${asset.currentMeter ?? 0}" required>
      </div>

      <div class="actions">
        <button type="button" class="ghost-btn" id="maintenance-meter-cancel">Annuler</button>
        <button class="primary-btn" type="submit">Mettre à jour</button>
      </div>
    </form>
  `);

  document.querySelector("#maintenance-meter-close").addEventListener("click", closeModal);
  document.querySelector("#maintenance-meter-cancel").addEventListener("click", closeModal);

  document.querySelector("#maintenance-meter-form").addEventListener("submit", async event => {
    event.preventDefault();
    const value = Number(new FormData(event.target).get("currentMeter") || 0);

    await putOne("maintenanceAssets", {
      ...asset,
      currentMeter: value,
      updatedAt: new Date().toISOString()
    });

    await syncMaintenanceTasks();

    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrentView();
  });
}


async function showManualMaintenanceEventModal(assetId) {
  const asset = await getOne("maintenanceAssets", assetId);
  if (!asset) {
    alert("Bien introuvable.");
    return;
  }

  openModal(`
    <div class="modal-head">
      <div>
        <p class="eyebrow">ENTRETIEN · ÉVÉNEMENT</p>
        <h2>Ajouter un événement</h2>
      </div>
      <button class="icon-btn" id="maintenance-event-close">×</button>
    </div>

    <form class="form-grid" id="maintenance-event-form">
      <div class="field">
        <label>Bien</label>
        <input value="${escapeHtml(asset.name)}" disabled>
      </div>

      <div class="field">
        <label>Événement réalisé</label>
        <input name="title" required maxlength="120" placeholder="Ex : Pression des pneus">
      </div>

      <div class="field">
        <label>Date</label>
        <input type="date" name="date" value="${todayISO()}" required>
      </div>

      ${asset.meterUnit ? `
        <div class="field">
          <label>Compteur (${escapeHtml(asset.meterUnit)})</label>
          <input type="number" name="meter" min="0" step="1" value="${asset.currentMeter ?? 0}">
        </div>
      ` : ""}

      <div class="field">
        <label>Coût (€)</label>
        <input type="number" name="cost" min="0" step="0.01" value="0" placeholder="0">
      </div>

      <div class="field">
        <label>Notes</label>
        <textarea name="notes" placeholder="Ex : pneus AV 2,4 bar · pneus AR 2,2 bar"></textarea>
      </div>

      <div class="actions">
        <button type="button" class="ghost-btn" id="maintenance-event-cancel">Annuler</button>
        <button class="primary-btn" type="submit">Ajouter à l'historique</button>
      </div>
    </form>
  `);

  document.querySelector("#maintenance-event-close").addEventListener("click", closeModal);
  document.querySelector("#maintenance-event-cancel").addEventListener("click", closeModal);

  document.querySelector("#maintenance-event-form").addEventListener("submit", async event => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const meterRaw = String(fd.get("meter") ?? "");

    const record = {
      id: uid("maintenance_record"),
      assetId: asset.id,
      planId: null,
      manual: true,
      title: String(fd.get("title") || "").trim(),
      date: String(fd.get("date") || todayISO()),
      meter: asset.meterUnit && meterRaw !== "" ? Number(meterRaw) : null,
      cost: Number(fd.get("cost") || 0),
      notes: String(fd.get("notes") || "").trim(),
      createdAt: new Date().toISOString()
    };

    await putOne("maintenanceRecords", record);

    if (
      asset.meterUnit &&
      Number.isFinite(record.meter) &&
      record.meter >= 0 &&
      record.meter !== Number(asset.currentMeter || 0)
    ) {
      await putOne("maintenanceAssets", {
        ...asset,
        currentMeter: record.meter,
        updatedAt: new Date().toISOString()
      });
      await syncMaintenanceTasks();
    }

    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    currentAssetId = asset.id;
    currentView = "asset-detail";
    await renderCurrentView();
  });
}

async function showPlanModal(presetAssetId = null, planId = null) {
  const [assets, plans] = await Promise.all([
    getAll("maintenanceAssets"),
    getAll("maintenancePlans")
  ]);

  const activeAssets = assets.filter(asset => asset.active !== false);
  const plan = plans.find(plan => plan.id === planId);
  const assetId = plan?.assetId || presetAssetId || activeAssets[0]?.id;

  if (!activeAssets.length) {
    alert("Ajoute d'abord un bien.");
    return;
  }

  const selectedAsset = activeAssets.find(asset => asset.id === assetId);
  const intervalType = Number(plan?.intervalMonths || 0) > 0
    ? "months"
    : Number(plan?.intervalDays || 0) > 0
      ? "days"
      : "none";
  const intervalValue = intervalType === "months"
    ? plan.intervalMonths
    : intervalType === "days"
      ? plan.intervalDays
      : "";

  openModal(`
    <div class="modal-head">
      <div>
        <p class="eyebrow">PLAN D'ENTRETIEN</p>
        <h2>${plan ? "Modifier" : "Nouvel"} entretien</h2>
      </div>
      <button class="icon-btn" id="maintenance-plan-close">×</button>
    </div>

    <form class="form-grid" id="maintenance-plan-form">
      <div class="field">
        <label>Bien</label>
        <select name="assetId" id="maintenance-plan-asset">
          ${activeAssets.map(asset => `<option value="${asset.id}" ${asset.id === assetId ? "selected" : ""}>${escapeHtml(asset.name)}</option>`).join("")}
        </select>
      </div>

      <div class="field">
        <label>Entretien</label>
        <input name="title" required maxlength="100" value="${escapeHtml(plan?.title || "")}" placeholder="Ex : Vidange moteur">
      </div>

      <div class="field">
        <label>Catégorie</label>
        <input name="category" maxlength="60" value="${escapeHtml(plan?.category || "")}" placeholder="Moteur, Sécurité, Nettoyage...">
      </div>

      <div class="field">
        <label>Prochaine date</label>
        <input type="date" name="nextDueDate" value="${plan?.nextDueDate || ""}">
      </div>

      <div class="row">
        <div class="field">
          <label>Répéter</label>
          <select name="intervalType">
            <option value="none" ${intervalType === "none" ? "selected" : ""}>Pas automatiquement</option>
            <option value="months" ${intervalType === "months" ? "selected" : ""}>Tous les X mois</option>
            <option value="days" ${intervalType === "days" ? "selected" : ""}>Tous les X jours</option>
          </select>
        </div>

        <div class="field">
          <label>Intervalle</label>
          <input type="number" name="intervalValue" min="1" step="1" value="${intervalValue}" placeholder="12">
        </div>
      </div>

      <div class="field">
        <label>Alerter X jours avant</label>
        <input type="number" name="warningDays" min="0" step="1" value="${plan?.warningDays ?? 30}">
      </div>

      <div id="maintenance-meter-plan-fields" style="${selectedAsset?.meterUnit ? "" : "display:none"}">
        <div class="field">
          <label>Prochain seuil compteur (<span id="maintenance-plan-unit-label">${escapeHtml(selectedAsset?.meterUnit || "")}</span>)</label>
          <input type="number" name="nextDueMeter" min="0" step="1" value="${plan?.nextDueMeter ?? ""}" placeholder="Ex : 75000">
        </div>

        <div class="row">
          <div class="field">
            <label>Répéter tous les X <span class="maintenance-plan-unit-copy">${escapeHtml(selectedAsset?.meterUnit || "")}</span></label>
            <input type="number" name="intervalMeter" min="0" step="1" value="${plan?.intervalMeter ?? ""}" placeholder="Ex : 15000">
          </div>

          <div class="field">
            <label>Alerter X <span class="maintenance-plan-unit-copy">${escapeHtml(selectedAsset?.meterUnit || "")}</span> avant</label>
            <input type="number" name="warningMeter" min="0" step="1" value="${plan?.warningMeter ?? 1000}">
          </div>
        </div>
      </div>

      <div class="field">
        <label>Notes</label>
        <textarea name="notes" placeholder="Référence pièce, huile, procédure...">${escapeHtml(plan?.notes || "")}</textarea>
      </div>

      <div class="actions">
        <button type="button" class="ghost-btn" id="maintenance-plan-cancel">Annuler</button>
        <button class="primary-btn" type="submit">Enregistrer</button>
      </div>

      ${plan ? `<button type="button" class="danger-btn" id="maintenance-plan-delete">Supprimer ce plan</button>` : ""}
    </form>
  `);

  const assetSelect = document.querySelector("#maintenance-plan-asset");
  const meterFields = document.querySelector("#maintenance-meter-plan-fields");
  const unitLabel = document.querySelector("#maintenance-plan-unit-label");

  const refreshMeterFields = () => {
    const selected = activeAssets.find(asset => asset.id === assetSelect.value);
    meterFields.style.display = selected?.meterUnit ? "block" : "none";
    unitLabel.textContent = selected?.meterUnit || "";
    document.querySelectorAll(".maintenance-plan-unit-copy").forEach(el => {
      el.textContent = selected?.meterUnit || "";
    });
  };

  assetSelect.addEventListener("change", refreshMeterFields);
  refreshMeterFields();

  document.querySelector("#maintenance-plan-close").addEventListener("click", closeModal);
  document.querySelector("#maintenance-plan-cancel").addEventListener("click", closeModal);

  document.querySelector("#maintenance-plan-form").addEventListener("submit", async event => {
    event.preventDefault();

    const fd = new FormData(event.target);
    const selected = activeAssets.find(asset => asset.id === fd.get("assetId"));
    const intervalTypeValue = String(fd.get("intervalType") || "none");
    const intervalNumber = Number(fd.get("intervalValue") || 0);
    const nextDueMeterRaw = String(fd.get("nextDueMeter") || "");
    const intervalMeterRaw = String(fd.get("intervalMeter") || "");

    const saved = {
      ...(plan || {}),
      id: plan?.id || uid("maintenance_plan"),
      assetId: String(fd.get("assetId")),
      title: String(fd.get("title") || "").trim(),
      category: String(fd.get("category") || "").trim(),
      nextDueDate: String(fd.get("nextDueDate") || ""),
      intervalMonths: intervalTypeValue === "months" ? intervalNumber : 0,
      intervalDays: intervalTypeValue === "days" ? intervalNumber : 0,
      nextDueMeter: selected?.meterUnit && nextDueMeterRaw !== "" ? Number(nextDueMeterRaw) : null,
      intervalMeter: selected?.meterUnit && intervalMeterRaw !== "" ? Number(intervalMeterRaw) : 0,
      warningDays: Number(fd.get("warningDays") || 0),
      warningMeter: selected?.meterUnit ? Number(fd.get("warningMeter") || 0) : 0,
      oneTimeDate: Boolean(String(fd.get("nextDueDate") || "")) && intervalTypeValue === "none",
      oneTimeMeter: Boolean(selected?.meterUnit && nextDueMeterRaw !== "") && Number(intervalMeterRaw || 0) <= 0,
      notes: String(fd.get("notes") || "").trim(),
      active: true,
      taskDismissedKey: plan?.taskDismissedKey || null,
      createdAt: plan?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await putOne("maintenancePlans", saved);
    await syncMaintenanceTasks();

    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));

    currentAssetId = saved.assetId;
    currentView = "asset-detail";
    await renderCurrentView();
  });

  const del = document.querySelector("#maintenance-plan-delete");
  if (del) {
    del.addEventListener("click", async () => {
      if (!confirm(`Supprimer le plan "${plan.title}" ? L'historique déjà enregistré sera conservé.`)) return;

      await deleteMaintenanceTasksForPlan(plan.id);
      await deleteOne("maintenancePlans", plan.id);

      closeModal();
      window.dispatchEvent(new CustomEvent("myhub:data-changed"));
      await renderCurrentView();
    });
  }
}

async function showCompleteModal(planId) {
  const data = await getData();
  const plan = data.plans.find(plan => plan.id === planId);
  const asset = data.assets.find(asset => asset.id === plan?.assetId);
  if (!plan || !asset) return;

  openModal(`
    <div class="modal-head">
      <div>
        <p class="eyebrow">ENTRETIEN TERMINÉ</p>
        <h2>${escapeHtml(plan.title)}</h2>
      </div>
      <button class="icon-btn" id="maintenance-complete-close">×</button>
    </div>

    <form class="form-grid" id="maintenance-complete-form">
      <div class="field">
        <label>Date</label>
        <input type="date" name="date" value="${todayISO()}" required>
      </div>

      ${
        asset.meterUnit
          ? `
            <div class="field">
              <label>Compteur (${escapeHtml(asset.meterUnit)})</label>
              <input type="number" name="meter" min="0" step="1" value="${asset.currentMeter ?? 0}">
            </div>
          `
          : ""
      }

      <div class="field">
        <label>Coût (€)</label>
        <input type="number" name="cost" min="0" step="0.01" placeholder="0">
      </div>

      <div class="field">
        <label>Notes</label>
        <textarea name="notes" placeholder="Pièces changées, garage, référence, remarques..."></textarea>
      </div>

      <div class="actions">
        <button type="button" class="ghost-btn" id="maintenance-complete-cancel">Annuler</button>
        <button class="primary-btn" type="submit">Valider l'entretien</button>
      </div>
    </form>
  `);

  document.querySelector("#maintenance-complete-close").addEventListener("click", closeModal);
  document.querySelector("#maintenance-complete-cancel").addEventListener("click", closeModal);

  document.querySelector("#maintenance-complete-form").addEventListener("submit", async event => {
    event.preventDefault();
    const fd = new FormData(event.target);

    await completeMaintenancePlan(plan.id, {
      date: String(fd.get("date") || todayISO()),
      meter: asset.meterUnit ? Number(fd.get("meter") || asset.currentMeter || 0) : null,
      cost: Number(fd.get("cost") || 0),
      notes: String(fd.get("notes") || "").trim()
    });

    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrentView();
  });
}

export async function getMaintenanceSummary() {
  await syncMaintenanceTasks();

  const data = await getData();
  const entries = nextPlans(data);

  const due = entries.filter(entry => entry.status.state === "due").length;
  const soon = entries.filter(entry => entry.status.state === "soon").length;
  const totalCost = data.records.reduce((sum, record) => sum + Number(record.cost || 0), 0);

  return {
    assets: data.assets.length,
    due,
    soon,
    plans: data.plans.length,
    totalCost
  };
}
