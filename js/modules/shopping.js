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
  const rows=await getAll("shoppingItems");
  const summary={total:rows.length,todo:rows.filter(r=>!r.checked).length,done:rows.filter(r=>r.checked).length};
  const visible=rows.filter(row=>filter==="all"||(filter==="todo"?!row.checked:row.checked));
  const grouped=CATEGORIES.map(category=>[category,visible.filter(r=>(r.category||"Autre")===category)]).filter(([,items])=>items.length);
  const progress=summary.total?Math.round(summary.done/summary.total*100):0;
  const generatedCount=rows.filter(r=>r.source==="meal-plan").length;
  container.innerHTML=`<section class="shopping-shell shopping-shell-v29"><header class="shopping-top-v29"><div><p class="eyebrow">COURSES</p><h2>${summary.todo?`${summary.todo} à acheter`:summary.total?"Tout est pris":"Liste vide"}</h2><p>${generatedCount?`${generatedCount} article${generatedCount>1?"s":""} viennent des repas`:"Ajoute tes articles ou génère-les depuis Repas"}</p></div><button class="primary-btn shopping-add-top" id="shopping-add">+ Article</button></header>${summary.total?`<section class="shopping-progress-card"><div class="shopping-progress-copy"><strong>${summary.done}/${summary.total}</strong><span>articles pris</span></div><div class="shopping-progress-v29"><span style="width:${progress}%"></span></div><strong class="shopping-progress-percent">${progress}%</strong></section>`:""}<nav class="shopping-filters shopping-filters-v29"><button class="${filter==="todo"?"active":""}" data-shopping-filter="todo">À acheter <span>${summary.todo}</span></button><button class="${filter==="done"?"active":""}" data-shopping-filter="done">Pris <span>${summary.done}</span></button><button class="${filter==="all"?"active":""}" data-shopping-filter="all">Tout <span>${summary.total}</span></button></nav><div class="shopping-list shopping-list-v29">${grouped.map(([category,items])=>`<section class="shopping-category-v29"><div class="shopping-category-head"><h3>${escapeHtml(category)}</h3><span>${items.length}</span></div><div class="shopping-category-items">${items.sort((a,b)=>Number(a.checked)-Number(b.checked)||a.name.localeCompare(b.name,"fr")).map(item=>`<article class="shopping-row-v29 ${item.checked?"checked":""}"><button class="shopping-check-v29" data-shopping-check="${item.id}" aria-label="${item.checked?"Décocher":"Cocher"}">${item.checked?"✓":""}</button><button class="shopping-main-v29" data-shopping-edit="${item.id}"><span class="shopping-item-line"><strong>${escapeHtml(item.name)}</strong>${item.source==="meal-plan"?`<em>Repas</em>`:""}</span><small>${escapeHtml(formatQty(item)||"1")}${item.note?`<span> · ${escapeHtml(item.note)}</span>`:""}</small></button><button class="shopping-edit-icon" data-shopping-edit="${item.id}" aria-label="Modifier">›</button></article>`).join("")}</div></section>`).join("")||`<section class="shopping-empty-v29"><div>${filter==="done"?"✓":"🛒"}</div><strong>${summary.total?"Rien dans cette vue":"Ta liste est prête"}</strong><span>${summary.total?"Change de filtre pour voir les autres articles.":"Ajoute un article ou génère ta liste depuis le module Repas."}</span>${!summary.total?`<button class="primary-btn" id="shopping-empty-add">Ajouter un article</button>`:""}</section>`}</div>${summary.total?`<section class="shopping-actions-v29">${summary.done?`<button class="ghost-btn" id="shopping-clear-done">Nettoyer les articles pris</button>`:""}<button class="shopping-danger-link" id="shopping-clear-all">Vider la liste</button></section>`:""}</section>`;
  const rerender=()=>renderShopping(container);
  container.querySelector("#shopping-add")?.addEventListener("click",()=>showShoppingItemModal(null,rerender));
  container.querySelector("#shopping-empty-add")?.addEventListener("click",()=>showShoppingItemModal(null,rerender));
  container.querySelectorAll("[data-shopping-filter]").forEach(btn=>btn.addEventListener("click",async()=>{filter=btn.dataset.shoppingFilter;await rerender();}));
  container.querySelectorAll("[data-shopping-check]").forEach(btn=>btn.addEventListener("click",async()=>{const item=await getOne("shoppingItems",btn.dataset.shoppingCheck);if(!item)return;await putOne("shoppingItems",{...item,checked:!item.checked,updatedAt:new Date().toISOString()});window.dispatchEvent(new CustomEvent("myhub:data-changed"));await rerender();}));
  container.querySelectorAll("[data-shopping-edit]").forEach(btn=>btn.addEventListener("click",()=>showShoppingItemModal(btn.dataset.shoppingEdit,rerender)));
  container.querySelector("#shopping-clear-done")?.addEventListener("click",async()=>{for(const item of rows.filter(r=>r.checked))await deleteOne("shoppingItems",item.id);window.dispatchEvent(new CustomEvent("myhub:data-changed"));await rerender();});
  container.querySelector("#shopping-clear-all")?.addEventListener("click",async()=>{if(!confirm("Vider toute la liste de courses ?"))return;for(const item of rows)await deleteOne("shoppingItems",item.id);window.dispatchEvent(new CustomEvent("myhub:data-changed"));await rerender();});
}

export function requestNewShoppingItem() {
  showShoppingItemModal(null, async () => window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "shopping" })));
}
