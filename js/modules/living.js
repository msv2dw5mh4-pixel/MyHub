import { getAll, getOne, putOne, deleteOne } from "../core/db.js";
import { escapeHtml, uid, openModal, closeModal, todayISO } from "../core/ui.js";
import { syncLivingCareTasks, deleteLivingCareTasksForPlan, getLivingCareSummary } from "../core/living_tasks.js";

let currentView = "overview";
let currentAquariumId = null;
let currentPlantId = null;
let lastContainer = null;

const LIGHT_OPTIONS = [
  "Plein soleil",
  "Ensoleillé",
  "Mi-ombre",
  "Lumineux sans soleil direct",
  "Ombre",
  "Intérieur",
  "Extérieur"
];

const AQUARIUM_TYPES = ["Eau douce", "Aquarium planté", "Bassin", "Autre"];

export async function renderLiving(container) {
  lastContainer = container;
  container.innerHTML = `<section class="living-shell" id="living-shell"></section>`;
  await syncLivingCareTasks();
  await renderCurrentView();
}

export function requestNewLivingItem() {
  currentView = "overview";
  window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "living" }));
  setTimeout(() => showQuickLivingModal(), 120);
}

function tabs(active) {
  return `
    <div class="living-tabs">
      <button class="living-tab ${active==="overview"?"active":""}" data-living-view="overview">Résumé</button>
      <button class="living-tab ${active==="aquariums"?"active":""}" data-living-view="aquariums">Aquariums</button>
      <button class="living-tab ${active==="plants"?"active":""}" data-living-view="plants">Plantes</button>
      <button class="living-tab ${active==="care"?"active":""}" data-living-view="care">À faire</button>
      <button class="living-tab ${active==="history"?"active":""}" data-living-view="history">Historique</button>
    </div>`;
}

function bindTabs(shell) {
  shell.querySelectorAll("[data-living-view]").forEach(btn => btn.addEventListener("click", async () => {
    currentView = btn.dataset.livingView;
    currentAquariumId = null;
    currentPlantId = null;
    await renderCurrentView();
  }));
}

async function renderCurrentView() {
  if (!lastContainer) return;
  const shell = lastContainer.querySelector("#living-shell") || lastContainer;
  await syncLivingCareTasks();

  if (currentView === "aquarium-detail") return renderAquariumDetail(shell, currentAquariumId);
  if (currentView === "plant-detail") return renderPlantDetail(shell, currentPlantId);
  if (currentView === "aquariums") return renderAquariums(shell);
  if (currentView === "plants") return renderPlants(shell);
  if (currentView === "care") return renderCare(shell);
  if (currentView === "history") return renderHistory(shell);
  return renderOverview(shell);
}

async function getData() {
  const [aquariums, plants, species, events, plans, records, tasks, assets] = await Promise.all([
    getAll("livingAquariums"),
    getAll("livingPlants"),
    getAll("livingSpecies"),
    getAll("livingEvents"),
    getAll("livingCarePlans"),
    getAll("livingCareRecords"),
    getAll("tasks"),
    getAll("maintenanceAssets")
  ]);

  return {
    aquariums: aquariums.filter(a => a.active !== false).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""))),
    plants: plants.filter(p => p.active !== false).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""))),
    species,
    events: [...events].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")) || String(b.createdAt||"").localeCompare(String(a.createdAt||""))),
    plans: plans.filter(p => p.active !== false),
    records: [...records].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))),
    tasks,
    assets: assets.filter(a => a.active !== false && !["sold","retired"].includes(a.ownershipStatus))
  };
}

function formatDate(date) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"short",year:"numeric"}).format(new Date(`${date}T12:00:00`));
}

function addDays(date, days) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + Number(days||0));
  const offset=d.getTimezoneOffset();
  return new Date(d.getTime()-offset*60000).toISOString().slice(0,10);
}

function compressImage(file) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=e=>{
      const image=new Image();
      image.onload=()=>{
        const canvas=document.createElement("canvas");
        const max=1200;
        const ratio=Math.min(1,max/image.width,max/image.height);
        canvas.width=Math.round(image.width*ratio);
        canvas.height=Math.round(image.height*ratio);
        canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
        resolve(canvas.toDataURL("image/jpeg",0.78));
      };
      image.onerror=reject;
      image.src=e.target.result;
    };
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
}

function photoBlock(photo, icon) {
  return photo
    ? `<img class="living-photo" src="${photo}" alt="">`
    : `<div class="living-photo living-photo-placeholder">${icon}</div>`;
}

function aquariumPopulation(species) {
  return species.reduce((sum,row)=>sum+Number(row.adults||0)+Number(row.juveniles||0)+Number(row.fry||0),0);
}

function stageLabel(stage) {
  if (stage==="juveniles") return "juvéniles";
  if (stage==="fry") return "alevins";
  return "adultes";
}

function eventLabel(event) {
  const labels = {
    birth: "🐣 Naissance",
    count: "🔢 Comptage",
    death: "† Décès",
    purchase: "➕ Introduction",
    donation: "🎁 Don",
    sale: "💶 Vente",
    transfer: "↔ Transfert",
    note: "📝 Note"
  };
  return labels[event.type] || "Événement";
}

function quickButtons() {
  return `
    <div class="living-quick-actions">
      <button class="primary-btn" id="living-add-aquarium">+ Aquarium</button>
      <button class="ghost-btn" id="living-add-plant">+ Plante</button>
    </div>`;
}

function bindQuickButtons(shell) {
  shell.querySelector("#living-add-aquarium")?.addEventListener("click",()=>showAquariumModal());
  shell.querySelector("#living-add-plant")?.addEventListener("click",()=>showPlantModal());
}

