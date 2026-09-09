import { getAll, getOne, putOne, deleteOne } from "../core/db.js";
import { escapeHtml, uid, openModal, closeModal, todayISO } from "../core/ui.js";
import { syncPeopleReminderTasks } from "../core/people_tasks.js";

let currentView = "today";
let currentPersonId = null;
let searchQuery = "";
let groupFilter = "all";
let lastContainer = null;

function normalize(value="") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
}

function personName(person) {
  return [person?.firstName, person?.lastName].filter(Boolean).join(" ").trim() || person?.nickname || "Sans nom";
}

function initials(person) {
  const values=[person?.firstName,person?.lastName].filter(Boolean);
  return (values.map(v=>String(v).trim()[0]).join("").slice(0,2) || "?").toUpperCase();
}

function localDate(dateString) {
  return new Date(`${dateString}T12:00:00`);
}

function iso(date) {
  const d=new Date(date);
  const offset=d.getTimezoneOffset();
  return new Date(d.getTime()-offset*60000).toISOString().slice(0,10);
}

function addDays(dateString, days) {
  const d=localDate(dateString);
  d.setDate(d.getDate()+Number(days||0));
  return iso(d);
}

function diffDays(a,b) {
  return Math.round((localDate(b)-localDate(a))/86400000);
}

function nextAnnual(dateString, from=todayISO()) {
  if (!dateString) return null;
  const parts=String(dateString).split("-");
  if (parts.length!==3) return null;
  let year=localDate(from).getFullYear();
  let candidate=`${year}-${parts[1]}-${parts[2]}`;
  if (candidate<from) candidate=`${year+1}-${parts[1]}-${parts[2]}`;
  return candidate;
}

function formatDate(dateString, withYear=true) {
  if (!dateString) return "—";
  return new Intl.DateTimeFormat("fr-FR", withYear
    ? {day:"numeric",month:"long",year:"numeric"}
    : {day:"numeric",month:"long"}
  ).format(localDate(dateString));
}

function ageOnBirthday(birthday, occurrence) {
  if (!birthday || !occurrence) return null;
  return Number(occurrence.slice(0,4))-Number(birthday.slice(0,4));
}

function relationOther(rel, personId) {
  return rel.personAId===personId ? rel.personBId : rel.personAId;
}

async function getData() {
  const [people,groups,relations,events]=await Promise.all([
    getAll("people"),getAll("peopleGroups"),getAll("peopleRelations"),getAll("peopleEvents")
  ]);
  return {
    people:people.filter(p=>p.active!==false).sort((a,b)=>personName(a).localeCompare(personName(b),"fr")),
    groups:groups.filter(g=>g.active!==false).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"fr")),
    relations:relations.filter(r=>r.active!==false),
    events:events.filter(e=>e.active!==false)
  };
}

async function removeOpenReminderTasks({ personId = null, eventId = null, type = null } = {}) {
  const tasks = await getAll("tasks");
  for (const task of tasks) {
    if (task.done || task.source !== "people-reminder") continue;
    if (personId && task.personId !== personId) continue;
    if (eventId && task.peopleEventId !== eventId) continue;
    if (type && task.peopleReminderType !== type) continue;
    await deleteOne("tasks", task.id);
  }
}

function tabs(active) {
  return `<div class="people-tabs">
    <button class="people-tab ${active==="today"?"active":""}" data-people-view="today">Aujourd'hui</button>
    <button class="people-tab ${active==="people"?"active":""}" data-people-view="people">Personnes</button>
    <button class="people-tab ${active==="groups"?"active":""}" data-people-view="groups">Groupes</button>
    <button class="people-tab ${active==="relations"?"active":""}" data-people-view="relations">Relations</button>
  </div>`;
}

function bindTabs(shell) {
  shell.querySelectorAll("[data-people-view]").forEach(btn=>btn.addEventListener("click",async()=>{
    currentView=btn.dataset.peopleView;
    currentPersonId=null;
    await renderCurrent();
  }));
}

function avatar(person, className="people-avatar") {
  if (person.photo) return `<img class="${className}" src="${person.photo}" alt="">`;
  return `<div class="${className} people-avatar-fallback">${escapeHtml(initials(person))}</div>`;
}

export async function renderPeople(container) {
  lastContainer=container;
  container.innerHTML=`<section id="people-shell" class="people-shell"></section>`;
  await syncPeopleReminderTasks();
  await renderCurrent();
}

export function requestNewPerson() {
  window.dispatchEvent(new CustomEvent("myhub:navigate",{detail:"people"}));
  setTimeout(()=>showPersonModal(),120);
}

