import { getAll } from "../core/db.js";
import { escapeHtml } from "../core/ui.js";

let query = "";
let lastContainer = null;

const SOURCES = [
  { store:"tasks", route:"tasks", icon:"✓", type:"Tâche", title:["title"], detail:["description","folder"] },
  { store:"maintenanceAssets", route:"maintenance", icon:"🔧", type:"Bien", title:["name"], detail:["brand","model","serialNumber","purchasePlace","notes"] },
  { store:"products", route:"stock", icon:"📦", type:"Stock", title:["name","title"], detail:["description","category","notes"] },
  { store:"documents", route:"documents", icon:"📂", type:"Document", title:["title","name"], detail:["category","reference","notes"] },
  { store:"projects", route:"projects", icon:"🏠", type:"Projet", title:["title","name"], detail:["description","notes","status"] },
  { store:"objectives", route:"objectives", icon:"🎯", type:"Objectif", title:["title","name"], detail:["description","notes"] },
  { store:"ideas", route:"ideas", icon:"💡", type:"Idée", title:["title","name","text"], detail:["description","notes","status"] },
  { store:"learningTopics", route:"learning", icon:"🧠", type:"Apprentissage", title:["name","title"], detail:["description","notes","category"] },
  { store:"livingAquariums", route:"living", icon:"🐠", type:"Aquarium", title:["name"], detail:["type","plantsText","notes"] },
  { store:"livingPlants", route:"living", icon:"🌿", type:"Plante", title:["name","species"], detail:["location","lightNeed","notes"] },
  { store:"livingSpecies", route:"living", icon:"🐟", type:"Population", title:["name"], detail:["notes"] },
  { store:"sportGoals", route:"sport", icon:"🏅", type:"Objectif sport", title:["name","title","sport","exerciseName"], detail:["notes"] },
  { store:"sportPrograms", route:"sport", icon:"🏋️", type:"Programme sport", title:["name","title"], detail:["description","notes"] },
  { store:"calendarEvents", route:"planning", icon:"📅", type:"Événement", title:["title","name"], detail:["description","location","notes"] },
  { store:"trackerItems", route:"tracker", icon:"✅", type:"Tracker", title:["name"], detail:["unit","automationMetric"] },
  { store:"meals", route:"meals", icon:"🍽️", type:"Repas", title:["name"], detail:["cuisine","notes"] },
  { store:"shoppingItems", route:"shopping", icon:"🛒", type:"Course", title:["name"], detail:["category","note","unit"] }
];

function normalize(value="") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .trim();
}

function firstValue(row, keys=[]) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && String(row[key]).trim()) return String(row[key]).trim();
  }
  return "";
}

function searchableText(row) {
  const values = [];
  const collect = value => {
    if (value === null || value === undefined) return;
    if (["string","number","boolean"].includes(typeof value)) { values.push(String(value)); return; }
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (typeof value === "object") {
      Object.entries(value).forEach(([key, nested]) => {
        if (["photo","fileData","content","dataUrl"].includes(key)) return;
        collect(nested);
      });
    }
  };
  Object.entries(row || {}).forEach(([key,value]) => {
    if (["photo","fileData","content","dataUrl"].includes(key)) return;
    collect(value);
  });
  return normalize(values.join(" "));
}

