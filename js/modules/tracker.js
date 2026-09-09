import { getAll, getOne, putOne, deleteOne, replaceStore } from "../core/db.js";
import { escapeHtml, uid, openModal, closeModal, todayISO } from "../core/ui.js";
import {
  syncTrackerAutomations,
  trackerAutomationLabel,
  trackerItemScheduled,
  trackerThresholdResult
} from "../core/tracker_automation.js";

let currentView = "today";
let selectedDate = todayISO();
let statsPeriod = 30;
let heatmapMonth = todayISO().slice(0,7);
let lastContainer = null;
let todayFilter = "all";

const DAYS = [
  { id: 1, short: "Lun", name: "Lundi" },
  { id: 2, short: "Mar", name: "Mardi" },
  { id: 3, short: "Mer", name: "Mercredi" },
  { id: 4, short: "Jeu", name: "Jeudi" },
  { id: 5, short: "Ven", name: "Vendredi" },
  { id: 6, short: "Sam", name: "Samedi" },
  { id: 0, short: "Dim", name: "Dimanche" }
];

const TYPE_LABELS = {
  habit: "Oui / Non / N/A",
  rating: "Note /10",
  number: "Nombre",
  text: "Texte"
};

export async function renderTracker(container) {
  lastContainer = container;
  container.innerHTML = `<section class="tracker-shell" id="tracker-shell"></section>`;
  await syncTrackerAutomations(selectedDate);
  await renderCurrentView();
}

export function requestNewTrackerItem() {
  currentView = "settings";
  window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "tracker" }));
  setTimeout(() => showItemModal(), 120);
}

async function renderCurrentView() {
  if (!lastContainer) return;
  const shell = lastContainer.querySelector("#tracker-shell") || lastContainer;

  if (currentView === "history") return renderHistory(shell);
  if (currentView === "stats") return renderStats(shell);
  if (currentView === "settings") return renderSettings(shell);
  return renderToday(shell);
}

function tabs(active) {
  return `
    <div class="tracker-tabs">
      <button class="tracker-tab ${active==="today"?"active":""}" data-tracker-view="today">Aujourd'hui</button>
      <button class="tracker-tab ${active==="history"?"active":""}" data-tracker-view="history">Historique</button>
      <button class="tracker-tab ${active==="stats"?"active":""}" data-tracker-view="stats">Stats</button>
      <button class="tracker-tab ${active==="settings"?"active":""}" data-tracker-view="settings">Configuration</button>
    </div>`;
}

function bindTabs(shell) {
  shell.querySelectorAll("[data-tracker-view]").forEach(btn => {
    btn.addEventListener("click", async () => {
      currentView = btn.dataset.trackerView;
      await renderCurrentView();
    });
  });
}

async function getTrackerData() {
  const [categories, items, entries, goal] = await Promise.all([
    getAll("trackerCategories"),
    getAll("trackerItems"),
    getAll("trackerEntries"),
    getOne("settings", "tracker.dailyGoal")
  ]);

  return {
    categories: categories.filter(x => x.active !== false).sort((a,b)=>(a.order||0)-(b.order||0)),
    items: items.filter(x => x.active !== false).sort((a,b)=>(a.order||0)-(b.order||0)),
    entries,
    dailyGoal: Number(goal?.value ?? 75)
  };
}

function getDateEntries(entries, date) {
  const map = new Map();
  entries.filter(e => e.date === date).forEach(e => map.set(e.itemId, e));
  return map;
}

function itemResult(item, entry) {
  if (!entry) return null;

  if (item.type === "habit") {
    if (entry.value === "yes") return true;
    if (entry.value === "no") return false;
    return null;
  }

  return trackerThresholdResult(item, entry.value);
}

function scoreEligible(item, date, essentialOnly = false) {
  if (!trackerItemScheduled(item, date)) return false;
  if (essentialOnly && item.essential !== true) return false;

  if (item.type === "habit") return item.scoreIncluded !== false;
  return item.thresholdEnabled === true && item.scoreIncluded !== false;
}

function getScore(items, entriesMap, date, categoryId = null, essentialOnly = false) {
  const eligible = items.filter(item =>
    scoreEligible(item, date, essentialOnly) &&
    (!categoryId || item.categoryId === categoryId)
  );

  let yes = 0, no = 0, na = 0, unanswered = 0;

  eligible.forEach(item => {
    const entry = entriesMap.get(item.id);

    if (item.type === "habit" && entry?.value === "na") {
      na++;
      return;
    }

    const result = itemResult(item, entry);
    if (result === true) yes++;
    else if (result === false) no++;
    else unanswered++;
  });

  const counted = yes + no;

  return {
    score: counted ? Math.round((yes / counted) * 100) : null,
    yes, no, na, unanswered, total: eligible.length
  };
}

function formatDate(date) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  }).format(new Date(`${date}T12:00:00`));
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric", month: "short"
  }).format(new Date(`${date}T12:00:00`));
}

function shiftDate(date, days) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset*60000).toISOString().slice(0,10);
}

function mondayOf(date) {
  const d = new Date(`${date}T12:00:00`);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset*60000).toISOString().slice(0,10);
}