async function renderCurrent() {
  if (!lastContainer) return;
  const shell=lastContainer.querySelector("#people-shell")||lastContainer;
  if (currentView==="detail" && currentPersonId) return renderPersonDetail(shell,currentPersonId);
  if (currentView==="people") return renderPeopleList(shell);
  if (currentView==="groups") return renderGroups(shell);
  if (currentView==="relations") return renderRelations(shell);
  return renderToday(shell);
}

async function renderToday(shell) {
  const data=await getData();
  const today=todayISO();
  const horizon=addDays(today,30);
  const upcoming=[];

  for (const person of data.people) {
    if (!person.birthday) continue;
    const date=nextAnnual(person.birthday,today);
    if (date && date<=horizon) {
      upcoming.push({
        kind:"birthday",date,person,
        title:`Anniversaire de ${personName(person)}`,
        detail:(()=>{const age=ageOnBirthday(person.birthday,date); return age ? `${age} ans` : "Anniversaire";})()
      });
    }
  }

  for (const event of data.events) {
    const person=data.people.find(p=>p.id===event.personId);
    if (!person) continue;
    let date=event.date;
    if (event.recurrence==="yearly") date=nextAnnual(event.date,today);
    if (date && date>=today && date<=horizon) {
      upcoming.push({kind:"event",date,person,title:event.title||"Événement",detail:personName(person)});
    }
  }

  upcoming.sort((a,b)=>a.date.localeCompare(b.date));

  shell.innerHTML=`
    ${tabs("today")}
    <section class="people-hero">
      <div>
        <p class="eyebrow">MÉMOIRE RELATIONNELLE</p>
        <h2>${data.people.length} personne${data.people.length===1?"":"s"}</h2>
        <p>Anniversaires, événements importants, groupes et liens entre tes proches.</p>
      </div>
      <button class="primary-btn" id="people-add-person">+ Personne</button>
    </section>

    <section class="section">
      <div class="section-head"><div><h3>À venir</h3><p class="muted" style="margin:3px 0 0">Les 30 prochains jours</p></div></div>
      <div class="people-upcoming-list">
        ${upcoming.length ? upcoming.map(item=>{
          const days=diffDays(today,item.date);
          return `<button class="people-upcoming-row" data-person-id="${item.person.id}">
            ${avatar(item.person,"people-avatar small")}
            <span class="people-upcoming-main">
              <strong>${item.kind==="birthday"?"🎂":"👤"} ${escapeHtml(item.title)}</strong>
              <small>${escapeHtml(formatDate(item.date,false))} · ${days===0?"Aujourd'hui":days===1?"Demain":`dans ${days} jours`} · ${escapeHtml(item.detail)}</small>
            </span>
            <span>›</span>
          </button>`;
        }).join("") : `<div class="empty">Aucun anniversaire ou événement enregistré dans les 30 prochains jours.</div>`}
      </div>
    </section>

    <section class="section">
      <div class="people-mini-stats">
        <article><span>Groupes</span><strong>${data.groups.length}</strong></article>
        <article><span>Relations</span><strong>${data.relations.length}</strong></article>
        <article><span>Événements</span><strong>${data.events.length}</strong></article>
      </div>
    </section>
  `;
  bindTabs(shell);
  shell.querySelector("#people-add-person").addEventListener("click",()=>showPersonModal());
  shell.querySelectorAll("[data-person-id]").forEach(btn=>btn.addEventListener("click",async()=>{
    currentPersonId=btn.dataset.personId;currentView="detail";await renderCurrent();
  }));
}

function enrichedPersonSearch(person,data) {
  const groupNames=(person.groupIds||[]).map(id=>data.groups.find(g=>g.id===id)?.name||"");
  const relNames=data.relations
    .filter(r=>r.personAId===person.id||r.personBId===person.id)
    .map(r=>personName(data.people.find(p=>p.id===relationOther(r,person.id)))+" "+(r.type||""));
  const eventWords=data.events.filter(e=>e.personId===person.id).flatMap(e=>[e.title,e.notes]);
  return normalize([
    person.firstName,person.lastName,person.nickname,person.howKnown,person.profession,
    person.city,person.phone,person.email,person.notes,person.birthdayNote,
    ...groupNames,...relNames,...eventWords
  ].filter(Boolean).join(" "));
}