async function renderOverview(shell) {
  const data=await getData();
  const summary=await getLivingCareSummary();
  const today=todayISO();
  const dueTasks=data.tasks
    .filter(t=>t.source==="living-care" && !t.done)
    .sort((a,b)=>String(a.dueDate||"").localeCompare(String(b.dueDate||"")));

  shell.innerHTML=`
    ${tabs("overview")}
    <section class="living-hero">
      <div>
        <p class="eyebrow">VIVANT</p>
        <h2>Aquariums & Plantes</h2>
        <p>Suivi des bacs, populations, naissances, comptages et soins de tes plantes.</p>
      </div>
      ${quickButtons()}
    </section>

    <div class="living-kpis">
      <article><span>🐠 Aquariums</span><strong>${summary.aquariums}</strong><small>${data.species.length} espèce${data.species.length>1?"s":""} suivie${data.species.length>1?"s":""}</small></article>
      <article><span>🌿 Plantes</span><strong>${summary.plants}</strong><small>${data.plans.filter(p=>p.entityType==="plant").length} rythme${data.plans.filter(p=>p.entityType==="plant").length>1?"s":""} de soin</small></article>
      <article><span>À faire</span><strong>${summary.due}</strong><small>${summary.upcoming} à venir</small></article>
    </div>

    <section class="living-section">
      <div class="section-head"><div><h2>À faire</h2><p class="muted">Les soins récurrents alimentent automatiquement Tâches et Planning.</p></div><button class="ghost-btn" data-living-view="care">Tout voir</button></div>
      <div class="living-list">
        ${dueTasks.length ? dueTasks.slice(0,6).map(task=>`
          <article class="living-care-row ${task.dueDate<=today?"due":""}">
            <div><strong>${escapeHtml(task.title)}</strong><small>${task.dueDate<=today?"À faire":"Prévu"} · ${formatDate(task.dueDate)}</small></div>
            <span>${task.livingEntityType==="plant"?"🌿":"🐠"}</span>
          </article>`).join("") : `<div class="empty">Aucun soin programmé.</div>`}
      </div>
    </section>

    <section class="living-section">
      <div class="section-head"><div><h2>Aquariums</h2><p class="muted">Population actuelle et historique du bac.</p></div><button class="ghost-btn" data-living-view="aquariums">Voir</button></div>
      <div class="living-card-grid">
        ${data.aquariums.slice(0,4).map(a=>{
          const rows=data.species.filter(s=>s.aquariumId===a.id);
          return `<article class="living-card" data-open-aquarium="${a.id}">
            ${photoBlock(a.photo,"🐠")}
            <div class="living-card-body"><h3>${escapeHtml(a.name)}</h3><p>${Number(a.volumeLiters||0) ? `${Number(a.volumeLiters).toLocaleString("fr-FR")} L · ` : ""}${escapeHtml(a.type||"Aquarium")}</p><strong>${aquariumPopulation(rows)} poisson${aquariumPopulation(rows)>1?"s":""}</strong></div>
          </article>`;
        }).join("") || `<div class="empty">Ajoute ton premier aquarium.</div>`}
      </div>
    </section>

    <section class="living-section">
      <div class="section-head"><div><h2>Plantes</h2><p class="muted">Emplacement, lumière et prochain arrosage.</p></div><button class="ghost-btn" data-living-view="plants">Voir</button></div>
      <div class="living-card-grid">
        ${data.plants.slice(0,4).map(p=>{
          const plan=data.plans.find(x=>x.entityType==="plant" && x.entityId===p.id && x.category==="watering");
          return `<article class="living-card" data-open-plant="${p.id}">
            ${photoBlock(p.photo,"🌿")}
            <div class="living-card-body"><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.lightNeed||"Lumière non renseignée")}</p><strong>${plan?.nextDueDate ? `Arrosage ${formatDate(plan.nextDueDate)}` : "Sans rappel"}</strong></div>
          </article>`;
        }).join("") || `<div class="empty">Ajoute ta première plante.</div>`}
      </div>
    </section>`;

  bindTabs(shell); bindQuickButtons(shell);
  shell.querySelectorAll("[data-living-view]").forEach(btn=>btn.addEventListener("click",async()=>{currentView=btn.dataset.livingView;await renderCurrentView();}));
  shell.querySelectorAll("[data-open-aquarium]").forEach(card=>card.addEventListener("click",async()=>{currentAquariumId=card.dataset.openAquarium;currentView="aquarium-detail";await renderCurrentView();}));
  shell.querySelectorAll("[data-open-plant]").forEach(card=>card.addEventListener("click",async()=>{currentPlantId=card.dataset.openPlant;currentView="plant-detail";await renderCurrentView();}));
}

async function renderAquariums(shell) {
  const data=await getData();
  shell.innerHTML=`
    ${tabs("aquariums")}
    <div class="section-head"><div><h2>Mes aquariums</h2><p class="muted">${data.aquariums.length} bac${data.aquariums.length>1?"s":""}</p></div><button class="primary-btn" id="living-add-aquarium">+ Aquarium</button></div>
    <div class="living-card-grid">
      ${data.aquariums.map(a=>{
        const rows=data.species.filter(s=>s.aquariumId===a.id);
        const total=aquariumPopulation(rows);
        return `<article class="living-card" data-open-aquarium="${a.id}">
          ${photoBlock(a.photo,"🐠")}
          <div class="living-card-body"><h3>${escapeHtml(a.name)}</h3><p>${escapeHtml(a.type||"Aquarium")}${a.volumeLiters?` · ${Number(a.volumeLiters).toLocaleString("fr-FR")} L`:""}</p><strong>${total} poisson${total>1?"s":""} · ${rows.length} espèce${rows.length>1?"s":""}</strong></div>
        </article>`;
      }).join("") || `<div class="empty">Aucun aquarium.</div>`}
    </div>`;
  bindTabs(shell); bindQuickButtons(shell);
  shell.querySelectorAll("[data-open-aquarium]").forEach(card=>card.addEventListener("click",async()=>{currentAquariumId=card.dataset.openAquarium;currentView="aquarium-detail";await renderCurrentView();}));
}

