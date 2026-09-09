import { getAll, getOne, putOne, deleteOne } from "../core/db.js";
import { escapeHtml, uid, openModal, closeModal } from "../core/ui.js";

let filter = "todo";

const CATEGORIES = ["Fruits & légumes", "Viandes & poissons", "Frais", "Épicerie", "Boulangerie", "Surgelés", "Boissons", "Hygiène / entretien", "Autre"];

function formatQty(item) {
  const n = Number(item.quantity);
  const qty = Number.isFinite(n) && n !== 0 ? (Number.isInteger(n) ? String(n) : String(Math.round(n*100)/100).replace(".", ",")) : "";
  return [qty, item.unit].filter(Boolean).join(" ");
}

async function showShoppingItemModal(itemId = null, rerender = null) {
  const item = itemId ? await getOne("shoppingItems", itemId) : null;
  openModal(`
    <div class="modal-head"><div><p class="eyebrow">COURSES</p><h2>${item ? "Modifier l'article" : "Ajouter un article"}</h2></div><button class="icon-btn" id="shopping-modal-close">×</button></div>
    <form class="form-grid" id="shopping-item-form">
      <div class="field"><label>Article</label><input name="name" required value="${escapeHtml(item?.name || "")}" placeholder="Ex : Lait"></div>
      <div class="form-row-2">
        <div class="field"><label>Quantité</label><input name="quantity" type="number" step="0.01" min="0" value="${item?.quantity ?? 1}"></div>
        <div class="field"><label>Unité</label><input name="unit" value="${escapeHtml(item?.unit || "")}" placeholder="g, kg, L, pièce…"></div>
      </div>
      <div class="field"><label>Rayon</label><select name="category">${CATEGORIES.map(c => `<option ${item?.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      <div class="field"><label>Note</label><input name="note" value="${escapeHtml(item?.note || "")}" placeholder="Marque, précision…"></div>
      <div class="actions">${item ? `<button type="button" class="danger-btn" id="shopping-delete">Supprimer</button>` : ""}<button class="primary-btn" type="submit">Enregistrer</button></div>
    </form>
  `);
  document.getElementById("shopping-modal-close").addEventListener("click", closeModal);
  document.getElementById("shopping-item-form").addEventListener("submit", async event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const now = new Date().toISOString();
    await putOne("shoppingItems", {
      ...(item || {}),
      id: item?.id || uid("shopping"),
      name: String(fd.get("name") || "").trim(),
      quantity: Number(fd.get("quantity") || 0),
      unit: String(fd.get("unit") || "").trim(),
      category: String(fd.get("category") || "Autre"),
      note: String(fd.get("note") || "").trim(),
      checked: item?.checked || false,
      source: item?.source || "manual",
      createdAt: item?.createdAt || now,
      updatedAt: now
    });
    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    if (rerender) await rerender();
  });
  document.getElementById("shopping-delete")?.addEventListener("click", async () => {
    if (!confirm(`Supprimer « ${item.name} » ?`)) return;
    await deleteOne("shoppingItems", item.id);
    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    if (rerender) await rerender();
  });
}

export async function getShoppingSummary() {
  const rows = await getAll("shoppingItems");
  return {
    total: rows.length,
    todo: rows.filter(r => !r.checked).length,
    done: rows.filter(r => r.checked).length,
    generated: rows.filter(r => r.source === "meal-plan").length
  };
}

export async function renderShopping(container) {
  const rows = await getAll("shoppingItems");
  const summary = {
    total: rows.length,
    todo: rows.filter(r => !r.checked).length,
    done: rows.filter(r => r.checked).length
  };
  const visible = rows.filter(row => filter === "all" || (filter === "todo" ? !row.checked : row.checked));
  const grouped = CATEGORIES.map(category => [category, visible.filter(r => (r.category || "Autre") === category)]).filter(([,items]) => items.length);
  const progress = summary.total ? Math.round(summary.done / summary.total * 100) : 0;

  container.innerHTML = `
    <section class="shopping-shell">
      <section class="shopping-hero app-panel">
        <div><p class="eyebrow">COURSES</p><h2>${summary.todo ? `${summary.todo} article${summary.todo > 1 ? "s" : ""} à prendre` : "Liste terminée"}</h2><p>${summary.done} coché${summary.done > 1 ? "s" : ""} sur ${summary.total}</p></div>
        <div class="shopping-progress"><strong>${progress}%</strong><div><span style="width:${progress}%"></span></div></div>
      </section>
      <section class="shopping-toolbar app-panel">
        <div class="shopping-filters">
          <button class="${filter === "todo" ? "active" : ""}" data-shopping-filter="todo">À acheter</button>
          <button class="${filter === "done" ? "active" : ""}" data-shopping-filter="done">Pris</button>
          <button class="${filter === "all" ? "active" : ""}" data-shopping-filter="all">Tout</button>
        </div>
        <button class="primary-btn" id="shopping-add">+ Article</button>
      </section>
      <div class="shopping-list">
        ${grouped.map(([category, items]) => `
          <section class="shopping-category app-panel">
            <div class="section-head compact"><h3>${escapeHtml(category)}</h3><span class="app-badge">${items.length}</span></div>
            ${items.sort((a,b) => Number(a.checked)-Number(b.checked) || a.name.localeCompare(b.name,"fr")).map(item => `
              <article class="shopping-row ${item.checked ? "checked" : ""}">
                <button class="shopping-check" data-shopping-check="${item.id}" aria-label="Cocher">${item.checked ? "✓" : ""}</button>
                <button class="shopping-main" data-shopping-edit="${item.id}">
                  <strong>${escapeHtml(item.name)}</strong>
                  <small>${escapeHtml(formatQty(item))}${item.note ? ` · ${escapeHtml(item.note)}` : ""}${item.source === "meal-plan" ? " · Repas" : ""}</small>
                </button>
              </article>`).join("")}
          </section>`).join("") || `<section class="app-panel empty-state">${summary.total ? "Aucun article dans ce filtre." : "Ta liste de courses est vide."}</section>`}
      </div>
      ${summary.done ? `<section class="shopping-bottom-actions"><button class="ghost-btn" id="shopping-clear-done">Supprimer les articles pris</button>${summary.total ? `<button class="danger-btn" id="shopping-clear-all">Vider la liste</button>` : ""}</section>` : (summary.total ? `<section class="shopping-bottom-actions"><button class="danger-btn" id="shopping-clear-all">Vider la liste</button></section>` : "")}
    </section>
  `;

  const rerender = () => renderShopping(container);
  container.querySelector("#shopping-add").addEventListener("click", () => showShoppingItemModal(null, rerender));
  container.querySelectorAll("[data-shopping-filter]").forEach(btn => btn.addEventListener("click", async () => { filter = btn.dataset.shoppingFilter; await rerender(); }));
  container.querySelectorAll("[data-shopping-check]").forEach(btn => btn.addEventListener("click", async () => {
    const item = await getOne("shoppingItems", btn.dataset.shoppingCheck);
    if (!item) return;
    await putOne("shoppingItems", { ...item, checked: !item.checked, updatedAt: new Date().toISOString() });
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await rerender();
  }));
  container.querySelectorAll("[data-shopping-edit]").forEach(btn => btn.addEventListener("click", () => showShoppingItemModal(btn.dataset.shoppingEdit, rerender)));
  container.querySelector("#shopping-clear-done")?.addEventListener("click", async () => {
    for (const item of rows.filter(r => r.checked)) await deleteOne("shoppingItems", item.id);
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await rerender();
  });
  container.querySelector("#shopping-clear-all")?.addEventListener("click", async () => {
    if (!confirm("Vider toute la liste de courses ?")) return;
    for (const item of rows) await deleteOne("shoppingItems", item.id);
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await rerender();
  });
}

export function requestNewShoppingItem() {
  showShoppingItemModal(null, async () => window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "shopping" })));
}