async function renderPeopleList(shell) {
  const data=await getData();
  const q=normalize(searchQuery);
  let people=data.people;

  if (groupFilter!=="all") people=people.filter(p=>(p.groupIds||[]).includes(groupFilter));
  if (q) people=people.filter(p=>enrichedPersonSearch(p,data).includes(q));

  shell.innerHTML=`
    ${tabs("people")}
    <div class="people-toolbar">
      <div class="people-search">
        <span>⌕</span>
        <input id="people-search-input" type="search" value="${escapeHtml(searchQuery)}" placeholder="Nom, groupe, métier, mot dans les notes…" autocomplete="off">
      </div>
      <button class="primary-btn" id="people-add-person">+ Personne</button>
    </div>
    <div class="pills people-group-filter">
      <button class="pill ${groupFilter==="all"?"active":""}" data-group-filter="all">Tous</button>
      ${data.groups.map(g=>`<button class="pill ${groupFilter===g.id?"active":""}" data-group-filter="${g.id}">${escapeHtml(g.name)}</button>`).join("")}
    </div>
    <div class="people-list">
      ${people.length ? people.map(person=>{
        const groups=(person.groupIds||[]).map(id=>data.groups.find(g=>g.id===id)).filter(Boolean);
        return `<button class="people-row" data-person-id="${person.id}">
          ${avatar(person)}
          <span class="people-row-main">
            <strong>${escapeHtml(personName(person))}</strong>
            <small>${escapeHtml([person.nickname?`« ${person.nickname} »`:"",person.howKnown,person.profession,person.city].filter(Boolean).join(" · ")||"Aucun contexte renseigné")}</small>
            ${groups.length?`<span class="people-row-groups">${groups.slice(0,3).map(g=>`<em>${escapeHtml(g.name)}</em>`).join("")}${groups.length>3?`<em>+${groups.length-3}</em>`:""}</span>`:""}
          </span>
          <span class="people-chevron">›</span>
        </button>`;
      }).join("") : `<div class="empty">Aucune personne ne correspond à cette recherche.</div>`}
    </div>
  `;
  bindTabs(shell);

  let timer;
  const input=shell.querySelector("#people-search-input");
  input.addEventListener("input",()=>{
    clearTimeout(timer);searchQuery=input.value;timer=setTimeout(()=>renderPeopleList(shell),140);
  });
  shell.querySelector("#people-add-person").addEventListener("click",()=>showPersonModal());
  shell.querySelectorAll("[data-group-filter]").forEach(btn=>btn.addEventListener("click",async()=>{
    groupFilter=btn.dataset.groupFilter;await renderPeopleList(shell);
  }));
  shell.querySelectorAll("[data-person-id]").forEach(btn=>btn.addEventListener("click",async()=>{
    currentPersonId=btn.dataset.personId;currentView="detail";await renderCurrent();
  }));
}