async function renderPlants(shell) {
  const data=await getData();
  shell.innerHTML=`
    ${tabs("plants")}
    <div class="section-head"><div><h2>Mes plantes</h2><p class="muted">${data.plants.length} plante${data.plants.length>1?"s":""}</p></div><button class="primary-btn" id="living-add-plant">+ Plante</button></div>
    <div class="living-card-grid">
      ${data.plants.map(p=>{
        const plan=data.plans.find(x=>x.entityType==="plant"&&x.entityId===p.id&&x.category==="watering");
        return `<article class="living-card" data-open-plant="${p.id}">
          ${photoBlock(p.photo,"🌿")}
          <div class="living-card-body"><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.location||"Emplacement non renseigné")} · ${escapeHtml(p.lightNeed||"Lumière non renseignée")}</p><strong>${plan?.nextDueDate?`Prochain arrosage : ${formatDate(plan.nextDueDate)}`:"Sans rappel"}</strong></div>
        </article>`;
      }).join("") || `<div class="empty">Aucune plante.</div>`}
    </div>`;
  bindTabs(shell); bindQuickButtons(shell);
  shell.querySelectorAll("[data-open-plant]").forEach(card=>card.addEventListener("click",async()=>{currentPlantId=card.dataset.openPlant;currentView="plant-detail";await renderCurrentView();}));
}

async function renderAquariumDetail(shell,id) {
  const data=await getData();
  const aquarium=data.aquariums.find(a=>a.id===id);
  if (!aquarium) { currentView="aquariums"; return renderAquariums(shell); }

  const species=data.species.filter(s=>s.aquariumId===id);
  const events=data.events.filter(e=>e.aquariumId===id);
  const plans=data.plans.filter(p=>p.entityType==="aquarium"&&p.entityId===id);
  const linkedAssets=data.assets.filter(a=>(aquarium.maintenanceAssetIds||[]).includes(a.id));

  shell.innerHTML=`
    ${tabs("")}
    <button class="ghost-btn living-back" id="living-back">← Aquariums</button>

    <section class="living-detail-hero">
      ${photoBlock(aquarium.photo,"🐠")}
      <div><p class="eyebrow">${escapeHtml(aquarium.type||"AQUARIUM")}</p><h2>${escapeHtml(aquarium.name)}</h2><p>${aquarium.volumeLiters?`${Number(aquarium.volumeLiters).toLocaleString("fr-FR")} L · `:""}Mis en eau ${formatDate(aquarium.startDate)}</p><strong>${aquariumPopulation(species)} poisson${aquariumPopulation(species)>1?"s":""}</strong></div>
      <button class="icon-btn" id="living-edit-aquarium">✎</button>
    </section>

    <div class="living-detail-actions">
      <button class="primary-btn" id="living-event-birth">🐣 Naissance</button>
      <button class="ghost-btn" id="living-event-count">🔢 Comptage</button>
      <button class="ghost-btn" id="living-event-other">+ Mouvement</button>
      <button class="ghost-btn" id="living-add-species">+ Espèce</button>
    </div>

    <section class="living-section">
      <div class="section-head"><div><h2>Population</h2><p class="muted">Adultes, juvéniles et alevins.</p></div></div>
      <div class="living-pop-list">
        ${species.map(s=>`
          <article class="living-pop-row">
            <div><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(s.notes||"")}</small></div>
            <div class="living-pop-counts"><span><b>${Number(s.adults||0)}</b> adultes</span><span><b>${Number(s.juveniles||0)}</b> juv.</span><span><b>${Number(s.fry||0)}</b> alevins</span><strong>${Number(s.adults||0)+Number(s.juveniles||0)+Number(s.fry||0)}</strong></div>
            <button class="icon-btn" data-edit-species="${s.id}">✎</button>
          </article>`).join("") || `<div class="empty">Aucune espèce renseignée.</div>`}
      </div>
    </section>

    <section class="living-section">
      <div class="section-head"><div><h2>Entretien du bac</h2><p class="muted">Les rythmes créent automatiquement des tâches.</p></div><button class="ghost-btn" id="living-add-aquarium-care">+ Rythme</button></div>
      <div class="living-list">
        ${plans.map(plan=>`<article class="living-care-row"><div><strong>${escapeHtml(plan.title)}</strong><small>Tous les ${plan.frequencyDays} j · prochain ${formatDate(plan.nextDueDate)}</small></div><button class="icon-btn" data-edit-care="${plan.id}">✎</button></article>`).join("") || `<div class="empty">Aucun entretien récurrent.</div>`}
      </div>
    </section>

    <section class="living-section">
      <div class="section-head"><div><h2>Matériel lié</h2><p class="muted">Le matériel reste géré dans Entretien / Mes biens.</p></div></div>
      <div class="living-tags">${linkedAssets.length?linkedAssets.map(a=>`<span>🔧 ${escapeHtml(a.name)}</span>`).join(""):`<span>Aucun matériel lié</span>`}</div>
      ${aquarium.plantsText?`<div class="living-note"><strong>Plantes présentes</strong><p>${escapeHtml(aquarium.plantsText)}</p></div>`:""}
    </section>

    <section class="living-section">
      <div class="section-head"><div><h2>Historique du bac</h2><p class="muted">${events.length} événement${events.length>1?"s":""}</p></div></div>
      <div class="living-history">
        ${events.slice(0,30).map(e=>`<article><span>${formatDate(e.date)}</span><div><strong>${eventLabel(e)}</strong><p>${escapeHtml(e.summary||"")}</p></div></article>`).join("") || `<div class="empty">Aucun événement enregistré.</div>`}
      </div>
    </section>

    <button class="danger-btn" id="living-delete-aquarium">Supprimer cet aquarium</button>`;

  bindTabs(shell);
  shell.querySelector("#living-back").addEventListener("click",async()=>{currentView="aquariums";await renderCurrentView();});
  shell.querySelector("#living-edit-aquarium").addEventListener("click",()=>showAquariumModal(id));
  shell.querySelector("#living-add-species").addEventListener("click",()=>showSpeciesModal(id));
  shell.querySelector("#living-event-birth").addEventListener("click",()=>showAquariumEventModal(id,"birth"));
  shell.querySelector("#living-event-count").addEventListener("click",()=>showAquariumEventModal(id,"count"));
  shell.querySelector("#living-event-other").addEventListener("click",()=>showAquariumEventModal(id,"purchase"));
  shell.querySelector("#living-add-aquarium-care").addEventListener("click",()=>showCareModal("aquarium",id));
  shell.querySelectorAll("[data-edit-species]").forEach(btn=>btn.addEventListener("click",()=>showSpeciesModal(id,btn.dataset.editSpecies)));
  shell.querySelectorAll("[data-edit-care]").forEach(btn=>btn.addEventListener("click",()=>showCareModal("aquarium",id,btn.dataset.editCare)));

  shell.querySelector("#living-delete-aquarium").addEventListener("click",async()=>{
    if (!confirm(`Supprimer "${aquarium.name}" et son historique ?`)) return;
    for (const row of species) await deleteOne("livingSpecies",row.id);
    for (const row of events) await deleteOne("livingEvents",row.id);
    for (const plan of plans) {
      await deleteLivingCareTasksForPlan(plan.id);
      await deleteOne("livingCarePlans",plan.id);
    }
    await deleteOne("livingAquariums",id);
    currentView="aquariums";
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrentView();
  });
}