function scoreHero(score, essentialScore, goal) {
  const value = score.score;
  const progress = value ?? 0;
  const success = value !== null && value >= goal;

  return `
    <div class="tracker-score ${success?"good":""}">
      <span>Score du jour</span>
      <strong>${value===null?"— %":`${value} %`}</strong>
      <div class="tracker-progress"><i style="width:${progress}%"></i></div>
      <small>${value===null
        ? `Réponds aux habitudes prévues · Objectif ${goal} %`
        : `${score.yes} réussie${score.yes>1?"s":""} · ${score.no} non atteinte${score.no>1?"s":""} · Objectif ${goal} % ${success?"✓":""}`}
      </small>

      ${
        essentialScore.total
          ? `<div class="tracker-essential-summary"><span>⭐ Essentiel</span><strong>${essentialScore.score===null?"— %":`${essentialScore.score} %`}</strong><small>${essentialScore.yes}/${essentialScore.yes + essentialScore.no} essentiels validés</small></div>`
          : ""
      }
    </div>`;
}

function habitButtons(item, value, automated) {
  if (automated) {
    return `<div class="tracker-auto-value ${value==="yes"?"success":value==="no"?"danger":""}">${value==="yes"?"✓ Validé automatiquement":"✕ Non atteint automatiquement"}</div>`;
  }

  return `
    <div class="tracker-choice" data-habit="${item.id}">
      <button data-value="yes" class="${value==="yes"?"active-yes":""}">Oui</button>
      <button data-value="no" class="${value==="no"?"active-no":""}">Non</button>
      <button data-value="na" class="${value==="na"?"active-na":""}">N/A</button>
    </div>`;
}

function otherInput(item, entry) {
  const value = entry?.value ?? "";
  const automated = Boolean(item.automationMetric);
  const reached = trackerThresholdResult(item, value);

  if (automated) {
    return `
      <div class="tracker-auto-value ${reached===true?"success":reached===false?"danger":""}">
        ${value}${item.unit ? ` ${escapeHtml(item.unit)}` : ""}
        ${item.thresholdEnabled ? ` · ${reached ? "✓ seuil atteint" : "seuil non atteint"}` : ""}
      </div>`;
  }

  let input = "";
  if (item.type === "rating") {
    input = `<input data-tracker-input="${item.id}" type="number" min="${item.min ?? 0}" max="${item.max ?? 10}" step="${item.step ?? 1}" value="${value}" placeholder="0 à 10">`;
  } else if (item.type === "number") {
    input = `<input data-tracker-input="${item.id}" type="number" step="${item.step ?? 1}" value="${value}" placeholder="Valeur">`;
  } else {
    input = `<textarea data-tracker-input="${item.id}" placeholder="Note...">${escapeHtml(value)}</textarea>`;
  }

  return `
    <div class="tracker-value-row">${input}</div>
    ${item.thresholdEnabled && value !== "" ? `<div class="tracker-threshold-state ${reached ? "success" : "danger"}">${reached ? "✓ Objectif atteint" : "Objectif non atteint"}</div>` : ""}
  `;
}

function scheduleLabel(item) {
  const days = Array.isArray(item.activeDays) && item.activeDays.length ? item.activeDays.map(Number) : [0,1,2,3,4,5,6];
  if (days.length === 7) return "Tous les jours";
  return DAYS.filter(day => days.includes(day.id)).map(day => day.short).join(" · ");
}

function thresholdLabel(item) {
  if (!item.thresholdEnabled) return "";
  const op = item.comparator === "lte" ? "≤" : item.comparator === "lt" ? "<" : item.comparator === "gt" ? ">" : item.comparator === "eq" ? "=" : "≥";
  return `${op} ${item.threshold}${item.unit ? ` ${item.unit}` : ""}`;
}

async function saveEntry(date, itemId, value) {
  await putOne("trackerEntries", {
    id: `${date}__${itemId}`,
    date, itemId, value,
    updatedAt: new Date().toISOString()
  });
}

