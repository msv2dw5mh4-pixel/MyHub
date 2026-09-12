import { getAll, getOne, putOne, deleteOne } from "../core/db.js";
import { DEFAULT_MEALS } from "../core/meal_seed.js";
import { escapeHtml, openModal, closeModal, uid, todayISO } from "../core/ui.js";

let currentTab = "week";
let weekOffset = 0;
let libraryFilter = "Tous";
let libraryQuery = "";

const MEAL_TYPES = [
  { id: "lunch", label: "Midi" },
  { id: "dinner", label: "Soir" }
];

function normalize(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function localISO(date) {
  const d = new Date(date);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function mondayOf(date = new Date()) {
  const d = new Date(date);
  d.setHours(12,0,0,0);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d;
}

function currentWeekStart() {
  const d = mondayOf(new Date());
  d.setDate(d.getDate() + weekOffset * 7);
  return d;
}

function weekDays(start) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function weekKey(start) {
  return localISO(start);
}

function formatDay(date) {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" }).format(date);
}

function formatWeekRange(start) {
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const f = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
  return `${f.format(start)} → ${f.format(end)}`;
}

function formatQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100).replace(".", ",");
}

export async function ensureMealsSeeded() {
  const marker = await getOne("settings", "meals.seed.v28").catch(() => null);
  if (marker?.value) return;

  const existing = await getAll("meals");
  if (!existing.length) {
    const now = new Date().toISOString();
    for (const meal of DEFAULT_MEALS) {
      await putOne("meals", { ...structuredClone(meal), createdAt: now, updatedAt: now });
    }
  }
  await putOne("settings", { key: "meals.seed.v28", value: true, at: new Date().toISOString() });
}

function ingredientText(meal) {
  return (meal.ingredients || []).map(i => {
    const qty = i.quantity ?? "";
    return `${i.name} | ${qty} | ${i.unit || ""} | ${i.category || "Épicerie"}`;
  }).join("\n");
}

function parseIngredients(text = "") {
  return String(text)
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [nameRaw, qtyRaw, unitRaw, categoryRaw] = line.split("|").map(v => (v || "").trim());
      const parsed = Number(String(qtyRaw || "").replace(",", "."));
      return {
        name: nameRaw,
        quantity: Number.isFinite(parsed) ? parsed : 0,
        unit: unitRaw || "",
        category: categoryRaw || "Épicerie"
      };
    })
    .filter(item => item.name);
}

async function mealMap() {
  await ensureMealsSeeded();
  const meals = await getAll("meals");
  return new Map(meals.filter(m => m.active !== false).map(m => [m.id, m]));
}

async function savePlan(date, type, mealId) {
  const id = `mealplan_${date}_${type}`;
  if (!mealId) {
    await deleteOne("mealPlans", id).catch(() => {});
  } else {
    await putOne("mealPlans", {
      id,
      date,
      type,
      mealId,
      updatedAt: new Date().toISOString()
    });
  }
  window.dispatchEvent(new CustomEvent("myhub:data-changed"));
}