async function renderPersonDetail(shell,id) {
  const data=await getData();
  const person=data.people.find(p=>p.id===id);
  if (!person) {currentView="people";return renderPeopleList(shell);}
  const groups=(person.groupIds||[]).map(gid=>data.groups.find(g=>g.id===gid)).filter(Boolean);
  const relations=data.relations.filter(r=>r.personAId===id||r.personBId===id);
  const events=data.events.filter(e=>e.personId===id).sort((a,b)=>String(a.date||"").localeCompare(String(b.date||"")));
  const birthdayNext=person.birthday?nextAnnual(person.birthday):null;

  shell.innerHTML=`
    <div class="people-detail-top">
      <button class="ghost-btn" id="people-back">← Personnes</button>
      <button class="ghost-btn" id="people-edit">Modifier</button>
    </div>
    <section class="people-profile-card">
      ${avatar(person,"people-avatar large")}
      <div class="people-profile-main">
        <p class="eyebrow">PERSONNE</p>
        <h2>${escapeHtml(personName(person))}</h2>
        ${person.nickname?`<p class="people-nickname">« ${escapeHtml(person.nickname)} »</p>`:""}
        <p class="muted">${escapeHtml([person.profession,person.city].filter(Boolean).join(" · ")||"")}</p>
      </div>
    </section>

    <section class="people-info-grid">
      <article><span>Je la connais par</span><strong>${escapeHtml(person.howKnown||"—")}</strong></article>
      <article><span>Anniversaire</span><strong>${person.birthday?escapeHtml(formatDate(person.birthday,false)):"—"}</strong>${birthdayNext?`<small>Prochain : ${escapeHtml(formatDate(birthdayNext))}</small>`:""}</article>
      <article><span>Téléphone</span><strong>${escapeHtml(person.phone||"—")}</strong></article>
      <article><span>E-mail</span><strong>${escapeHtml(person.email||"—")}</strong></article>
    </section>

    <section class="section">
      <div class="section-head"><h3>Groupes</h3></div>
      <div class="people-chip-wrap">${groups.length?groups.map(g=>`<span class="people-chip">${escapeHtml(g.name)}</span>`).join(""):`<span class="muted">Aucun groupe.</span>`}</div>
    </section>

    <section class="section">
      <div class="section-head"><h3>Notes</h3></div>
      <div class="people-notes">${person.notes?escapeHtml(person.notes).replace(/\n/g,"<br>"):`<span class="muted">Aucune note.</span>`}</div>
    </section>

    <section class="section">
      <div class="section-head"><h3>Relations</h3><button class="ghost-btn" id="people-add-relation">+ Relation</button></div>
      <div class="people-relations-list">
        ${relations.length?relations.map(rel=>{
          const other=data.people.find(p=>p.id===relationOther(rel,id));
          return `<button class="people-relation-row" data-person-id="${other?.id||""}">
            <span><strong>${escapeHtml(personName(other))}</strong><small>${escapeHtml(rel.type||"Connaît")}${rel.notes?` · ${escapeHtml(rel.notes)}`:""}</small></span><span>›</span>
          </button>`;
        }).join(""):`<div class="empty">Aucune relation enregistrée.</div>`}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h3>Événements</h3><button class="ghost-btn" id="people-add-event">+ Événement</button></div>
      <div class="people-events-list">
        ${events.length?events.map(event=>`<article class="people-event-row">
          <div><strong>${escapeHtml(event.title||"Événement")}</strong><small>${escapeHtml(formatDate(event.date))}${event.recurrence==="yearly"?" · annuel":""} · rappel ${Number(event.reminderDays??1)} j avant</small>${event.notes?`<p>${escapeHtml(event.notes)}</p>`:""}</div>
          <div class="people-row-actions"><button class="task-mini-btn" data-edit-event="${event.id}">Modifier</button><button class="task-mini-btn danger" data-delete-event="${event.id}">Supprimer</button></div>
        </article>`).join(""):`<div class="empty">Aucun événement enregistré.</div>`}
      </div>
    </section>

    <section class="section">
      <button class="danger-btn" id="people-delete-person">Supprimer cette personne</button>
    </section>
  `;

  shell.querySelector("#people-back").addEventListener("click",async()=>{currentView="people";currentPersonId=null;await renderCurrent();});
  shell.querySelector("#people-edit").addEventListener("click",()=>showPersonModal(person));
  shell.querySelector("#people-add-relation").addEventListener("click",()=>showRelationModal({personAId:id}));
  shell.querySelector("#people-add-event").addEventListener("click",()=>showEventModal({personId:id}));
  shell.querySelectorAll(".people-relation-row[data-person-id]").forEach(btn=>btn.addEventListener("click",async()=>{
    if (!btn.dataset.personId) return;currentPersonId=btn.dataset.personId;await renderCurrent();
  }));
  shell.querySelectorAll("[data-edit-event]").forEach(btn=>btn.addEventListener("click",()=>showEventModal(events.find(e=>e.id===btn.dataset.editEvent))));
  shell.querySelectorAll("[data-delete-event]").forEach(btn=>btn.addEventListener("click",async()=>{
    if(!confirm("Supprimer cet événement ?"))return;
    await removeOpenReminderTasks({ eventId: btn.dataset.deleteEvent });
    await deleteOne("peopleEvents",btn.dataset.deleteEvent);
    await renderCurrent();window.dispatchEvent(new CustomEvent("myhub:data-changed"));
  }));
  shell.querySelector("#people-delete-person").addEventListener("click",async()=>{
    if(!confirm(`Supprimer ${personName(person)} et ses événements/relations ?`))return;
    await removeOpenReminderTasks({ personId: person.id });
    for(const rel of relations) await deleteOne("peopleRelations",rel.id);
    for(const event of events) await deleteOne("peopleEvents",event.id);
    await deleteOne("people",person.id);
    currentView="people";currentPersonId=null;
    await renderCurrent();window.dispatchEvent(new CustomEvent("myhub:data-changed"));
  });
}