async function renderToday(shell) {
  let data = await getTrackerData();

  if (!data.categories.length || !data.items.length) {
    shell.innerHTML = `
      ${tabs("today")}
      <div class="tracker-empty">
        <h3>Tracker non configuré</h3>
        <p>Importe ton Tracker 2025 ou crée tes premières lignes directement dans MyHub.</p>
        <div class="tracker-import-box">
          <input id="tracker-empty-file" type="file" accept=".json,application/json" hidden>
          <button class="primary-btn" id="tracker-empty-import">Importer mon Tracker</button>
          <button class="ghost-btn" id="tracker-empty-config">Créer manuellement</button>
        </div>
      </div>`;
    bindTabs(shell);
    const input = shell.querySelector("#tracker-empty-file");
    shell.querySelector("#tracker-empty-import").addEventListener("click", ()=>input.click());
    input.addEventListener("change", ()=>importTrackerFile(input));
    shell.querySelector("#tracker-empty-config").addEventListener("click", async ()=>{
      currentView = "settings"; await renderCurrentView();
    });
    return;
  }

  await syncTrackerAutomations(selectedDate, data.items);
  data = await getTrackerData();

  const entriesMap = getDateEntries(data.entries, selectedDate);
  const totalScore = getScore(data.items, entriesMap, selectedDate);
  const essentialScore = getScore(data.items, entriesMap, selectedDate, null, true);

  shell.innerHTML = `
    ${tabs("today")}
    <div class="tracker-datebar">
      <button class="tracker-date-btn" id="tracker-prev">‹</button>
      <div class="tracker-date-main">
        <strong>${formatDate(selectedDate)}</strong>
        <button id="tracker-today">${selectedDate===todayISO()?"Aujourd'hui":"Revenir à aujourd'hui"}</button>
      </div>
      <button class="tracker-date-btn" id="tracker-next">›</button>
    </div>

    ${scoreHero(totalScore, essentialScore, data.dailyGoal)}

    <div class="tracker-focusbar">
      <button class="tracker-focus ${todayFilter==="all"?"active":""}" data-tracker-focus="all">Tout</button>
      <button class="tracker-focus ${todayFilter==="essential"?"active":""}" data-tracker-focus="essential">⭐ Essentiel</button>
      <button class="tracker-focus ${todayFilter==="todo"?"active":""}" data-tracker-focus="todo">À faire</button>
    </div>

    ${(() => {
      const frequency = weeklyFrequencyRows(data.items,data.entries).filter(row=>row.pct<100).slice(0,3);
      if (!frequency.length) return "";
      return `<section class="tracker-week-focus"><div><strong>Cette semaine</strong><small>Habitudes encore sous leur cible</small></div>${frequency.map(row=>`<span>${escapeHtml(row.item.name)} <b>${row.count}/${row.target}</b></span>`).join("")}</section>`;
    })()}

    <div>
      ${data.categories.map(category => {
        const categoryItems = data.items.filter(i => {
          if (i.categoryId !== category.id || !trackerItemScheduled(i, selectedDate)) return false;
          if (todayFilter === "essential" && i.essential !== true) return false;
          if (todayFilter === "todo") {
            const entry = entriesMap.get(i.id);
            const result = itemResult(i, entry);
            if (i.type === "habit" && entry?.value === "na") return false;
            return result !== true;
          }
          return true;
        });
        if (!categoryItems.length) return "";

        const cs = getScore(data.items, entriesMap, selectedDate, category.id);

        return `
          <section class="tracker-category">
            <div class="tracker-category-head">
              <h3>${escapeHtml(category.name)}</h3>
              <span>${cs.score===null?"—":`${cs.score} %`}</span>
            </div>

            ${categoryItems.map(item => {
              const entry = entriesMap.get(item.id);
              const value = entry?.value;
              const automated = Boolean(item.automationMetric);

              return `
                <article class="tracker-item ${item.essential ? "essential" : ""}">
                  <div class="tracker-item-name">
                    ${item.essential ? "⭐ " : ""}${escapeHtml(item.name)}
                    ${automated ? `<span class="tracker-auto-badge">AUTO</span>` : ""}
                  </div>
                  <div class="tracker-item-type">
                    ${TYPE_LABELS[item.type] || item.type}
                    ${item.weeklyTarget ? ` · cible ${item.weeklyTarget}×/sem.` : ""}
                    ${item.thresholdEnabled ? ` · ${thresholdLabel(item)}` : ""}
                  </div>
                  ${item.type==="habit" ? habitButtons(item,value,automated) : otherInput(item,entry)}
                  ${automated && entry?.autoValue !== undefined ? `<small class="tracker-auto-source">${escapeHtml(trackerAutomationLabel(item.automationMetric))} : ${entry.autoValue}${item.unit ? ` ${escapeHtml(item.unit)}` : ""}</small>` : ""}
                </article>`;
            }).join("")}
          </section>`;
      }).join("")}

      ${
        data.items.some(item => !trackerItemScheduled(item, selectedDate))
          ? `<div class="tracker-offday-note">Les habitudes non prévues aujourd'hui sont automatiquement exclues du score.</div>`
          : ""
      }
    </div>`;

  bindTabs(shell);
  shell.querySelectorAll("[data-tracker-focus]").forEach(btn=>btn.addEventListener("click",async()=>{
    todayFilter=btn.dataset.trackerFocus;
    await renderToday(shell);
  }));

  shell.querySelector("#tracker-prev").addEventListener("click", async()=>{selectedDate=shiftDate(selectedDate,-1); await renderToday(shell);});
  shell.querySelector("#tracker-next").addEventListener("click", async()=>{selectedDate=shiftDate(selectedDate,1); await renderToday(shell);});
  shell.querySelector("#tracker-today").addEventListener("click", async()=>{selectedDate=todayISO(); await renderToday(shell);});

  shell.querySelectorAll("[data-habit]").forEach(control => {
    const itemId = control.dataset.habit;
    control.querySelectorAll("[data-value]").forEach(btn => {
      btn.addEventListener("click", async()=>{
        await saveEntry(selectedDate,itemId,btn.dataset.value);
        window.dispatchEvent(new CustomEvent("myhub:data-changed"));
        await renderToday(shell);
      });
    });
  });

  shell.querySelectorAll("[data-tracker-input]").forEach(input => {
    input.addEventListener("change", async()=>{
      const itemId = input.dataset.trackerInput;
      const item = data.items.find(i=>i.id===itemId);

      if (input.value === "") {
        await deleteOne("trackerEntries", `${selectedDate}__${itemId}`);
      } else {
        const value = ["number","rating"].includes(item?.type) ? Number(input.value) : input.value;
        await saveEntry(selectedDate,itemId,value);
      }

      window.dispatchEvent(new CustomEvent("myhub:data-changed"));
      await renderToday(shell);
    });
  });
}

async function renderHistory(shell) {
  const data = await getTrackerData();
  const dates = [...new Set(data.entries.map(e=>e.date))].sort((a,b)=>b.localeCompare(a));

  shell.innerHTML = `
    ${tabs("history")}
    <div class="section">
      <div class="section-head"><div><h2>Historique</h2><p class="muted" style="margin:4px 0 0">${dates.length} journée${dates.length>1?"s":""} enregistrée${dates.length>1?"s":""}</p></div></div>
      <div class="tracker-history-list">
        ${dates.length ? dates.map(date=>{
          const score = getScore(data.items,getDateEntries(data.entries,date),date);
          const essential = getScore(data.items,getDateEntries(data.entries,date),date,null,true);

          return `<article class="tracker-history-row" data-date="${date}">
            <div>
              <strong>${formatDate(date)}</strong>
              <small>${score.yes} réussie${score.yes>1?"s":""} · ${score.no} non atteinte${score.no>1?"s":""}${essential.total ? ` · ⭐ ${essential.score ?? "—"} %` : ""}</small>
            </div>
            <div class="tracker-history-score">${score.score===null?"—":`${score.score} %`}</div>
          </article>`;
        }).join("") : `<div class="tracker-empty"><h3>Aucun historique</h3><p>Les journées remplies apparaîtront ici.</p></div>`}
      </div>
    </div>`;

  bindTabs(shell);
  shell.querySelectorAll("[data-date]").forEach(row=>row.addEventListener("click",async()=>{
    selectedDate=row.dataset.date; currentView="today"; await renderCurrentView();
  }));
}

function cutoff(days) {
  if (days === "all") return null;
  const d = new Date();
  d.setDate(d.getDate()-Number(days)+1);
  const offset=d.getTimezoneOffset();
  return new Date(d.getTime()-offset*60000).toISOString().slice(0,10);
}

function aggregate(items, entries, categoryId=null) {
  const relevantItems = items.filter(item =>
    item.scoreIncluded !== false &&
    (item.type === "habit" || item.thresholdEnabled === true) &&
    (!categoryId || item.categoryId === categoryId)
  );

  const itemMap = new Map(relevantItems.map(item => [item.id,item]));
  let yes=0,no=0;

  entries.forEach(entry=>{
    const item = itemMap.get(entry.itemId);
    if (!item || !trackerItemScheduled(item, entry.date)) return;

    if (item.type === "habit" && entry.value === "na") return;
    const result = itemResult(item, entry);
    if (result === true) yes++;
    if (result === false) no++;
  });

  return {yes,no,score:(yes+no)?Math.round(yes/(yes+no)*100):null};
}

function weekDates(anchor = todayISO()) {
  const start = mondayOf(anchor);
  return Array.from({length:7},(_,i)=>shiftDate(start,i));
}

function weeklyFrequencyRows(items, entries) {
  const dates = weekDates();
  const start = dates[0];
  const end = dates[6];

  return items
    .filter(item => Number(item.weeklyTarget || 0) > 0 && (item.type === "habit" || item.thresholdEnabled))
    .map(item => {
      const successfulDates = new Set(
        entries
          .filter(entry =>
            entry.itemId === item.id &&
            entry.date >= start &&
            entry.date <= end &&
            trackerItemScheduled(item, entry.date) &&
            itemResult(item, entry) === true
          )
          .map(entry => entry.date)
      );

      const target = Number(item.weeklyTarget || 0);
      return {
        item,
        count: successfulDates.size,
        target,
        pct: target ? Math.min(100, Math.round((successfulDates.size / target) * 100)) : 0
      };
    });
}

function monthBounds(monthKey) {
  const [year,month] = monthKey.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2,"0")}-01`;
  const last = new Date(year, month, 0).getDate();
  return { start, end:`${year}-${String(month).padStart(2,"0")}-${String(last).padStart(2,"0")}`, days:last };
}