async function renderPlantDetail(shell,id) {
  const data=await getData();
  const plant=data.plants.find(p=>p.id===id);
  if (!plant) {currentView="plants";return renderPlants(shell);}
  const plans=data.plans.filter(p=>p.entityType==="plant"&&p.entityId===id);
  const records=data.records.filter(r=>r.entityType==="plant"&&r.entityId===id);
  const manualTasks=data.tasks.filter(t=>t.livingEntityType==="plant"&&t.livingEntityId===id&&!t.done);

  shell.innerHTML=`
    ${tabs("")}
    <button class="ghost-btn living-back" id="living-back">← Plantes</button>
    <section class="living-detail-hero">
      ${photoBlock(plant.photo,"🌿")}
      <div><p class="eyebrow">${escapeHtml(plant.species||"PLANTE")}</p><h2>${escapeHtml(plant.name)}</h2><p>${escapeHtml(plant.location||"Emplacement non renseigné")} · ${escapeHtml(plant.lightNeed||"Lumière non renseignée")}</p></div>
      <button class="icon-btn" id="living-edit-plant">✎</button>
    </section>

    <div class="living-info-grid">
      <article><span>Emplacement souhaité</span><strong>${escapeHtml(plant.lightNeed||"—")}</strong></article>
      <article><span>Emplacement réel</span><strong>${escapeHtml(plant.location||"—")}</strong></article>
      <article><span>Acquisition</span><strong>${formatDate(plant.acquiredDate)}</strong></article>
      <article><span>Rythme d'arrosage</span><strong>${plant.wateringEveryDays?`Tous les ${plant.wateringEveryDays} jours`:"Sans rappel"}</strong></article>
    </div>

    <section class="living-section">
      <div class="section-head"><div><h2>Soins</h2><p class="muted">Arrosage, engrais, rempotage, taille…</p></div><button class="ghost-btn" id="living-add-plant-care">+ Rythme</button></div>
      <div class="living-list">
        ${plans.map(plan=>`<article class="living-care-row"><div><strong>${escapeHtml(plan.title)}</strong><small>Tous les ${plan.frequencyDays} j · prochain ${formatDate(plan.nextDueDate)}</small></div><button class="icon-btn" data-edit-care="${plan.id}">✎</button></article>`).join("") || `<div class="empty">Aucun soin récurrent.</div>`}
      </div>
    </section>

    <section class="living-section">
      <div class="section-head"><div><h2>Tâches liées</h2><p class="muted">Les tâches manuelles peuvent aussi être reliées à cette plante.</p></div></div>
      <div class="living-list">${manualTasks.length?manualTasks.map(t=>`<article class="living-care-row"><div><strong>${escapeHtml(t.title)}</strong><small>${formatDate(t.dueDate)}</small></div><span>✓</span></article>`).join(""):`<div class="empty">Aucune tâche manuelle.</div>`}</div>
    </section>

    <section class="living-section">
      <div class="section-head"><div><h2>Historique des soins</h2><p class="muted">${records.length} action${records.length>1?"s":""}</p></div></div>
      <div class="living-history">${records.map(r=>`<article><span>${formatDate(r.date)}</span><div><strong>${escapeHtml(r.title||"Soin")}</strong><p>${escapeHtml(r.notes||"")}</p></div></article>`).join("")||`<div class="empty">Aucun soin enregistré.</div>`}</div>
    </section>

    ${plant.notes?`<div class="living-note"><strong>Notes</strong><p>${escapeHtml(plant.notes)}</p></div>`:""}
    <button class="danger-btn" id="living-delete-plant">Supprimer cette plante</button>`;

  bindTabs(shell);
  shell.querySelector("#living-back").addEventListener("click",async()=>{currentView="plants";await renderCurrentView();});
  shell.querySelector("#living-edit-plant").addEventListener("click",()=>showPlantModal(id));
  shell.querySelector("#living-add-plant-care").addEventListener("click",()=>showCareModal("plant",id));
  shell.querySelectorAll("[data-edit-care]").forEach(btn=>btn.addEventListener("click",()=>showCareModal("plant",id,btn.dataset.editCare)));
  shell.querySelector("#living-delete-plant").addEventListener("click",async()=>{
    if (!confirm(`Supprimer "${plant.name}" et ses rythmes de soin ?`)) return;
    for (const plan of plans) { await deleteLivingCareTasksForPlan(plan.id); await deleteOne("livingCarePlans",plan.id); }
    await deleteOne("livingPlants",id);
    currentView="plants";
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrentView();
  });
}