async function renderGroups(shell) {
  const data=await getData();
  shell.innerHTML=`
    ${tabs("groups")}
    <div class="section-head people-section-head"><div><h2>Groupes personnalisés</h2><p class="muted">Crée librement tes cercles : boulot, village, amis de Clem…</p></div><button class="primary-btn" id="people-add-group">+ Groupe</button></div>
    <div class="people-groups-grid">
      ${data.groups.length?data.groups.map(group=>{
        const members=data.people.filter(p=>(p.groupIds||[]).includes(group.id));
        return `<article class="people-group-card">
          <div class="people-group-head"><div><strong>${escapeHtml(group.name)}</strong><small>${members.length} personne${members.length===1?"":"s"}</small></div><button class="task-mini-btn" data-edit-group="${group.id}">Modifier</button></div>
          ${group.notes?`<p>${escapeHtml(group.notes)}</p>`:""}
          <div class="people-group-members">${members.slice(0,8).map(p=>`<button data-person-id="${p.id}">${avatar(p,"people-avatar tiny")}<span>${escapeHtml(personName(p))}</span></button>`).join("")}${!members.length?`<span class="muted">Aucun membre.</span>`:""}</div>
          <button class="task-mini-btn danger" data-delete-group="${group.id}">Supprimer le groupe</button>
        </article>`;
      }).join(""):`<div class="empty">Aucun groupe. Crée ton premier groupe personnalisé.</div>`}
    </div>
  `;
  bindTabs(shell);
  shell.querySelector("#people-add-group").addEventListener("click",()=>showGroupModal());
  shell.querySelectorAll("[data-edit-group]").forEach(btn=>btn.addEventListener("click",()=>showGroupModal(data.groups.find(g=>g.id===btn.dataset.editGroup))));
  shell.querySelectorAll("[data-delete-group]").forEach(btn=>btn.addEventListener("click",async()=>{
    const group=data.groups.find(g=>g.id===btn.dataset.deleteGroup);
    if(!group||!confirm(`Supprimer le groupe « ${group.name} » ? Les personnes ne seront pas supprimées.`))return;
    for(const person of data.people.filter(p=>(p.groupIds||[]).includes(group.id))) {
      await putOne("people",{...person,groupIds:(person.groupIds||[]).filter(id=>id!==group.id),updatedAt:new Date().toISOString()});
    }
    await deleteOne("peopleGroups",group.id);
    await renderGroups(shell);window.dispatchEvent(new CustomEvent("myhub:data-changed"));
  }));
  shell.querySelectorAll("[data-person-id]").forEach(btn=>btn.addEventListener("click",async()=>{currentPersonId=btn.dataset.personId;currentView="detail";await renderCurrent();}));
}

async function renderRelations(shell) {
  const data=await getData();
  shell.innerHTML=`
    ${tabs("relations")}
    <div class="section-head people-section-head"><div><h2>Relations</h2><p class="muted">Qui connaît qui, et comment.</p></div><button class="primary-btn" id="people-add-relation">+ Relation</button></div>
    <div class="people-relations-list">
      ${data.relations.length?data.relations.map(rel=>{
        const a=data.people.find(p=>p.id===rel.personAId),b=data.people.find(p=>p.id===rel.personBId);
        if(!a||!b)return "";
        return `<article class="people-relation-card">
          <button data-person-id="${a.id}">${avatar(a,"people-avatar small")}<strong>${escapeHtml(personName(a))}</strong></button>
          <div class="people-relation-type"><span>${escapeHtml(rel.type||"Connaît")}</span>${rel.notes?`<small>${escapeHtml(rel.notes)}</small>`:""}</div>
          <button data-person-id="${b.id}">${avatar(b,"people-avatar small")}<strong>${escapeHtml(personName(b))}</strong></button>
          <div class="people-row-actions"><button class="task-mini-btn" data-edit-relation="${rel.id}">Modifier</button><button class="task-mini-btn danger" data-delete-relation="${rel.id}">Supprimer</button></div>
        </article>`;
      }).join(""):`<div class="empty">Aucune relation enregistrée.</div>`}
    </div>
  `;
  bindTabs(shell);
  shell.querySelector("#people-add-relation").addEventListener("click",()=>showRelationModal());
  shell.querySelectorAll("[data-edit-relation]").forEach(btn=>btn.addEventListener("click",()=>showRelationModal(data.relations.find(r=>r.id===btn.dataset.editRelation))));
  shell.querySelectorAll("[data-delete-relation]").forEach(btn=>btn.addEventListener("click",async()=>{if(confirm("Supprimer cette relation ?")){await deleteOne("peopleRelations",btn.dataset.deleteRelation);await renderRelations(shell);}}));
  shell.querySelectorAll("[data-person-id]").forEach(btn=>btn.addEventListener("click",async()=>{currentPersonId=btn.dataset.personId;currentView="detail";await renderCurrent();}));
}