function heatmapHtml(data) {
  const bounds = monthBounds(heatmapMonth);
  const [year,month] = heatmapMonth.split("-").map(Number);
  const firstDowRaw = new Date(year, month-1, 1, 12).getDay();
  const firstDow = firstDowRaw === 0 ? 6 : firstDowRaw - 1;
  const cells = Array.from({length:firstDow},()=>`<div class="tracker-heat-cell empty"></div>`);

  for (let day=1; day<=bounds.days; day++) {
    const date = `${heatmapMonth}-${String(day).padStart(2,"0")}`;
    const score = getScore(data.items,getDateEntries(data.entries,date),date).score;
    const level = score === null ? "none" : score >= 90 ? "l4" : score >= 75 ? "l3" : score >= 50 ? "l2" : "l1";
    cells.push(`<button class="tracker-heat-cell ${level}" data-heat-date="${date}" title="${score===null?"Aucune donnée":`${score} %`}"><span>${day}</span><small>${score===null?"":score}</small></button>`);
  }

  const label = new Intl.DateTimeFormat("fr-FR",{month:"long",year:"numeric"}).format(new Date(year,month-1,1));

  return `
    <section class="tracker-heatmap-card">
      <div class="tracker-heat-head">
        <button class="icon-btn" id="tracker-heat-prev">‹</button>
        <div><strong>${escapeHtml(label)}</strong><small>Score quotidien</small></div>
        <button class="icon-btn" id="tracker-heat-next">›</button>
      </div>
      <div class="tracker-heat-days">${["L","M","M","J","V","S","D"].map(day=>`<span>${day}</span>`).join("")}</div>
      <div class="tracker-heat-grid">${cells.join("")}</div>
      <div class="tracker-heat-legend"><span>Faible</span><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>Excellent</span></div>
    </section>`;
}

function shiftMonth(key, delta) {
  const [year,month] = key.split("-").map(Number);
  const d = new Date(year, month-1+delta, 1, 12);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}