async function renderCare(shell) {
  const data=await getData();
  const tasks=data.tasks.filter(t=>t.source==="living-care"&&!t.done).sort((a,b)=>String(a.dueDate||"").localeCompare(String(b.dueDate||"")));
  shell.innerHTML=`
    ${tabs("care")}
    <div class="section-head"><div><h2>À faire</h2><p class="muted">Ces actions sont aussi visibles dans Tâches et Planning.</p></div></div>
    <div class="living-list">
      ${tasks.map(t=>`<article class="living-care-row ${t.dueDate<=todayISO()?"due":""}"><div><strong>${escapeHtml(t.title)}</strong><small>${t.livingEntityType==="plant"?"🌿 Plante":"🐠 Aquarium"} · ${formatDate(t.dueDate)}</small></div><button class="ghost-btn" data-open-task-entity="${t.livingEntityType}:${t.livingEntityId}">Voir</button></article>`).join("")||`<div class="empty">Aucun soin à venir.</div>`}
    </div>`;
  bindTabs(shell);
  shell.querySelectorAll("[data-open-task-entity]").forEach(btn=>btn.addEventListener("click",async()=>{
    const [type,id]=btn.dataset.openTaskEntity.split(":");
    if(type==="plant"){currentPlantId=id;currentView="plant-detail";}else{currentAquariumId=id;currentView="aquarium-detail";}
    await renderCurrentView();
  }));
}

async function renderHistory(shell) {
  const data=await getData();
  const rows=[
    ...data.events.map(e=>({date:e.date,title:eventLabel(e),text:e.summary||"",icon:"🐠"})),
    ...data.records.map(r=>({date:r.date,title:r.title||"Soin",text:r.notes||"",icon:r.entityType==="plant"?"🌿":"🐠"}))
  ].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));

  shell.innerHTML=`
    ${tabs("history")}
    <div class="section-head"><div><h2>Historique</h2><p class="muted">Événements des aquariums et soins enregistrés.</p></div></div>
    <div class="living-history">${rows.map(r=>`<article><span>${formatDate(r.date)}</span><div><strong>${r.icon} ${escapeHtml(r.title)}</strong><p>${escapeHtml(r.text)}</p></div></article>`).join("")||`<div class="empty">Aucun historique.</div>`}</div>`;
  bindTabs(shell);
}

function showQuickLivingModal() {
  openModal(`
    <div class="modal-head"><div><p class="eyebrow">AQUARIUMS & PLANTES</p><h2>Ajouter</h2></div><button class="icon-btn" id="living-modal-close">×</button></div>
    <div class="list">
      <button class="list-item" id="living-quick-aquarium"><div style="font-size:26px">🐠</div><div class="task-main"><div class="task-title">Aquarium</div><div class="task-desc">Créer un bac et suivre sa population.</div></div></button>
      <button class="list-item" id="living-quick-plant"><div style="font-size:26px">🌿</div><div class="task-main"><div class="task-title">Plante</div><div class="task-desc">Ajouter lumière, emplacement et rythme d'arrosage.</div></div></button>
    </div>`);
  document.querySelector("#living-modal-close").addEventListener("click",closeModal);
  document.querySelector("#living-quick-aquarium").addEventListener("click",()=>{closeModal();showAquariumModal();});
  document.querySelector("#living-quick-plant").addEventListener("click",()=>{closeModal();showPlantModal();});
}

async function showAquariumModal(id=null) {
  const [aquarium,assets]=await Promise.all([
    id?getOne("livingAquariums",id):Promise.resolve(null),
    getAll("maintenanceAssets")
  ]);
  const activeAssets=assets.filter(a=>a.active!==false&&!["sold","retired"].includes(a.ownershipStatus));
  const linked=aquarium?.maintenanceAssetIds||[];

  openModal(`
    <div class="modal-head"><div><p class="eyebrow">AQUARIUM</p><h2>${aquarium?"Modifier":"Nouveau"} aquarium</h2></div><button class="icon-btn" id="living-modal-close">×</button></div>
    <form class="form-grid" id="aquarium-form">
      <div class="field"><label>Nom</label><input name="name" required maxlength="100" value="${escapeHtml(aquarium?.name||"")}" placeholder="Ex : Bac salon"></div>
      <div class="row">
        <div class="field"><label>Volume (L)</label><input name="volumeLiters" type="number" min="0" step="1" value="${aquarium?.volumeLiters??""}"></div>
        <div class="field"><label>Type</label><select name="type">${AQUARIUM_TYPES.map(t=>`<option ${aquarium?.type===t?"selected":""}>${t}</option>`).join("")}</select></div>
      </div>
      <div class="field"><label>Date de mise en eau</label><input name="startDate" type="date" value="${aquarium?.startDate||""}"></div>
      <div class="field"><label>Photo</label><input name="photo" type="file" accept="image/*"><small class="muted">La photo reste stockée localement dans MyHub.</small></div>
      ${aquarium?.photo?`<img class="living-modal-preview" src="${aquarium.photo}" alt="">`:""}
      <div class="field"><label>Plantes présentes dans le bac</label><textarea name="plantsText" placeholder="Ex : Anubias, vallisneria, plantes flottantes…">${escapeHtml(aquarium?.plantsText||"")}</textarea></div>
      <div class="field"><label>Matériel lié dans Entretien</label><div class="living-check-list">${activeAssets.map(a=>`<label><input type="checkbox" name="maintenanceAssetId" value="${a.id}" ${linked.includes(a.id)?"checked":""}><span>${escapeHtml(a.name)}</span></label>`).join("")||`<small class="muted">Aucun bien disponible dans Entretien.</small>`}</div></div>
      <div class="field"><label>Notes</label><textarea name="notes">${escapeHtml(aquarium?.notes||"")}</textarea></div>
      <div class="actions"><button class="ghost-btn" type="button" id="living-modal-cancel">Annuler</button><button class="primary-btn">Enregistrer</button></div>
    </form>`);

  document.querySelector("#living-modal-close").addEventListener("click",closeModal);
  document.querySelector("#living-modal-cancel").addEventListener("click",closeModal);
  document.querySelector("#aquarium-form").addEventListener("submit",async e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const file=e.target.querySelector('[name="photo"]').files?.[0];
    const photo=file?await compressImage(file):(aquarium?.photo||"");
    const saved={
      ...(aquarium||{}), id:aquarium?.id||uid("aquarium"),
      name:String(fd.get("name")||"").trim(),
      volumeLiters:Number(fd.get("volumeLiters")||0),
      type:String(fd.get("type")||"Eau douce"),
      startDate:String(fd.get("startDate")||""),
      photo,
      plantsText:String(fd.get("plantsText")||"").trim(),
      maintenanceAssetIds:fd.getAll("maintenanceAssetId").map(String),
      notes:String(fd.get("notes")||"").trim(),
      active:true,
      createdAt:aquarium?.createdAt||new Date().toISOString(),
      updatedAt:new Date().toISOString()
    };
    await putOne("livingAquariums",saved);
    closeModal();
    currentAquariumId=saved.id;currentView="aquarium-detail";
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrentView();
  });
}