async function fileToDataUrl(file) {
  if (!file) return "";
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||""));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);
  });
}

async function showPersonModal(person={}) {
  const groups=(await getAll("peopleGroups")).filter(g=>g.active!==false).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"fr"));
  openModal(`
    <div class="modal-head"><div><p class="eyebrow">PERSONNE</p><h2>${person.id?"Modifier":"Nouvelle personne"}</h2></div><button class="icon-btn" id="people-modal-close">×</button></div>
    <form class="form-grid" id="people-person-form">
      <div class="row"><div class="field"><label>Prénom</label><input name="firstName" value="${escapeHtml(person.firstName||"")}" required></div><div class="field"><label>Nom</label><input name="lastName" value="${escapeHtml(person.lastName||"")}"></div></div>
      <div class="field"><label>Surnom</label><input name="nickname" value="${escapeHtml(person.nickname||"")}" placeholder="Facultatif"></div>
      <div class="row"><div class="field"><label>Anniversaire</label><input type="date" name="birthday" value="${escapeHtml(person.birthday||"")}"></div><div class="field"><label>Rappel anniversaire</label><select name="birthdayReminderDays">${[0,1,3,7,14].map(v=>`<option value="${v}" ${Number(person.birthdayReminderDays??7)===v?"selected":""}>${v===0?"Le jour même":`${v} j avant`}</option>`).join("")}</select></div></div>
      <div class="field"><label>D'où je la connais</label><input name="howKnown" value="${escapeHtml(person.howKnown||"")}" placeholder="Boulot, village, via Clem, école…"></div>
      <div class="row"><div class="field"><label>Profession</label><input name="profession" value="${escapeHtml(person.profession||"")}"></div><div class="field"><label>Ville</label><input name="city" value="${escapeHtml(person.city||"")}"></div></div>
      <div class="row"><div class="field"><label>Téléphone</label><input name="phone" value="${escapeHtml(person.phone||"")}"></div><div class="field"><label>E-mail</label><input type="email" name="email" value="${escapeHtml(person.email||"")}"></div></div>
      <div class="field"><label>Groupes</label><div class="people-group-checks">${groups.length?groups.map(g=>`<label><input type="checkbox" name="groupIds" value="${g.id}" ${(person.groupIds||[]).includes(g.id)?"checked":""}> <span>${escapeHtml(g.name)}</span></label>`).join(""):`<span class="muted">Crée d'abord un groupe dans l'onglet Groupes si besoin.</span>`}</div></div>
      <div class="field"><label>Notes</label><textarea name="notes" placeholder="Tout ce que tu veux retenir. Chaque mot sera recherchable.">${escapeHtml(person.notes||"")}</textarea></div>
      <div class="field"><label>Photo</label><input type="file" name="photoFile" accept="image/*"><small class="muted">Facultatif. La photo reste stockée localement dans MyHub.</small></div>
      ${person.photo?`<label class="people-remove-photo"><input type="checkbox" name="removePhoto"> Supprimer la photo actuelle</label>`:""}
      <div class="actions"><button type="button" class="ghost-btn" id="people-modal-cancel">Annuler</button><button class="primary-btn">Enregistrer</button></div>
    </form>
  `);
  document.querySelector("#people-modal-close").addEventListener("click",closeModal);
  document.querySelector("#people-modal-cancel").addEventListener("click",closeModal);
  document.querySelector("#people-person-form").addEventListener("submit",async e=>{
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    const selectedGroups=[...e.currentTarget.querySelectorAll('input[name="groupIds"]:checked')].map(i=>i.value);
    const file=e.currentTarget.elements.photoFile.files?.[0];
    let photo=person.photo||"";
    if (e.currentTarget.elements.removePhoto?.checked) photo="";
    if (file) photo=await fileToDataUrl(file);
    const now=new Date().toISOString();
    const row={
      ...person,
      id:person.id||uid("person"),
      firstName:String(fd.get("firstName")||"").trim(),
      lastName:String(fd.get("lastName")||"").trim(),
      nickname:String(fd.get("nickname")||"").trim(),
      birthday:String(fd.get("birthday")||""),
      birthdayReminderDays:Number(fd.get("birthdayReminderDays")||7),
      howKnown:String(fd.get("howKnown")||"").trim(),
      profession:String(fd.get("profession")||"").trim(),
      city:String(fd.get("city")||"").trim(),
      phone:String(fd.get("phone")||"").trim(),
      email:String(fd.get("email")||"").trim(),
      groupIds:selectedGroups,
      notes:String(fd.get("notes")||"").trim(),
      photo,
      active:true,
      createdAt:person.createdAt||now,
      updatedAt:now
    };
    if (person.id) await removeOpenReminderTasks({ personId: person.id, type: "birthday" });
    await putOne("people",row);
    closeModal();currentPersonId=row.id;currentView="detail";
    await syncPeopleReminderTasks();await renderCurrent();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
  });
}