async function renderStats(shell) {
  const data=await getTrackerData();
  const limit=cutoff(statsPeriod);
  const entries=limit?data.entries.filter(e=>e.date>=limit):data.entries;
  const total=aggregate(data.items,entries);
  const frequency = weeklyFrequencyRows(data.items,data.entries);
  let previous = null;
  if (statsPeriod !== "all") {
    const n = Number(statsPeriod);
    const currentStart = shiftDate(todayISO(), -(n-1));
    const previousEnd = shiftDate(currentStart, -1);
    const previousStart = shiftDate(previousEnd, -(n-1));
    previous = aggregate(data.items, data.entries.filter(e=>e.date>=previousStart&&e.date<=previousEnd));
  }
  const scoreDelta = previous?.score !== null && previous?.score !== undefined && total.score !== null
    ? total.score - previous.score
    : null;

  shell.innerHTML=`
    ${tabs("stats")}
    <div class="section">
      <div class="section-head"><div><h2>Statistiques</h2><p class="muted" style="margin:4px 0 0">Les jours non programmés sont exclus du calcul.</p></div></div>

      <div class="tracker-periods">
        ${[7,30,90].map(n=>`<button class="tracker-period ${statsPeriod===n?"active":""}" data-period="${n}">${n} jours</button>`).join("")}
        <button class="tracker-period ${statsPeriod==="all"?"active":""}" data-period="all">Tout</button>
      </div>

      <div class="tracker-score ${total.score!==null && total.score>=data.dailyGoal?"good":""}" style="margin-top:14px">
        <span>Réussite globale</span><strong>${total.score===null?"— %":`${total.score} %`}</strong>
        <div class="tracker-progress"><i style="width:${total.score ?? 0}%"></i></div>
        <small>${total.yes} réussites · ${total.no} objectifs non atteints${scoreDelta===null?"":` · ${scoreDelta>=0?"+":""}${scoreDelta} pts vs période précédente`}</small>
      </div>

      ${heatmapHtml(data)}

      <section class="tracker-stats-block">
        <div class="section-head"><div><h2>Fréquence cette semaine</h2><p class="muted" style="margin:4px 0 0">Comparaison avec la cible hebdomadaire de chaque habitude.</p></div></div>
        <div class="tracker-frequency-list">
          ${frequency.length ? frequency.map(row=>`
            <article class="tracker-frequency-row">
              <div><strong>${row.item.essential?"⭐ ":""}${escapeHtml(row.item.name)}</strong><small>${row.count}/${row.target} réussite${row.target>1?"s":""}</small></div>
              <div class="tracker-frequency-score">${row.pct}%</div>
              <div class="tracker-stat-bar"><i style="width:${row.pct}%"></i></div>
            </article>
          `).join("") : `<div class="tracker-empty"><h3>Aucune cible hebdomadaire</h3><p>Configure une fréquence sur une ligne pour la suivre ici.</p></div>`}
        </div>
      </section>

      <div class="tracker-stats-list">
        ${data.categories.map(cat=>{
          const stat=aggregate(data.items,entries,cat.id);
          return `<article class="tracker-stat-row">
            <strong>${escapeHtml(cat.name)}</strong><span>${stat.score===null?"—":`${stat.score} %`}</span>
            <div class="tracker-stat-bar"><i style="width:${stat.score ?? 0}%"></i></div>
          </article>`;
        }).join("")}
      </div>
    </div>`;

  bindTabs(shell);

  shell.querySelectorAll("[data-period]").forEach(btn=>btn.addEventListener("click",async()=>{
    statsPeriod=btn.dataset.period==="all"?"all":Number(btn.dataset.period); await renderStats(shell);
  }));

  shell.querySelector("#tracker-heat-prev").addEventListener("click",async()=>{heatmapMonth=shiftMonth(heatmapMonth,-1);await renderStats(shell);});
  shell.querySelector("#tracker-heat-next").addEventListener("click",async()=>{heatmapMonth=shiftMonth(heatmapMonth,1);await renderStats(shell);});
  shell.querySelectorAll("[data-heat-date]").forEach(btn=>btn.addEventListener("click",async()=>{
    selectedDate=btn.dataset.heatDate;currentView="today";await renderCurrentView();
  }));
}