async function showPlantModal(id=null) {
  const [plant, allPlans] = await Promise.all([
    id ? getOne("livingPlants",id) : Promise.resolve(null),
    getAll("livingCarePlans")
  ]);
  const currentWatering = plant
    ? allPlans.find(p=>p.entityType==="plant"&&p.entityId===plant.id&&p.category==="watering"&&p.active!==false)
    : null;

  openModal(`
    <div class="modal-head"><div><p class="eyebrow">PLANTE</p><h2>${plant?"Modifier":"Nouvelle"} plante</h2></div><button class="icon-btn" id="living-modal-close">×</button></div>
    <form class="form-grid" id="plant-form">
      <div class="field"><label>Nom de la plante</label><input name="name" required maxlength="100" value="${escapeHtml(plant?.name||"")}" placeholder="Ex : Monstera salon"></div>
      <div class="field"><label>Espèce / variété <span class="muted">(facultatif)</span></label><input name="species" value="${escapeHtml(plant?.species||"")}" placeholder="Ex : Monstera deliciosa"></div>
      <div class="field"><label>Emplacement souhaité / luminosité</label><select name="lightNeed" required><option value="">Choisir</option>${LIGHT_OPTIONS.map(v=>`<option ${plant?.lightNeed===v?"selected":""}>${v}</option>`).join("")}</select></div>
      <div class="field"><label>Emplacement réel</label><input name="location" value="${escapeHtml(plant?.location||"")}" placeholder="Ex : Salon, terrasse, cuisine…"></div>
      <div class="row">
        <div class="field"><label>Rythme d'arrosage</label><input name="wateringEveryDays" required type="number" min="1" max="365" step="1" value="${currentWatering?.frequencyDays??plant?.wateringEveryDays??7}" placeholder="Jours"></div>
        <div class="field"><label>Prochain arrosage</label><input name="nextWateringDate" type="date" value="${currentWatering?.nextDueDate||plant?.nextWateringDate||todayISO()}"></div>
      </div>
      <div class="field"><label>Date d'acquisition</label><input name="acquiredDate" type="date" value="${plant?.acquiredDate||""}"></div>
      <div class="field"><label>Photo</label><input name="photo" type="file" accept="image/*"></div>
      ${plant?.photo?`<img class="living-modal-preview" src="${plant.photo}" alt="">`:""}
      <div class="field"><label>Notes</label><textarea name="notes">${escapeHtml(plant?.notes||"")}</textarea></div>
      <div class="actions"><button class="ghost-btn" type="button" id="living-modal-cancel">Annuler</button><button class="primary-btn">Enregistrer</button></div>
    </form>`);

  document.querySelector("#living-modal-close").addEventListener("click",closeModal);
  document.querySelector("#living-modal-cancel").addEventListener("click",closeModal);
  document.querySelector("#plant-form").addEventListener("submit",async e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const file=e.target.querySelector('[name="photo"]').files?.[0];
    const photo=file?await compressImage(file):(plant?.photo||"");
    const wateringEveryDays=Math.max(1,Number(fd.get("wateringEveryDays")||7));
    const nextWateringDate=String(fd.get("nextWateringDate")||todayISO());

    const saved={
      ...(plant||{}), id:plant?.id||uid("plant"),
      name:String(fd.get("name")||"").trim(),
      species:String(fd.get("species")||"").trim(),
      lightNeed:String(fd.get("lightNeed")||""),
      location:String(fd.get("location")||"").trim(),
      wateringEveryDays,
      nextWateringDate,
      acquiredDate:String(fd.get("acquiredDate")||""),
      photo,
      notes:String(fd.get("notes")||"").trim(),
      active:true,
      createdAt:plant?.createdAt||new Date().toISOString(),
      updatedAt:new Date().toISOString()
    };
    await putOne("livingPlants",saved);

    const allPlans=await getAll("livingCarePlans");
    let watering=allPlans.find(p=>p.entityType==="plant"&&p.entityId===saved.id&&p.category==="watering");
    if (!watering) {
      watering={
        id:uid("living_care"), entityType:"plant", entityId:saved.id,
        category:"watering", title:`🌿 Arroser ${saved.name}`,
        frequencyDays:wateringEveryDays, nextDueDate:nextWateringDate,
        active:true, createdAt:new Date().toISOString()
      };
    } else {
      watering={...watering,title:`🌿 Arroser ${saved.name}`,frequencyDays:wateringEveryDays,nextDueDate:nextWateringDate,updatedAt:new Date().toISOString()};
      await deleteLivingCareTasksForPlan(watering.id);
    }
    await putOne("livingCarePlans",watering);
    await syncLivingCareTasks();

    closeModal();
    currentPlantId=saved.id;currentView="plant-detail";
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrentView();
  });
}