async function searchAll(term) {
  const needle = normalize(term);
  if (needle.length < 2) return [];

  const results = [];
  const datasets = await Promise.all(SOURCES.map(async source => {
    try { return [source, await getAll(source.store)]; }
    catch { return [source, []]; }
  }));

  for (const [source, rows] of datasets) {
    for (const row of rows) {
      if (row?.active === false) continue;
      const haystack = searchableText(row);
      if (!haystack.includes(needle)) continue;

      const title = firstValue(row, source.title) || source.type;
      const detail = source.detail.map(key => row?.[key]).filter(Boolean).join(" · ");

      let score = 1;
      if (normalize(title).startsWith(needle)) score += 4;
      else if (normalize(title).includes(needle)) score += 2;

      results.push({
        id: row.id,
        route: source.route,
        icon: source.icon,
        type: source.type,
        title,
        detail,
        score
      });
    }
  }


  try {
    const [people, groups, relations, events] = await Promise.all([
      getAll("people"),
      getAll("peopleGroups"),
      getAll("peopleRelations"),
      getAll("peopleEvents")
    ]);
    const groupMap = new Map(groups.map(group => [group.id, group]));
    const peopleMap = new Map(people.map(person => [person.id, person]));
    const nameOf = person => [person?.firstName, person?.lastName].filter(Boolean).join(" ").trim() || person?.nickname || "Sans nom";

    for (const person of people.filter(person => person.active !== false)) {
      const groupNames = (person.groupIds || []).map(id => groupMap.get(id)?.name || "");
      const relationWords = relations
        .filter(rel => rel.active !== false && (rel.personAId === person.id || rel.personBId === person.id))
        .flatMap(rel => {
          const otherId = rel.personAId === person.id ? rel.personBId : rel.personAId;
          return [nameOf(peopleMap.get(otherId)), rel.type, rel.notes];
        });
      const eventWords = events
        .filter(event => event.active !== false && event.personId === person.id)
        .flatMap(event => [event.title, event.notes, event.date]);

      const title = nameOf(person);
      const haystack = normalize([
        title,
        person.nickname,
        person.howKnown,
        person.profession,
        person.city,
        person.phone,
        person.email,
        person.notes,
        person.birthdayNote,
        ...groupNames,
        ...relationWords,
        ...eventWords
      ].filter(Boolean).join(" "));

      if (!haystack.includes(needle)) continue;

      let score = 2;
      if (normalize(title).startsWith(needle)) score += 5;
      else if (normalize(title).includes(needle)) score += 3;

      results.push({
        id: person.id,
        route: "people",
        icon: "👥",
        type: "Personne",
        title,
        detail: [person.howKnown, ...groupNames.slice(0,2)].filter(Boolean).join(" · "),
        score
      });
    }
  } catch (error) {
    console.warn("Recherche Personnes indisponible :", error);
  }

  return results
    .sort((a,b)=>b.score-a.score || a.type.localeCompare(b.type) || a.title.localeCompare(b.title))
    .slice(0,80);
}

function groupResults(results) {
  const map = new Map();
  results.forEach(result => {
    if (!map.has(result.type)) map.set(result.type, []);
    map.get(result.type).push(result);
  });
  return [...map.entries()];
}

export async function renderSearch(container) {
  lastContainer = container;

  container.innerHTML = `
    <section class="search-shell">
      <div class="search-hero app-panel">
        <p class="eyebrow">RECHERCHE GLOBALE</p>
        <h2>Retrouver n'importe quoi dans MyHub</h2>
        <p class="muted">Tâches, personnes, biens, repas, courses, documents, projets, objectifs, plantes, aquariums, sport, idées…</p>
        <div class="global-search-box">
          <span>⌕</span>
          <input id="global-search-input" type="search" value="${escapeHtml(query)}" placeholder="Ex : Paul, poulet, pâtes, bateau, iPhone…" autocomplete="off" enterkeyhint="search">
          <button class="icon-btn" id="global-search-clear" aria-label="Effacer">×</button>
        </div>
      </div>
      <div id="global-search-results"></div>
    </section>`;

  const input = container.querySelector("#global-search-input");
  const clear = container.querySelector("#global-search-clear");

  let timer;
  const run = async () => {
    query = input.value.trim();
    const target = container.querySelector("#global-search-results");

    if (query.length < 2) {
      target.innerHTML = `
        <div class="search-empty app-panel">
          <strong>Commence à écrire</strong>
          <p>Deux caractères suffisent pour lancer la recherche sur l'ensemble de MyHub.</p>
        </div>`;
      return;
    }

    target.innerHTML = `<div class="search-loading">Recherche…</div>`;
    const results = await searchAll(query);

    if (!results.length) {
      target.innerHTML = `
        <div class="search-empty app-panel">
          <strong>Aucun résultat pour « ${escapeHtml(query)} »</strong>
          <p>Essaie un nom, une marque, un projet ou un mot présent dans une description.</p>
        </div>`;
      return;
    }

    target.innerHTML = `
      <div class="search-result-count">${results.length} résultat${results.length>1?"s":""}</div>
      ${groupResults(results).map(([type,rows])=>`
        <section class="search-group">
          <div class="section-head compact"><h3>${escapeHtml(type)}</h3><span class="app-badge">${rows.length}</span></div>
          <div class="search-results-list">
            ${rows.map(row=>`
              <button class="search-result-row app-card" data-search-route="${row.route}">
                <span class="search-result-icon">${row.icon}</span>
                <span class="search-result-main">
                  <strong>${escapeHtml(row.title)}</strong>
                  ${row.detail ? `<small>${escapeHtml(row.detail)}</small>` : ""}
                </span>
                <span class="search-result-arrow">›</span>
              </button>`).join("")}
          </div>
        </section>`).join("")}`;

    target.querySelectorAll("[data-search-route]").forEach(btn => {
      btn.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: btn.dataset.searchRoute }));
      });
    });
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(run, 160);
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      clearTimeout(timer);
      run();
    }
  });

  clear.addEventListener("click", () => {
    input.value = "";
    query = "";
    run();
    input.focus();
  });

  await run();
  setTimeout(()=>input.focus(),60);
}