async function showMealModal(mealId = null, rerender = null) {
  await ensureMealsSeeded();
  const meal = mealId ? await getOne("meals", mealId) : null;
  const editing = Boolean(meal);

  openModal(`
    <div class="modal-head">
      <div>
        <p class="eyebrow">REPAS</p>
        <h2>${editing ? "Modifier le repas" : "Ajouter un repas"}</h2>
      </div>
      <button class="icon-btn" id="meal-modal-close">×</button>
    </div>
    <form id="meal-form" class="form-grid meal-form">
      <div class="field">
        <label>Nom</label>
        <input name="name" required value="${escapeHtml(meal?.name || "")}" placeholder="Ex : Poulet curry coco">
      </div>
      <div class="form-row-2">
        <div class="field">
          <label>Cuisine</label>
          <select name="cuisine">
            ${["Italien","Asiatique","Classique","Autre"].map(v => `<option ${meal?.cuisine === v ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Portions</label>
          <input name="servings" type="number" min="1" step="1" value="${meal?.servings || 2}">
        </div>
      </div>
      <div class="form-row-2">
        <div class="field">
          <label>Temps (min)</label>
          <input name="prepMinutes" type="number" min="0" step="5" value="${meal?.prepMinutes || 30}">
        </div>
        <div class="field">
          <label>Tags</label>
          <input name="tags" value="${escapeHtml((meal?.tags || []).join(", "))}" placeholder="Poulet, Pâtes, Rapide">
        </div>
      </div>
      <div class="field">
        <label>Ingrédients</label>
        <textarea name="ingredients" rows="10" required placeholder="Poulet | 300 | g | Viandes & poissons\nRiz | 180 | g | Épicerie">${escapeHtml(ingredientText(meal || {}))}</textarea>
        <small class="muted">Une ligne par ingrédient : nom | quantité | unité | rayon.</small>
      </div>
      <div class="field">
        <label>Notes / recette</label>
        <textarea name="notes" rows="4" placeholder="Préparation, cuisson, variante…">${escapeHtml(meal?.notes || "")}</textarea>
      </div>
      <label class="meal-favorite-toggle"><input type="checkbox" name="favorite" ${meal?.favorite ? "checked" : ""}> ★ Favori</label>
      <div class="actions">
        ${editing && meal?.seedKey ? `<button type="button" class="ghost-btn" id="meal-reset">Réinitialiser</button>` : ""}
        ${editing ? `<button type="button" class="danger-btn" id="meal-delete">Supprimer</button>` : ""}
        <button type="submit" class="primary-btn">Enregistrer</button>
      </div>
    </form>
  `);

  document.getElementById("meal-modal-close").addEventListener("click", closeModal);

  document.getElementById("meal-form").addEventListener("submit", async event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const now = new Date().toISOString();
    const row = {
      ...(meal || {}),
      id: meal?.id || uid("meal"),
      name: String(fd.get("name") || "").trim(),
      cuisine: String(fd.get("cuisine") || "Classique"),
      servings: Math.max(1, Number(fd.get("servings") || 2)),
      prepMinutes: Math.max(0, Number(fd.get("prepMinutes") || 0)),
      tags: String(fd.get("tags") || "").split(",").map(v => v.trim()).filter(Boolean),
      ingredients: parseIngredients(fd.get("ingredients")),
      notes: String(fd.get("notes") || "").trim(),
      favorite: fd.get("favorite") === "on",
      active: true,
      seeded: meal?.seeded || false,
      seedKey: meal?.seedKey || null,
      createdAt: meal?.createdAt || now,
      updatedAt: now
    };
    await putOne("meals", row);
    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    if (rerender) await rerender();
  });

  if (editing) {
    document.getElementById("meal-delete")?.addEventListener("click", async () => {
      if (!confirm(`Supprimer « ${meal.name} » de la bibliothèque ?`)) return;
      await deleteOne("meals", meal.id);
      const plans = await getAll("mealPlans");
      for (const plan of plans.filter(p => p.mealId === meal.id)) await deleteOne("mealPlans", plan.id);
      closeModal();
      window.dispatchEvent(new CustomEvent("myhub:data-changed"));
      if (rerender) await rerender();
    });

    document.getElementById("meal-reset")?.addEventListener("click", async () => {
      const original = DEFAULT_MEALS.find(m => m.seedKey === meal.seedKey);
      if (!original) return;
      if (!confirm("Revenir à la recette d'origine ?")) return;
      await putOne("meals", {
        ...structuredClone(original),
        favorite: meal.favorite || false,
        createdAt: meal.createdAt,
        updatedAt: new Date().toISOString()
      });
      closeModal();
      window.dispatchEvent(new CustomEvent("myhub:data-changed"));
      if (rerender) await rerender();
    });
  }
}

function aggregateIngredients(plans, meals) {
  const agg = new Map();
  for (const plan of plans) {
    const meal = meals.get(plan.mealId);
    if (!meal) continue;
    for (const ingredient of meal.ingredients || []) {
      const key = `${normalize(ingredient.name)}|${normalize(ingredient.unit)}|${normalize(ingredient.category)}`;
      if (!agg.has(key)) {
        agg.set(key, {
          name: ingredient.name,
          quantity: 0,
          unit: ingredient.unit || "",
          category: ingredient.category || "Épicerie",
          mealNames: new Set()
        });
      }
      const row = agg.get(key);
      row.quantity += Number(ingredient.quantity) || 0;
      row.mealNames.add(meal.name);
    }
  }
  return [...agg.values()];
}

export async function generateShoppingFromCurrentWeek() {
  await ensureMealsSeeded();
  const start = currentWeekStart();
  const startISO = localISO(start);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const endISO = localISO(end);
  const [plans, mealsRows, existing] = await Promise.all([getAll("mealPlans"), getAll("meals"), getAll("shoppingItems")]);
  const weekPlans = plans.filter(p => p.date >= startISO && p.date <= endISO);
  if (!weekPlans.length) return { added: 0, empty: true };

  const meals = new Map(mealsRows.map(m => [m.id, m]));
  const ingredients = aggregateIngredients(weekPlans, meals);
  const wk = weekKey(start);
  const oldGenerated = existing.filter(i => i.source === "meal-plan" && i.weekKey === wk);
  const oldState = new Map(oldGenerated.map(i => [`${normalize(i.name)}|${normalize(i.unit)}|${normalize(i.category)}`, i.checked]));
  for (const row of oldGenerated) await deleteOne("shoppingItems", row.id);

  const now = new Date().toISOString();
  for (const ingredient of ingredients) {
    const key = `${normalize(ingredient.name)}|${normalize(ingredient.unit)}|${normalize(ingredient.category)}`;
    await putOne("shoppingItems", {
      id: uid("shopping"),
      name: ingredient.name,
      quantity: Math.round(ingredient.quantity * 100) / 100,
      unit: ingredient.unit,
      category: ingredient.category,
      checked: oldState.get(key) || false,
      source: "meal-plan",
      weekKey: wk,
      note: [...ingredient.mealNames].slice(0, 3).join(" · "),
      createdAt: now,
      updatedAt: now
    });
  }
  window.dispatchEvent(new CustomEvent("myhub:data-changed"));
  return { added: ingredients.length, empty: false };
}

async function renderWeek(container, rerenderRoot) {
  const start = currentWeekStart();
  const days = weekDays(start);
  const [mealsRows, plans] = await Promise.all([getAll("meals"), getAll("mealPlans")]);
  const meals = mealsRows.filter(m => m.active !== false).sort((a,b) => a.name.localeCompare(b.name, "fr"));
  const planMap = new Map(plans.map(p => [p.id, p]));
  const today = todayISO();
  const plannedCount = days.reduce((count, date) => {
    const iso = localISO(date);
    return count + MEAL_TYPES.filter(type => planMap.get(`mealplan_${iso}_${type.id}`)?.mealId).length;
  }, 0);
  const todayDate = days.find(date => localISO(date) === today);
  const todayMeals = todayDate ? MEAL_TYPES.map(type => {
    const plan = planMap.get(`mealplan_${today}_${type.id}`);
    return { type, meal: plan ? meals.find(m => m.id === plan.mealId) : null };
  }) : [];

  container.innerHTML = `
    <section class="meal-week-nav">
      <button class="meal-nav-btn" id="meal-prev-week" aria-label="Semaine précédente">‹</button>
      <div class="meal-week-title"><span>${weekOffset === 0 ? "Cette semaine" : "Semaine"}</span><strong>${formatWeekRange(start)}</strong></div>
      <button class="meal-nav-btn" id="meal-next-week" aria-label="Semaine suivante">›</button>
      ${weekOffset !== 0 ? `<button class="meal-today-link" id="meal-current-week">Revenir à aujourd'hui</button>` : ""}
    </section>
    ${todayDate ? `<section class="meal-today-card">
      <div class="meal-today-head"><div><span class="meal-today-kicker">Aujourd'hui</span><strong>${formatDay(todayDate)}</strong></div><span class="meal-plan-counter">${plannedCount}/14 planifiés</span></div>
      <div class="meal-today-grid">${todayMeals.map(({type,meal}) => `<div class="meal-today-slot ${meal ? "filled" : ""}"><span>${type.label}</span><strong>${meal ? escapeHtml(meal.name) : "À choisir"}</strong></div>`).join("")}</div>
    </section>` : ""}
    <section class="meal-week-list meal-week-list-v29">
      ${days.map(date => {
        const iso = localISO(date), isToday = iso === today;
        const dayName = new Intl.DateTimeFormat("fr-FR", {weekday:"short"}).format(date).replace(".","");
        const dayNumber = new Intl.DateTimeFormat("fr-FR", {day:"2-digit"}).format(date);
        const month = new Intl.DateTimeFormat("fr-FR", {month:"short"}).format(date).replace(".","");
        return `<article class="meal-day-row ${isToday ? "today" : ""}">
          <div class="meal-day-date"><span>${escapeHtml(dayName)}</span><strong>${escapeHtml(dayNumber)}</strong><small>${escapeHtml(month)}</small></div>
          <div class="meal-day-slots">${MEAL_TYPES.map(type => {
            const id=`mealplan_${iso}_${type.id}`, selected=planMap.get(id)?.mealId||"", selectedMeal=selected?meals.find(m=>m.id===selected):null;
            return `<label class="meal-slot-v29 ${selectedMeal ? "filled" : ""}"><span>${type.label}</span><select data-meal-plan data-date="${iso}" data-type="${type.id}" aria-label="${type.label} ${formatDay(date)}"><option value="">— Libre —</option>${meals.map(m=>`<option value="${m.id}" ${m.id===selected?"selected":""}>${escapeHtml(m.name)}</option>`).join("")}</select><span class="meal-slot-chevron">⌄</span></label>`;
          }).join("")}</div>
        </article>`;
      }).join("")}
    </section>
    <section class="meal-generate meal-generate-v29"><div class="meal-generate-icon">🛒</div><div class="meal-generate-copy"><strong>Transformer la semaine en courses</strong><p>Les ingrédients des repas planifiés sont regroupés automatiquement.</p></div><button class="primary-btn" id="meal-generate-shopping">Générer</button></section>`;

  container.querySelector("#meal-prev-week").addEventListener("click", async()=>{weekOffset--;await rerenderRoot();});
  container.querySelector("#meal-next-week").addEventListener("click", async()=>{weekOffset++;await rerenderRoot();});
  container.querySelector("#meal-current-week")?.addEventListener("click", async()=>{weekOffset=0;await rerenderRoot();});
  container.querySelectorAll("[data-meal-plan]").forEach(select=>select.addEventListener("change",async()=>{await savePlan(select.dataset.date,select.dataset.type,select.value);await rerenderRoot();}));
  container.querySelector("#meal-generate-shopping").addEventListener("click",async()=>{const result=await generateShoppingFromCurrentWeek();if(result.empty)return alert("Planifie au moins un repas cette semaine avant de générer les courses.");alert(`${result.added} article${result.added>1?"s":""} ajouté${result.added>1?"s":""} aux courses.`);window.dispatchEvent(new CustomEvent("myhub:navigate",{detail:"shopping"}));});
}

async function renderLibrary(container) {
  const meals = (await getAll("meals")).filter(m => m.active !== false);
  const filters = ["Tous","Italien","Asiatique","Classique","Poulet","Steak haché","Crevettes","Pâtes","Rapide","Favoris"];
  const q=normalize(libraryQuery);
  const filtered=meals.filter(meal=>{const allText=normalize([meal.name,meal.cuisine,...(meal.tags||[]),...(meal.ingredients||[]).map(i=>i.name),meal.notes].join(" "));if(q&&!allText.includes(q))return false;if(libraryFilter==="Tous")return true;if(libraryFilter==="Favoris")return Boolean(meal.favorite);return meal.cuisine===libraryFilter||(meal.tags||[]).includes(libraryFilter);}).sort((a,b)=>Number(b.favorite)-Number(a.favorite)||a.name.localeCompare(b.name,"fr"));
  container.innerHTML=`<section class="meal-library-head"><div class="meal-library-searchbox"><span>⌕</span><input id="meal-library-search" type="search" value="${escapeHtml(libraryQuery)}" placeholder="Plat, ingrédient, envie…"></div><button class="primary-btn meal-add-btn" id="meal-add">+ Nouveau</button></section>
  <div class="meal-filter-row meal-filter-row-v29">${filters.map(f=>`<button class="meal-filter ${libraryFilter===f?"active":""}" data-meal-filter="${f}">${f}</button>`).join("")}</div>
  <div class="meal-library-count"><strong>${filtered.length}</strong> repas ${libraryFilter!=="Tous"||libraryQuery?`<span>sur ${meals.length}</span>`:`<span>dans ta bibliothèque</span>`}</div>
  <section class="meal-grid meal-grid-v29">${filtered.map(meal=>{const n=(meal.ingredients||[]).length,tags=(meal.tags||[]).slice(0,2),initial=String(meal.name||"?").trim().charAt(0).toUpperCase();return `<article class="meal-card-v29" data-meal-id="${meal.id}"><div class="meal-card-accent">${escapeHtml(initial)}</div><div class="meal-card-body"><div class="meal-card-topline"><span class="meal-cuisine-v29">${escapeHtml(meal.cuisine||"Classique")}</span><button class="meal-star ${meal.favorite?"active":""}" data-meal-star="${meal.id}" aria-label="Favori">★</button></div><h3>${escapeHtml(meal.name)}</h3><div class="meal-card-meta"><span>◷ ${meal.prepMinutes||0} min</span><span>• ${n} ingr.</span><span>• ${meal.servings||2} pers.</span></div>${tags.length?`<div class="meal-tags">${tags.map(tag=>`<span>${escapeHtml(tag)}</span>`).join("")}</div>`:""}<button class="meal-card-edit-link" data-meal-edit="${meal.id}">Modifier</button></div></article>`;}).join("")||`<div class="meal-empty-v29"><strong>Aucun repas trouvé</strong><span>Essaie un autre filtre ou une autre recherche.</span></div>`}</section>`;
  const rerender=()=>renderLibrary(container);
  container.querySelector("#meal-add").addEventListener("click",()=>showMealModal(null,rerender));
  container.querySelector("#meal-library-search").addEventListener("input",event=>{libraryQuery=event.target.value;clearTimeout(event.target._timer);event.target._timer=setTimeout(rerender,150);});
  container.querySelectorAll("[data-meal-filter]").forEach(btn=>btn.addEventListener("click",async()=>{libraryFilter=btn.dataset.mealFilter;await rerender();}));
  container.querySelectorAll("[data-meal-edit]").forEach(btn=>btn.addEventListener("click",event=>{event.stopPropagation();showMealModal(btn.dataset.mealEdit,rerender);}));
  container.querySelectorAll("[data-meal-star]").forEach(btn=>btn.addEventListener("click",async event=>{event.stopPropagation();const meal=await getOne("meals",btn.dataset.mealStar);if(!meal)return;await putOne("meals",{...meal,favorite:!meal.favorite,updatedAt:new Date().toISOString()});await rerender();}));
}

export async function getMealsSummary() {
  await ensureMealsSeeded();
  const today = todayISO();
  const start = mondayOf(new Date());
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const [meals, plans] = await Promise.all([getAll("meals"), getAll("mealPlans")]);
  const activeMeals = meals.filter(m => m.active !== false);
  const thisWeek = plans.filter(p => p.date >= localISO(start) && p.date <= localISO(end));
  const todayPlans = plans.filter(p => p.date === today);
  return {
    library: activeMeals.length,
    favorites: activeMeals.filter(m => m.favorite).length,
    plannedWeek: thisWeek.length,
    today: todayPlans.length
  };
}

export async function renderMeals(container) {
  await ensureMealsSeeded();
  const summary=await getMealsSummary();
  container.innerHTML=`<section class="meals-shell meals-shell-v29"><header class="meals-top-v29"><div><p class="eyebrow">REPAS</p><h2>${currentTab==="week"?"Ma semaine":"Mes repas"}</h2><p>${currentTab==="week"?`${summary.plannedWeek} repas planifié${summary.plannedWeek>1?"s":""} · ${14-Math.min(summary.plannedWeek,14)} créneaux libres`:`${summary.library} recettes · ${summary.favorites} favori${summary.favorites>1?"s":""}`}</p></div><div class="meal-top-mini-stat"><strong>${summary.today}</strong><span>aujourd'hui</span></div></header><nav class="meal-tabs meal-tabs-v29"><button class="${currentTab==="week"?"active":""}" data-meal-tab="week"><span>▦</span> Semaine</button><button class="${currentTab==="library"?"active":""}" data-meal-tab="library"><span>⌕</span> Bibliothèque</button></nav><div id="meal-tab-content"></div></section>`;
  container.querySelectorAll("[data-meal-tab]").forEach(btn=>btn.addEventListener("click",async()=>{currentTab=btn.dataset.mealTab;await renderMeals(container);}));
  const target=container.querySelector("#meal-tab-content");if(currentTab==="library")await renderLibrary(target);else await renderWeek(target,()=>renderMeals(container));
}

export function requestNewMeal() {
  showMealModal(null, async () => window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "meals" })));
}