async function showSpeciesModal(aquariumId,speciesId=null) {
  const species=speciesId?await getOne("livingSpecies",speciesId):null;
  openModal(`
    <div class="modal-head"><div><p class="eyebrow">POPULATION</p><h2>${species?"Modifier":"Ajouter"} une espèce</h2></div><button class="icon-btn" id="living-modal-close">×</button></div>
    <form class="form-grid" id="species-form">
      <div class="field"><label>Espèce / nom</label><input name="name" required value="${escapeHtml(species?.name||"")}" placeholder="Ex : Guppy"></div>
      <div class="row"><div class="field"><label>Adultes</label><input name="adults" type="number" min="0" step="1" value="${species?.adults??0}"></div><div class="field"><label>Juvéniles</label><input name="juveniles" type="number" min="0" step="1" value="${species?.juveniles??0}"></div></div>
      <div class="field"><label>Alevins</label><input name="fry" type="number" min="0" step="1" value="${species?.fry??0}"></div>
      <div class="field"><label>Notes</label><textarea name="notes">${escapeHtml(species?.notes||"")}</textarea></div>
      <div class="actions"><button class="ghost-btn" type="button" id="living-modal-cancel">Annuler</button><button class="primary-btn">Enregistrer</button></div>
      ${species?`<button class="danger-btn" type="button" id="living-delete-species">Supprimer l'espèce</button>`:""}
    </form>`);
  document.querySelector("#living-modal-close").addEventListener("click",closeModal);
  document.querySelector("#living-modal-cancel").addEventListener("click",closeModal);
  document.querySelector("#species-form").addEventListener("submit",async e=>{
    e.preventDefault(); const fd=new FormData(e.target);
    await putOne("livingSpecies",{
      ...(species||{}),id:species?.id||uid("living_species"),aquariumId,
      name:String(fd.get("name")||"").trim(),
      adults:Number(fd.get("adults")||0),juveniles:Number(fd.get("juveniles")||0),fry:Number(fd.get("fry")||0),
      notes:String(fd.get("notes")||"").trim(),
      createdAt:species?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()
    });
    closeModal();window.dispatchEvent(new CustomEvent("myhub:data-changed"));await renderCurrentView();
  });
  document.querySelector("#living-delete-species")?.addEventListener("click",async()=>{
    if(!confirm("Supprimer cette espèce du comptage ?"))return;
    await deleteOne("livingSpecies",species.id);closeModal();await renderCurrentView();
  });
}

async function showAquariumEventModal(aquariumId,defaultType="purchase") {
  const data=await getData();
  const aquarium=data.aquariums.find(a=>a.id===aquariumId);
  const species=data.species.filter(s=>s.aquariumId===aquariumId);
  if (!species.length && defaultType!=="note") { alert("Ajoute d'abord une espèce à cet aquarium."); return; }

  openModal(`
    <div class="modal-head"><div><p class="eyebrow">AQUARIUM</p><h2>Enregistrer un événement</h2></div><button class="icon-btn" id="living-modal-close">×</button></div>
    <form class="form-grid" id="aquarium-event-form">
      <div class="field"><label>Type</label><select name="type" id="living-event-type">
        <option value="birth" ${defaultType==="birth"?"selected":""}>🐣 Naissance</option>
        <option value="count" ${defaultType==="count"?"selected":""}>🔢 Comptage exact</option>
        <option value="purchase" ${defaultType==="purchase"?"selected":""}>➕ Introduction / achat</option>
        <option value="death">Décès</option><option value="donation">Don</option><option value="sale">Vente</option><option value="transfer">Transfert</option><option value="note">Note</option>
      </select></div>
      <div class="field" id="living-species-field"><label>Espèce</label><select name="speciesId">${species.map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select></div>
      <div class="field" id="living-count-fields" style="display:none"><div class="row"><div class="field"><label>Adultes</label><input name="countAdults" type="number" min="0" step="1"></div><div class="field"><label>Juvéniles</label><input name="countJuveniles" type="number" min="0" step="1"></div></div><div class="field"><label>Alevins</label><input name="countFry" type="number" min="0" step="1"></div></div>
      <div id="living-movement-fields">
        <div class="row"><div class="field"><label>Nombre</label><input name="quantity" type="number" min="1" step="1" value="1"></div><div class="field"><label>Stade</label><select name="stage"><option value="adults">Adultes</option><option value="juveniles">Juvéniles</option><option value="fry">Alevins</option></select></div></div>
        <label class="living-check-inline" id="living-estimated-wrap"><input type="checkbox" name="estimated"><span>Comptage estimé</span></label>
        <div class="field" id="living-transfer-field" style="display:none"><label>Vers l'aquarium</label><select name="targetAquariumId"><option value="">Choisir</option>${data.aquariums.filter(a=>a.id!==aquariumId).map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("")}</select></div>
      </div>
      <div class="field"><label>Date</label><input name="date" type="date" value="${todayISO()}"></div>
      <div class="field"><label>Notes</label><textarea name="notes"></textarea></div>
      <div class="actions"><button class="ghost-btn" type="button" id="living-modal-cancel">Annuler</button><button class="primary-btn">Enregistrer</button></div>
    </form>`);

  const typeSelect=document.querySelector("#living-event-type");
  const refresh=()=>{
    const type=typeSelect.value;
    document.querySelector("#living-count-fields").style.display=type==="count"?"block":"none";
    document.querySelector("#living-movement-fields").style.display=["count","note"].includes(type)?"none":"block";
    document.querySelector("#living-species-field").style.display=type==="note"?"none":"block";
    document.querySelector("#living-transfer-field").style.display=type==="transfer"?"block":"none";
    document.querySelector("#living-estimated-wrap").style.display=type==="birth"?"flex":"none";
  };
  refresh();typeSelect.addEventListener("change",refresh);
  document.querySelector("#living-modal-close").addEventListener("click",closeModal);
  document.querySelector("#living-modal-cancel").addEventListener("click",closeModal);

  document.querySelector("#aquarium-event-form").addEventListener("submit",async e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const type=String(fd.get("type")||"");
    const date=String(fd.get("date")||todayISO());
    const notes=String(fd.get("notes")||"").trim();
    const speciesId=String(fd.get("speciesId")||"");
    const row=data.species.find(s=>s.id===speciesId);

    if(type==="note"){
      await putOne("livingEvents",{id:uid("living_event"),aquariumId,date,type,summary:notes||"Note",createdAt:new Date().toISOString()});
      closeModal();await renderCurrentView();return;
    }

    if(!row){alert("Choisis une espèce.");return;}

    if(type==="count"){
      const adults=Math.max(0,Number(fd.get("countAdults")||0));
      const juveniles=Math.max(0,Number(fd.get("countJuveniles")||0));
      const fry=Math.max(0,Number(fd.get("countFry")||0));
      await putOne("livingSpecies",{...row,adults,juveniles,fry,updatedAt:new Date().toISOString()});
      await putOne("livingEvents",{id:uid("living_event"),aquariumId,speciesId,date,type,summary:`${row.name} : ${adults} adultes · ${juveniles} juvéniles · ${fry} alevins${notes?` · ${notes}`:""}`,createdAt:new Date().toISOString()});
    } else {
      const quantity=Math.max(1,Number(fd.get("quantity")||1));
      const stage=String(fd.get("stage")||"adults");
      const estimated=fd.get("estimated")==="on";
      const positive=["birth","purchase"].includes(type);
      const next={...row};
      next[stage]=Math.max(0,Number(next[stage]||0)+(positive?quantity:-quantity));
      next.updatedAt=new Date().toISOString();

      if(type==="transfer"){
        const targetId=String(fd.get("targetAquariumId")||"");
        if(!targetId){alert("Choisis l'aquarium de destination.");return;}
        await putOne("livingSpecies",next);
        let target=(await getAll("livingSpecies")).find(s=>s.aquariumId===targetId&&String(s.name||"").toLowerCase()===String(row.name||"").toLowerCase());
        if(!target) target={id:uid("living_species"),aquariumId:targetId,name:row.name,adults:0,juveniles:0,fry:0,notes:"",createdAt:new Date().toISOString()};
        target={...target,[stage]:Number(target[stage]||0)+quantity,updatedAt:new Date().toISOString()};
        await putOne("livingSpecies",target);
        const targetAquarium=data.aquariums.find(a=>a.id===targetId);
        const summary=`${quantity} ${stageLabel(stage)} ${row.name} vers ${targetAquarium?.name||"un autre aquarium"}${notes?` · ${notes}`:""}`;
        await putOne("livingEvents",{id:uid("living_event"),aquariumId,speciesId,date,type,quantity,stage,targetAquariumId:targetId,summary,createdAt:new Date().toISOString()});
        await putOne("livingEvents",{id:uid("living_event"),aquariumId:targetId,speciesId:target.id,date,type,quantity,stage,sourceAquariumId:aquariumId,summary:`Réception de ${quantity} ${stageLabel(stage)} ${row.name} depuis ${aquarium.name}`,createdAt:new Date().toISOString()});
      } else {
        await putOne("livingSpecies",next);
        const verb=type==="birth"?"Naissance":type==="purchase"?"Ajout":type==="death"?"Décès":type==="donation"?"Don":type==="sale"?"Vente":type;
        const summary=`${verb} : ${quantity}${estimated?" environ":""} ${stageLabel(stage)} ${row.name}${notes?` · ${notes}`:""}`;
        await putOne("livingEvents",{id:uid("living_event"),aquariumId,speciesId,date,type,quantity,stage,estimated,summary,createdAt:new Date().toISOString()});
      }
    }

    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrentView();
  });
}

async function showCareModal(entityType,entityId,planId=null) {
  const plan=planId?await getOne("livingCarePlans",planId):null;
  const entity=entityType==="plant"?await getOne("livingPlants",entityId):await getOne("livingAquariums",entityId);

  openModal(`
    <div class="modal-head"><div><p class="eyebrow">SOIN RÉCURRENT</p><h2>${plan?"Modifier":"Nouveau"} rythme</h2></div><button class="icon-btn" id="living-modal-close">×</button></div>
    <form class="form-grid" id="living-care-form">
      <div class="field"><label>Action</label><input name="title" required value="${escapeHtml(plan?.title||"")}" placeholder="${entityType==="plant"?"Ex : Engrais Monstera":"Ex : Nettoyer le filtre"}"></div>
      <div class="row"><div class="field"><label>Tous les X jours</label><input name="frequencyDays" required type="number" min="1" max="3650" value="${plan?.frequencyDays??30}"></div><div class="field"><label>Prochaine date</label><input name="nextDueDate" required type="date" value="${plan?.nextDueDate||todayISO()}"></div></div>
      <div class="field"><label>Notes</label><textarea name="notes">${escapeHtml(plan?.notes||"")}</textarea></div>
      <div class="actions"><button class="ghost-btn" type="button" id="living-modal-cancel">Annuler</button><button class="primary-btn">Enregistrer</button></div>
      ${plan?`<button class="danger-btn" type="button" id="living-delete-care">Supprimer ce rythme</button>`:""}
    </form>`);
  document.querySelector("#living-modal-close").addEventListener("click",closeModal);
  document.querySelector("#living-modal-cancel").addEventListener("click",closeModal);
  document.querySelector("#living-care-form").addEventListener("submit",async e=>{
    e.preventDefault();const fd=new FormData(e.target);
    const saved={...(plan||{}),id:plan?.id||uid("living_care"),entityType,entityId,category:plan?.category||"care",title:String(fd.get("title")||"").trim(),frequencyDays:Math.max(1,Number(fd.get("frequencyDays")||1)),nextDueDate:String(fd.get("nextDueDate")||todayISO()),notes:String(fd.get("notes")||"").trim(),active:true,createdAt:plan?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
    if(plan) await deleteLivingCareTasksForPlan(plan.id);
    await putOne("livingCarePlans",saved);await syncLivingCareTasks();
    closeModal();window.dispatchEvent(new CustomEvent("myhub:data-changed"));await renderCurrentView();
  });
  document.querySelector("#living-delete-care")?.addEventListener("click",async()=>{
    if(!confirm("Supprimer ce rythme de soin ?"))return;
    await deleteLivingCareTasksForPlan(plan.id);await deleteOne("livingCarePlans",plan.id);closeModal();await renderCurrentView();
  });
}

export async function getLivingSummary() {
  return getLivingCareSummary();
}