async function showGroupModal(group={}) {
  openModal(`
    <div class="modal-head"><div><p class="eyebrow">GROUPE</p><h2>${group.id?"Modifier":"Nouveau groupe"}</h2></div><button class="icon-btn" id="people-modal-close">×</button></div>
    <form class="form-grid" id="people-group-form">
      <div class="field"><label>Nom du groupe</label><input name="name" value="${escapeHtml(group.name||"")}" required placeholder="Village, Boulot, Groupe de Clem…"></div>
      <div class="field"><label>Notes</label><textarea name="notes">${escapeHtml(group.notes||"")}</textarea></div>
      <div class="actions"><button type="button" class="ghost-btn" id="people-modal-cancel">Annuler</button><button class="primary-btn">Enregistrer</button></div>
    </form>`);
  document.querySelector("#people-modal-close").addEventListener("click",closeModal);
  document.querySelector("#people-modal-cancel").addEventListener("click",closeModal);
  document.querySelector("#people-group-form").addEventListener("submit",async e=>{
    e.preventDefault();const fd=new FormData(e.currentTarget);const now=new Date().toISOString();
    await putOne("peopleGroups",{...group,id:group.id||uid("group"),name:String(fd.get("name")||"").trim(),notes:String(fd.get("notes")||"").trim(),active:true,createdAt:group.createdAt||now,updatedAt:now});
    closeModal();currentView="groups";await renderCurrent();window.dispatchEvent(new CustomEvent("myhub:data-changed"));
  });
}

async function showRelationModal(relation={}) {
  const people=(await getAll("people")).filter(p=>p.active!==false).sort((a,b)=>personName(a).localeCompare(personName(b),"fr"));
  if(people.length<2){alert("Il faut au moins deux personnes pour créer une relation.");return;}
  const types=["Ami(e) de","Conjoint(e) de","Famille de","Collègue de","Connaît","Voisin(e) de","Autre"];
  openModal(`
    <div class="modal-head"><div><p class="eyebrow">RELATION</p><h2>${relation.id?"Modifier":"Nouvelle relation"}</h2></div><button class="icon-btn" id="people-modal-close">×</button></div>
    <form class="form-grid" id="people-relation-form">
      <div class="field"><label>Personne 1</label><select name="personAId" required><option value="">Choisir</option>${people.map(p=>`<option value="${p.id}" ${relation.personAId===p.id?"selected":""}>${escapeHtml(personName(p))}</option>`).join("")}</select></div>
      <div class="field"><label>Type de lien</label><select name="typePreset">${types.map(t=>`<option value="${escapeHtml(t)}" ${relation.type===t?"selected":""}>${escapeHtml(t)}</option>`).join("")}</select></div>
      <div class="field"><label>Lien personnalisé</label><input name="customType" value="${types.includes(relation.type)?"":escapeHtml(relation.type||"")}" placeholder="Ex. frère de, ami d'enfance de…"></div>
      <div class="field"><label>Personne 2</label><select name="personBId" required><option value="">Choisir</option>${people.map(p=>`<option value="${p.id}" ${relation.personBId===p.id?"selected":""}>${escapeHtml(personName(p))}</option>`).join("")}</select></div>
      <div class="field"><label>Notes</label><textarea name="notes">${escapeHtml(relation.notes||"")}</textarea></div>
      <div class="actions"><button type="button" class="ghost-btn" id="people-modal-cancel">Annuler</button><button class="primary-btn">Enregistrer</button></div>
    </form>`);
  document.querySelector("#people-modal-close").addEventListener("click",closeModal);
  document.querySelector("#people-modal-cancel").addEventListener("click",closeModal);
  document.querySelector("#people-relation-form").addEventListener("submit",async e=>{
    e.preventDefault();const fd=new FormData(e.currentTarget);
    const a=String(fd.get("personAId")||""),b=String(fd.get("personBId")||"");
    if(a===b){alert("Choisis deux personnes différentes.");return;}
    const custom=String(fd.get("customType")||"").trim();
    const type=custom||String(fd.get("typePreset")||"Connaît");
    const now=new Date().toISOString();
    await putOne("peopleRelations",{...relation,id:relation.id||uid("relation"),personAId:a,personBId:b,type,notes:String(fd.get("notes")||"").trim(),active:true,createdAt:relation.createdAt||now,updatedAt:now});
    closeModal();await renderCurrent();window.dispatchEvent(new CustomEvent("myhub:data-changed"));
  });
}