async function renderSettings(shell) {
  const data=await getTrackerData();

  shell.innerHTML=`
    ${tabs("settings")}

    <div class="tracker-settings-card">
      <strong>Objectif journalier</strong>
      <p>Pourcentage minimum de réussite parmi les habitudes réellement prévues ce jour.</p>
      <div class="tracker-goal-row">
        <input id="tracker-goal" type="number" min="0" max="100" step="1" value="${data.dailyGoal}">
        <span>%</span><button class="primary-btn" id="tracker-goal-save">Enregistrer</button>
      </div>
    </div>

    <div class="tracker-settings-card">
      <strong>Tracker intelligent</strong>
      <p>Une ligne peut maintenant avoir des jours actifs, une cible hebdomadaire, un seuil automatique, le statut ⭐ Essentiel et une source automatique MyHub.</p>
    </div>

    <div class="tracker-settings-card">
      <strong>Importer ton Tracker 2025</strong>
      <p>L'import reste local sur ton appareil. Les anciennes lignes restent compatibles.</p>
      <input id="tracker-import-file" type="file" accept=".json,application/json" hidden>
      <button class="ghost-btn" id="tracker-import">Importer un fichier Tracker</button>
    </div>

    <div class="section">
      <div class="section-head">
        <div><h2>Structure</h2><p class="muted" style="margin:4px 0 0">${data.categories.length} thématique${data.categories.length>1?"s":""} · ${data.items.length} ligne${data.items.length>1?"s":""}</p></div>
        <button class="primary-btn" id="tracker-add-category">+ Thématique</button>
      </div>

      <div class="tracker-config-list">
        ${data.categories.map(cat=>{
          const catItems=data.items.filter(i=>i.categoryId===cat.id);
          return `<section class="tracker-config-card" data-category="${cat.id}">
            <div class="tracker-config-head">
              <div><h3>${escapeHtml(cat.name)}</h3><p>${catItems.length} ligne${catItems.length>1?"s":""}</p></div>
              <button class="ghost-btn" data-edit-category="${cat.id}">Modifier</button>
            </div>

            ${catItems.map(item=>`
              <div class="list-item" style="margin-top:8px">
                <div class="task-main">
                  <div class="task-title">${item.essential?"⭐ ":""}${escapeHtml(item.name)}${item.automationMetric?` <span class="tracker-auto-badge">AUTO</span>`:""}</div>
                  <div class="task-meta">
                    ${TYPE_LABELS[item.type] || item.type}
                    · ${scheduleLabel(item)}
                    ${item.weeklyTarget ? ` · ${item.weeklyTarget}×/sem.` : ""}
                    ${item.thresholdEnabled ? ` · seuil ${thresholdLabel(item)}` : ""}
                  </div>
                </div>
                <button class="icon-btn" data-edit-item="${item.id}" aria-label="Modifier">✎</button>
                <button class="icon-btn" data-delete-item="${item.id}" aria-label="Supprimer">×</button>
              </div>`).join("")}

            <div class="tracker-config-actions">
              <button class="ghost-btn" data-add-item="${cat.id}">+ Ajouter une ligne</button>
            </div>
          </section>`;
        }).join("") || `<div class="tracker-empty"><h3>Aucune thématique</h3><p>Crée ta première thématique.</p></div>`}
      </div>
    </div>`;

  bindTabs(shell);

  shell.querySelector("#tracker-goal-save").addEventListener("click", async()=>{
    const value=Math.max(0,Math.min(100,Number(shell.querySelector("#tracker-goal").value||75)));
    await putOne("settings",{key:"tracker.dailyGoal",value});
    alert("Objectif enregistré.");
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
  });

  const importInput=shell.querySelector("#tracker-import-file");
  shell.querySelector("#tracker-import").addEventListener("click",()=>importInput.click());
  importInput.addEventListener("change",()=>importTrackerFile(importInput));

  shell.querySelector("#tracker-add-category").addEventListener("click",()=>showCategoryModal());
  shell.querySelectorAll("[data-edit-category]").forEach(btn=>btn.addEventListener("click",()=>showCategoryModal(btn.dataset.editCategory)));
  shell.querySelectorAll("[data-add-item]").forEach(btn=>btn.addEventListener("click",()=>showItemModal(null,btn.dataset.addItem)));
  shell.querySelectorAll("[data-edit-item]").forEach(btn=>btn.addEventListener("click",()=>showItemModal(btn.dataset.editItem)));

  shell.querySelectorAll("[data-delete-item]").forEach(btn=>btn.addEventListener("click",async()=>{
    const id=btn.dataset.deleteItem;
    const item=data.items.find(i=>i.id===id);
    if (!item || !confirm(`Supprimer "${item.name}" ? L'historique lié à cette ligne sera également supprimé.`)) return;
    await deleteOne("trackerItems",id);
    for (const entry of data.entries.filter(e=>e.itemId===id)) await deleteOne("trackerEntries",entry.id);
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderSettings(shell);
  }));
}

async function showCategoryModal(categoryId=null) {
  const categories=await getAll("trackerCategories");
  const category=categories.find(c=>c.id===categoryId);

  openModal(`
    <div class="modal-head"><div><p class="eyebrow">TRACKER</p><h2>${category?"Modifier":"Nouvelle"} thématique</h2></div><button class="icon-btn" id="tracker-modal-close">×</button></div>
    <form class="form-grid" id="tracker-category-form">
      <div class="field"><label>Nom</label><input name="name" required maxlength="80" value="${escapeHtml(category?.name||"")}" placeholder="Ex : MORNING ROUTINE"></div>
      <div class="actions"><button type="button" class="ghost-btn" id="tracker-category-cancel">Annuler</button><button class="primary-btn" type="submit">Enregistrer</button></div>
      ${category?`<button type="button" class="danger-btn" id="tracker-delete-category">Supprimer la thématique</button>`:""}
    </form>`);

  document.querySelector("#tracker-modal-close").addEventListener("click",closeModal);
  document.querySelector("#tracker-category-cancel").addEventListener("click",closeModal);

  document.querySelector("#tracker-category-form").addEventListener("submit",async e=>{
    e.preventDefault();
    const name=new FormData(e.target).get("name").trim();
    await putOne("trackerCategories",{
      ...(category||{}),
      id:category?.id||uid("tracker_cat"),
      name,
      order:category?.order ?? (categories.length+1),
      active:true,
      createdAt:category?.createdAt||new Date().toISOString()
    });
    closeModal(); await renderCurrentView();
  });

  const del=document.querySelector("#tracker-delete-category");
  if (del) del.addEventListener("click",async()=>{
    const items=await getAll("trackerItems");
    const linked=items.filter(i=>i.categoryId===category.id);
    if (!confirm(`Supprimer "${category.name}" et ses ${linked.length} ligne(s) ?`)) return;
    const entries=await getAll("trackerEntries");
    for (const item of linked) {
      await deleteOne("trackerItems",item.id);
      for (const entry of entries.filter(e=>e.itemId===item.id)) await deleteOne("trackerEntries",entry.id);
    }
    await deleteOne("trackerCategories",category.id);
    closeModal(); window.dispatchEvent(new CustomEvent("myhub:data-changed")); await renderCurrentView();
  });
}