async function showEventModal(event={}) {
  const people=(await getAll("people")).filter(p=>p.active!==false).sort((a,b)=>personName(a).localeCompare(personName(b),"fr"));
  if(!people.length){alert("Crée d'abord une personne.");return;}
  openModal(`
    <div class="modal-head"><div><p class="eyebrow">ÉVÉNEMENT</p><h2>${event.id?"Modifier":"Nouvel événement"}</h2></div><button class="icon-btn" id="people-modal-close">×</button></div>
    <form class="form-grid" id="people-event-form">
      <div class="field"><label>Personne</label><select name="personId" required>${people.map(p=>`<option value="${p.id}" ${event.personId===p.id?"selected":""}>${escapeHtml(personName(p))}</option>`).join("")}</select></div>
      <div class="field"><label>Événement</label><input name="title" value="${escapeHtml(event.title||"")}" required placeholder="Entretien, déménagement, opération, voyage…"></div>
      <div class="row"><div class="field"><label>Date</label><input type="date" name="date" value="${escapeHtml(event.date||todayISO())}" required></div><div class="field"><label>Répétition</label><select name="recurrence"><option value="none" ${event.recurrence!=="yearly"?"selected":""}>Une fois</option><option value="yearly" ${event.recurrence==="yearly"?"selected":""}>Tous les ans</option></select></div></div>
      <div class="field"><label>Me le rappeler</label><select name="reminderDays">${[0,1,3,7,14,30].map(v=>`<option value="${v}" ${Number(event.reminderDays??1)===v?"selected":""}>${v===0?"Le jour même":`${v} jours avant`}</option>`).join("")}</select></div>
      <div class="field"><label>Notes</label><textarea name="notes">${escapeHtml(event.notes||"")}</textarea></div>
      <div class="actions"><button type="button" class="ghost-btn" id="people-modal-cancel">Annuler</button><button class="primary-btn">Enregistrer</button></div>
    </form>`);
  document.querySelector("#people-modal-close").addEventListener("click",closeModal);
  document.querySelector("#people-modal-cancel").addEventListener("click",closeModal);
  document.querySelector("#people-event-form").addEventListener("submit",async e=>{
    e.preventDefault();const fd=new FormData(e.currentTarget);const now=new Date().toISOString();
    if (event.id) await removeOpenReminderTasks({ eventId: event.id });
    await putOne("peopleEvents",{...event,id:event.id||uid("pevent"),personId:String(fd.get("personId")||""),title:String(fd.get("title")||"").trim(),date:String(fd.get("date")||""),recurrence:String(fd.get("recurrence")||"none"),reminderDays:Number(fd.get("reminderDays")||0),notes:String(fd.get("notes")||"").trim(),active:true,createdAt:event.createdAt||now,updatedAt:now});
    closeModal();await syncPeopleReminderTasks();await renderCurrent();window.dispatchEvent(new CustomEvent("myhub:data-changed"));
  });
}

export async function getPeopleSummary() {
  await syncPeopleReminderTasks();
  const data=await getData();
  const today=todayISO();
  const rows=[];

  for(const person of data.people){
    if(!person.birthday)continue;
    const date=nextAnnual(person.birthday,today);
    if(date) rows.push({
      date,
      label:`Anniversaire de ${personName(person)}`,
      reminderDays:Number(person.birthdayReminderDays ?? 7)
    });
  }

  for(const event of data.events){
    const person=data.people.find(p=>p.id===event.personId);
    if(!person)continue;
    let date=event.date;
    if(event.recurrence==="yearly")date=nextAnnual(event.date,today);
    if(date&&date>=today) rows.push({
      date,
      label:`${event.title} · ${personName(person)}`,
      reminderDays:Number(event.reminderDays ?? 1)
    });
  }

  rows.sort((a,b)=>a.date.localeCompare(b.date));
  const attentionRows=rows.filter(row=>diffDays(today,row.date)<=Math.max(0,row.reminderDays));
  const upcoming=attentionRows.length;
  const nextLabel=attentionRows[0]?.label||null;
  const nextDate=attentionRows[0]?.date||null;

  return {
    people:data.people.length,
    groups:data.groups.length,
    relations:data.relations.length,
    events:data.events.length,
    upcoming,
    nextLabel,
    nextDate
  };
}