async function showItemModal(itemId=null, presetCategoryId=null) {
  const [items,categories]=await Promise.all([getAll("trackerItems"),getAll("trackerCategories")]);
  const item=items.find(i=>i.id===itemId);
  const categoryId=item?.categoryId||presetCategoryId||categories[0]?.id||"";
  const activeDays = Array.isArray(item?.activeDays) && item.activeDays.length ? item.activeDays.map(Number) : [0,1,2,3,4,5,6];

  if (!categories.length) {
    alert("Crée d'abord une thématique.");
    return;
  }

  openModal(`
    <div class="modal-head"><div><p class="eyebrow">TRACKER</p><h2>${item?"Modifier":"Nouvelle"} ligne</h2></div><button class="icon-btn" id="tracker-item-close">×</button></div>

    <form class="form-grid" id="tracker-item-form">
      <div class="field"><label>Nom</label><input name="name" required maxlength="100" value="${escapeHtml(item?.name||"")}" placeholder="Ex : Lire 15 min"></div>

      <div class="field"><label>Thématique</label><select name="categoryId">${categories.sort((a,b)=>(a.order||0)-(b.order||0)).map(c=>`<option value="${c.id}" ${c.id===categoryId?"selected":""}>${escapeHtml(c.name)}</option>`).join("")}</select></div>

      <div class="field"><label>Type</label><select name="type" id="tracker-item-type">
        <option value="habit" ${(item?.type||"habit")==="habit"?"selected":""}>Oui / Non / N/A</option>
        <option value="rating" ${item?.type==="rating"?"selected":""}>Note /10</option>
        <option value="number" ${item?.type==="number"?"selected":""}>Nombre</option>
        <option value="text" ${item?.type==="text"?"selected":""}>Texte</option>
      </select></div>

      <label class="tracker-option-card">
        <input type="checkbox" name="essential" ${item?.essential?"checked":""}>
        <span><strong>⭐ Habitude essentielle</strong><small>Entre dans le score « Essentiel » affiché séparément du score global.</small></span>
      </label>

      <div class="field">
        <label>Jours actifs</label>
        <div class="tracker-day-picker">
          ${DAYS.map(day=>`<label><input type="checkbox" name="activeDay" value="${day.id}" ${activeDays.includes(day.id)?"checked":""}><span>${day.short}</span></label>`).join("")}
        </div>
        <small class="muted">Les autres jours, cette ligne disparaît du tableau et ne pénalise pas le score.</small>
      </div>

      <div class="field">
        <label>Fréquence cible par semaine</label>
        <input type="number" name="weeklyTarget" min="0" max="7" step="1" value="${item?.weeklyTarget ?? ""}" placeholder="Ex : 4">
        <small class="muted">Facultatif. Permet de suivre 4/4, 3/5, etc. dans les statistiques.</small>
      </div>

      <div class="tracker-config-subcard" id="tracker-threshold-card">
        <label class="tracker-option-card">
          <input type="checkbox" name="thresholdEnabled" id="tracker-threshold-enabled" ${item?.thresholdEnabled?"checked":""}>
          <span><strong>Seuil automatique</strong><small>Une valeur peut valider automatiquement l'objectif, ex. eau ≥ 2 L, lecture ≥ 15 min.</small></span>
        </label>

        <div class="tracker-threshold-fields" id="tracker-threshold-fields">
          <div class="row">
            <div class="field">
              <label>Condition</label>
              <select name="comparator">
                <option value="gte" ${(item?.comparator||"gte")==="gte"?"selected":""}>≥ au moins</option>
                <option value="lte" ${item?.comparator==="lte"?"selected":""}>≤ au maximum</option>
                <option value="gt" ${item?.comparator==="gt"?"selected":""}>> supérieur à</option>
                <option value="lt" ${item?.comparator==="lt"?"selected":""}>< inférieur à</option>
                <option value="eq" ${item?.comparator==="eq"?"selected":""}>= égal à</option>
              </select>
            </div>
            <div class="field">
              <label>Seuil</label>
              <input type="number" name="threshold" step="0.01" value="${item?.threshold ?? ""}" placeholder="Ex : 15">
            </div>
          </div>
          <div class="field"><label>Unité</label><input name="unit" maxlength="20" value="${escapeHtml(item?.unit||"")}" placeholder="min, L, pas, h..."></div>
        </div>
      </div>

      <div class="tracker-config-subcard">
        <div class="field">
          <label>Alimentation automatique</label>
          <select name="automationMetric" id="tracker-automation-metric">
            <option value="">Aucune — saisie manuelle</option>
            <option value="sport_minutes" ${item?.automationMetric==="sport_minutes"?"selected":""}>🏋️ Sport · minutes réalisées</option>
            <option value="sport_sessions" ${item?.automationMetric==="sport_sessions"?"selected":""}>🏋️ Sport · nombre de séances</option>
            <option value="learning_minutes" ${item?.automationMetric==="learning_minutes"?"selected":""}>🧠 Apprentissage · minutes réalisées</option>
            <option value="tasks_completed" ${item?.automationMetric==="tasks_completed"?"selected":""}>✓ Tâches · nombre terminées</option>
            <option value="tasks_due_completion_pct" ${item?.automationMetric==="tasks_due_completion_pct"?"selected":""}>✓ Tâches · % des échéances du jour terminées</option>
          </select>
          <small class="muted">La valeur sera récupérée automatiquement depuis le module correspondant.</small>
        </div>
      </div>

      <div class="actions"><button type="button" class="ghost-btn" id="tracker-item-cancel">Annuler</button><button class="primary-btn" type="submit">Enregistrer</button></div>
    </form>`);

  const typeSelect = document.querySelector("#tracker-item-type");
  const thresholdEnabled = document.querySelector("#tracker-threshold-enabled");
  const thresholdFields = document.querySelector("#tracker-threshold-fields");

  function refreshThreshold() {
    const compatible = ["number","rating","habit"].includes(typeSelect.value);
    document.querySelector("#tracker-threshold-card").style.display = compatible ? "block" : "none";
    thresholdFields.style.display = compatible && thresholdEnabled.checked ? "block" : "none";
  }

  refreshThreshold();
  typeSelect.addEventListener("change", refreshThreshold);
  thresholdEnabled.addEventListener("change", refreshThreshold);

  document.querySelector("#tracker-item-close").addEventListener("click",closeModal);
  document.querySelector("#tracker-item-cancel").addEventListener("click",closeModal);

  document.querySelector("#tracker-item-form").addEventListener("submit",async e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const type=String(fd.get("type") || "habit");
    const days = fd.getAll("activeDay").map(Number);

    if (!days.length) {
      alert("Choisis au moins un jour actif.");
      return;
    }

    const automationMetric = String(fd.get("automationMetric") || "");
    const thresholdOn = fd.get("thresholdEnabled") === "on";

    if (automationMetric && !thresholdOn && type === "habit") {
      alert("Pour une habitude alimentée automatiquement, active un seuil afin que MyHub sache quand la valider.");
      return;
    }

    const saved={
      ...(item||{}),
      id:item?.id||uid("tracker_item"),
      name:String(fd.get("name") || "").trim(),
      categoryId:String(fd.get("categoryId") || ""),
      type,
      scoreIncluded:type==="habit" || thresholdOn,
      essential:fd.get("essential")==="on",
      activeDays:days,
      weeklyTarget:Math.max(0,Math.min(7,Number(fd.get("weeklyTarget") || 0))),
      thresholdEnabled:thresholdOn,
      comparator:String(fd.get("comparator") || "gte"),
      threshold:thresholdOn ? Number(fd.get("threshold") || 0) : null,
      unit:String(fd.get("unit") || "").trim(),
      automationMetric:automationMetric || null,
      order:item?.order ?? (items.length+1),
      active:true,
      createdAt:item?.createdAt||new Date().toISOString(),
      updatedAt:new Date().toISOString()
    };

    if (type==="rating") Object.assign(saved,{min:0,max:10,step:1});
    if (type==="number") Object.assign(saved,{step:1});
    if (type==="text") {
      saved.scoreIncluded=false;
      saved.thresholdEnabled=false;
      saved.automationMetric=null;
    }

    await putOne("trackerItems",saved);

    if (saved.automationMetric) {
      await syncTrackerAutomations(todayISO(), [saved]);
    }

    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrentView();
  });
}

async function importTrackerFile(input) {
  const file=input.files?.[0];
  if (!file) return;

  try {
    const data=JSON.parse(await file.text());
    if (data?.app!=="MyHub Tracker Import" || !Array.isArray(data.categories) || !Array.isArray(data.items) || !Array.isArray(data.entries)) {
      throw new Error("Fichier Tracker MyHub invalide.");
    }

    if (!confirm(`Importer ${data.items.length} ligne(s) et ${data.entries.length} entrée(s) historiques ? Le Tracker actuel sera remplacé.`)) {
      input.value=""; return;
    }

    const upgradedItems = data.items.map(item => ({
      ...item,
      activeDays: Array.isArray(item.activeDays) && item.activeDays.length ? item.activeDays : [0,1,2,3,4,5,6],
      weeklyTarget: Number(item.weeklyTarget || 0),
      essential: item.essential === true,
      thresholdEnabled: item.thresholdEnabled === true,
      automationMetric: item.automationMetric || null
    }));

    await replaceStore("trackerCategories",data.categories);
    await replaceStore("trackerItems",upgradedItems);
    await replaceStore("trackerEntries",data.entries);
    await putOne("settings",{key:"tracker.dailyGoal",value:Number(data.settings?.dailyGoal ?? 75)});

    input.value="";
    alert("Tracker importé avec succès.");
    selectedDate=todayISO();
    currentView="today";
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrentView();
  } catch(err) {
    console.error(err);
    alert(err?.message || "Impossible d'importer ce Tracker.");
    input.value="";
  }
}

export async function syncTrackerForToday() {
  const data = await getTrackerData();
  if (!data.items.length) return;
  await syncTrackerAutomations(todayISO(), data.items);
}

export async function getTrackerSummary() {
  const data=await getTrackerData();
  if (!data.items.length) return {configured:false,score:null,goal:data.dailyGoal,yes:0,no:0,na:0,essentialScore:null};

  await syncTrackerAutomations(todayISO(), data.items);
  const refreshed = await getTrackerData();
  const entriesMap = getDateEntries(refreshed.entries,todayISO());
  const score=getScore(refreshed.items,entriesMap,todayISO());
  const essential=getScore(refreshed.items,entriesMap,todayISO(),null,true);

  return {
    configured:true,
    goal:refreshed.dailyGoal,
    ...score,
    essentialScore:essential.score,
    essentialTotal:essential.total,
    essentialUnanswered: essential.unanswered,
    unanswered: score.unanswered
  };
}
