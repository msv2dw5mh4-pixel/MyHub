import { getAll, getOne, putOne } from "../core/db.js";
import { escapeHtml, formatDate, todayISO, uid, openModal, closeModal } from "../core/ui.js";

const PREFIX = "timeclock_day_";
const CONFIG_ID = "timeclock_config";
let liveTimer = null;

function nowIso() {
  return new Date().toISOString();
}

function dayId(date) {
  return `${PREFIX}${date}`;
}

function localDate(date) {
  return new Date(`${date}T12:00:00`);
}

function localTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function localDateTime(date, time) {
  if (!date || !time) return null;
  return new Date(`${date}T${time}:00`).toISOString();
}

function timeInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function durationMs(start, end) {
  if (!start || !end) return 0;
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return b - a;
}

function humanDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours} h ${String(minutes).padStart(2, "0")}` : `${minutes} min`;
}

function decimalHours(ms) {
  return Math.round((ms / 3600000) * 100) / 100;
}

function lastKnownTime(day) {
  const values = [
    day?.arrivedAt,
    day?.departedAt,
    ...(day?.segments || []).flatMap(row => [row.start, row.end]),
    ...(day?.pauses || []).flatMap(row => [row.start, row.end])
  ].filter(Boolean);

  if (!values.length) return null;
  return values.sort((a, b) => new Date(a) - new Date(b)).at(-1);
}

function effectiveEnd(value, day, type) {
  if (value) return value;
  if (day?.date === todayISO()) {
    if (type === "work" && day.status === "working") return nowIso();
    if (type === "pause" && day.status === "paused") return nowIso();
  }
  return null;
}

function workMs(day) {
  return (day?.segments || []).reduce((sum, segment) => {
    return sum + durationMs(segment.start, effectiveEnd(segment.end, day, "work"));
  }, 0);
}

function pauseMs(day) {
  return (day?.pauses || []).reduce((sum, pause) => {
    return sum + durationMs(pause.start, effectiveEnd(pause.end, day, "pause"));
  }, 0);
}

function amplitudeMs(day) {
  if (!day?.arrivedAt) return 0;
  const end = day.departedAt || (day.date === todayISO() ? nowIso() : lastKnownTime(day));
  return durationMs(day.arrivedAt, end);
}

function dayStatusLabel(day) {
  if (!day) return "Pas encore pointé";
  if (day.status === "working") return "En travail";
  if (day.status === "paused") return "En pause";
  if (day.status === "finished") return "Journée terminée";
  return "Pas encore pointé";
}

function dayStatusClass(day) {
  if (!day) return "idle";
  return day.status || "idle";
}

async function getConfig() {
  const row = await getOne("moduleData", CONFIG_ID).catch(() => null);
  return {
    id: CONFIG_ID,
    module: "timeclock",
    type: "config",
    lastLabel: row?.lastLabel || "Travail"
  };
}

async function saveLastLabel(label) {
  const clean = String(label || "").trim() || "Travail";
  await putOne("moduleData", {
    id: CONFIG_ID,
    module: "timeclock",
    type: "config",
    lastLabel: clean,
    updatedAt: nowIso()
  });
  return clean;
}

async function getDays() {
  return (await getAll("moduleData"))
    .filter(row => row?.module === "timeclock" && row?.type === "day")
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

async function getToday() {
  return getOne("moduleData", dayId(todayISO())).catch(() => null);
}

function weekBounds(date = todayISO()) {
  const d = localDate(date);
  const dow = d.getDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d);
  monday.setDate(d.getDate() + delta);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const toIso = value => {
    const offset = value.getTimezoneOffset();
    return new Date(value.getTime() - offset * 60000).toISOString().slice(0, 10);
  };

  return { start: toIso(monday), end: toIso(sunday) };
}

function monthBounds(date = todayISO()) {
  const d = localDate(date);
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 12);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);

  const toIso = value => {
    const offset = value.getTimezoneOffset();
    return new Date(value.getTime() - offset * 60000).toISOString().slice(0, 10);
  };

  return { start: toIso(start), end: toIso(end) };
}

function totalBetween(days, start, end) {
  return days
    .filter(day => day.date >= start && day.date <= end)
    .reduce((sum, day) => sum + workMs(day), 0);
}

function groupedLabels(days, start, end) {
  const map = new Map();

  for (const day of days.filter(row => row.date >= start && row.date <= end)) {
    for (const segment of day.segments || []) {
      const endValue = effectiveEnd(segment.end, day, "work");
      const ms = durationMs(segment.start, endValue);
      if (!ms) continue;
      const label = String(segment.label || "Travail").trim() || "Travail";
      map.set(label, (map.get(label) || 0) + ms);
    }
  }

  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, ms]) => ({ label, ms }));
}

async function punch(label) {
  const date = todayISO();
  const current = await getOne("moduleData", dayId(date)).catch(() => null);
  const time = nowIso();
  const cleanLabel = await saveLastLabel(label);

  if (!current || current.status === "finished") {
    const day = {
      id: dayId(date),
      module: "timeclock",
      type: "day",
      date,
      status: "working",
      arrivedAt: time,
      departedAt: null,
      segments: [{
        id: uid("timeclock_work"),
        label: cleanLabel,
        start: time,
        end: null
      }],
      pauses: [],
      createdAt: time,
      updatedAt: time
    };
    await putOne("moduleData", day);
    return day;
  }

  if (current.status === "working") {
    const segments = [...(current.segments || [])];
    const index = segments.findLastIndex(segment => !segment.end);
    if (index >= 0) segments[index] = { ...segments[index], end: time };

    const next = {
      ...current,
      status: "paused",
      segments,
      pauses: [
        ...(current.pauses || []),
        { id: uid("timeclock_pause"), start: time, end: null }
      ],
      updatedAt: time
    };
    await putOne("moduleData", next);
    return next;
  }

  if (current.status === "paused") {
    const pauses = [...(current.pauses || [])];
    const index = pauses.findLastIndex(pause => !pause.end);
    if (index >= 0) pauses[index] = { ...pauses[index], end: time };

    const next = {
      ...current,
      status: "working",
      pauses,
      segments: [
        ...(current.segments || []),
        {
          id: uid("timeclock_work"),
          label: cleanLabel,
          start: time,
          end: null
        }
      ],
      updatedAt: time
    };
    await putOne("moduleData", next);
    return next;
  }

  return current;
}

async function finishDay() {
  const day = await getToday();
  if (!day || day.status === "finished") return day;

  const time = nowIso();
  const segments = [...(day.segments || [])];
  const pauses = [...(day.pauses || [])];

  if (day.status === "working") {
    const index = segments.findLastIndex(segment => !segment.end);
    if (index >= 0) segments[index] = { ...segments[index], end: time };
  }

  if (day.status === "paused") {
    const index = pauses.findLastIndex(pause => !pause.end);
    if (index >= 0) pauses[index] = { ...pauses[index], end: time };
  }

  const next = {
    ...day,
    status: "finished",
    departedAt: time,
    segments,
    pauses,
    updatedAt: time
  };

  await putOne("moduleData", next);
  return next;
}

async function changeLabelNow(label) {
  const day = await getToday();
  if (!day || day.status !== "working") return;

  const cleanLabel = await saveLastLabel(label);
  const segments = [...(day.segments || [])];
  const currentIndex = segments.findLastIndex(segment => !segment.end);
  if (currentIndex < 0) return;

  const current = segments[currentIndex];
  if ((current.label || "Travail").trim() === cleanLabel) return;

  const time = nowIso();
  segments[currentIndex] = { ...current, end: time };
  segments.push({
    id: uid("timeclock_work"),
    label: cleanLabel,
    start: time,
    end: null
  });

  await putOne("moduleData", {
    ...day,
    segments,
    updatedAt: time
  });
}

function renderTimeline(day) {
  if (!day) return `<div class="timeclock-empty">Aucun pointage aujourd’hui.</div>`;

  const rows = [];

  for (const segment of day.segments || []) {
    rows.push({
      at: segment.start,
      icon: "▶",
      title: segment.label || "Travail",
      detail: `${localTime(segment.start)} → ${localTime(effectiveEnd(segment.end, day, "work"))}`,
      duration: humanDuration(durationMs(segment.start, effectiveEnd(segment.end, day, "work"))),
      type: "work"
    });
  }

  for (const pause of day.pauses || []) {
    rows.push({
      at: pause.start,
      icon: "Ⅱ",
      title: "Pause",
      detail: `${localTime(pause.start)} → ${localTime(effectiveEnd(pause.end, day, "pause"))}`,
      duration: humanDuration(durationMs(pause.start, effectiveEnd(pause.end, day, "pause"))),
      type: "pause"
    });
  }

  return rows
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .map(row => `
      <div class="timeclock-timeline-row ${row.type}">
        <span class="timeclock-timeline-icon">${row.icon}</span>
        <div>
          <strong>${escapeHtml(row.title)}</strong>
          <small>${row.detail}</small>
        </div>
        <b>${row.duration}</b>
      </div>
    `).join("");
}

function historyRow(day) {
  return `
    <button class="timeclock-history-row" data-timeclock-day="${day.id}">
      <div>
        <strong>${formatDate(day.date)}</strong>
        <small>${localTime(day.arrivedAt)} → ${localTime(day.departedAt || lastKnownTime(day))}</small>
      </div>
      <div>
        <b>${humanDuration(workMs(day))}</b>
        <small>${(day.segments || []).length} temps · ${(day.pauses || []).length} pause${(day.pauses || []).length > 1 ? "s" : ""}</small>
      </div>
    </button>
  `;
}

function currentAction(day) {
  if (!day || day.status === "finished") {
    return {
      label: "Pointer mon arrivée",
      hint: "Le premier clic démarre ta journée.",
      className: "arrival"
    };
  }

  if (day.status === "working") {
    return {
      label: "Début de pause",
      hint: "Le clic ferme le temps de travail en cours.",
      className: "pause"
    };
  }

  return {
    label: "Reprendre le travail",
    hint: "Le clic termine la pause et démarre un nouveau temps.",
    className: "resume"
  };
}

function startLiveRefresh(container) {
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = setInterval(() => {
    if (!document.body.contains(container)) {
      clearInterval(liveTimer);
      liveTimer = null;
      return;
    }

    const clock = container.querySelector("#timeclock-live-clock");
    if (clock) {
      clock.textContent = new Intl.DateTimeFormat("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }).format(new Date());
    }

    const elapsed = container.querySelector("#timeclock-live-work");
    const dayData = container._timeclockCurrentDay;
    if (elapsed && dayData) elapsed.textContent = humanDuration(workMs(dayData));
  }, 1000);
}

async function showDayEditor(day, container) {
  const segments = day.segments || [];
  const pauses = day.pauses || [];

  openModal(`
    <div class="modal-head">
      <div>
        <p class="eyebrow">BADGEUSE</p>
        <h2>Corriger le ${escapeHtml(formatDate(day.date))}</h2>
      </div>
      <button class="icon-btn" id="timeclock-edit-close">×</button>
    </div>

    <form class="form-grid" id="timeclock-edit-form">
      <div class="timeclock-edit-section">
        <strong>Temps de travail</strong>
        ${segments.length ? segments.map((segment, index) => `
          <div class="timeclock-edit-row">
            <div class="field timeclock-edit-label">
              <label>Nom</label>
              <input name="segmentLabel_${index}" maxlength="80" value="${escapeHtml(segment.label || "Travail")}">
            </div>
            <div class="field">
              <label>Début</label>
              <input type="time" name="segmentStart_${index}" value="${timeInputValue(segment.start)}" required>
            </div>
            <div class="field">
              <label>Fin</label>
              <input type="time" name="segmentEnd_${index}" value="${timeInputValue(segment.end)}">
            </div>
          </div>
        `).join("") : `<p class="muted">Aucun temps de travail.</p>`}
      </div>

      <div class="timeclock-edit-section">
        <strong>Pauses</strong>
        ${pauses.length ? pauses.map((pause, index) => `
          <div class="timeclock-edit-row pause">
            <div class="field">
              <label>Début</label>
              <input type="time" name="pauseStart_${index}" value="${timeInputValue(pause.start)}" required>
            </div>
            <div class="field">
              <label>Fin</label>
              <input type="time" name="pauseEnd_${index}" value="${timeInputValue(pause.end)}">
            </div>
          </div>
        `).join("") : `<p class="muted">Aucune pause.</p>`}
      </div>

      <div class="actions">
        <button type="button" class="ghost-btn" id="timeclock-edit-cancel">Annuler</button>
        <button class="primary-btn" type="submit">Enregistrer les corrections</button>
      </div>
    </form>
  `);

  document.querySelector("#timeclock-edit-close")?.addEventListener("click", closeModal);
  document.querySelector("#timeclock-edit-cancel")?.addEventListener("click", closeModal);

  document.querySelector("#timeclock-edit-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);

    const nextSegments = segments.map((segment, index) => ({
      ...segment,
      label: String(fd.get(`segmentLabel_${index}`) || "Travail").trim() || "Travail",
      start: localDateTime(day.date, String(fd.get(`segmentStart_${index}`) || "")),
      end: localDateTime(day.date, String(fd.get(`segmentEnd_${index}`) || ""))
    }));

    const nextPauses = pauses.map((pause, index) => ({
      ...pause,
      start: localDateTime(day.date, String(fd.get(`pauseStart_${index}`) || "")),
      end: localDateTime(day.date, String(fd.get(`pauseEnd_${index}`) || ""))
    }));

    for (const row of [...nextSegments, ...nextPauses]) {
      if (row.start && row.end && new Date(row.end) <= new Date(row.start)) {
        alert("Une heure de fin doit être postérieure à son heure de début.");
        return;
      }
    }

    const firstStart = nextSegments.map(row => row.start).filter(Boolean).sort()[0] || day.arrivedAt;
    const allEnds = [
      ...nextSegments.map(row => row.end),
      ...nextPauses.map(row => row.end)
    ].filter(Boolean).sort();
    const lastEnd = allEnds.at(-1) || day.departedAt;

    await putOne("moduleData", {
      ...day,
      segments: nextSegments,
      pauses: nextPauses,
      arrivedAt: firstStart,
      departedAt: day.status === "finished" ? lastEnd : day.departedAt,
      updatedAt: nowIso()
    });

    closeModal();
    await renderTimeclock(container);
  });
}

export async function renderTimeclock(container) {
  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = null;
  }

  const [days, today, config] = await Promise.all([
    getDays(),
    getToday(),
    getConfig()
  ]);

  const week = weekBounds();
  const month = monthBounds();
  const action = currentAction(today);
  const currentLabel =
    today?.status === "working"
      ? (today.segments || []).findLast(segment => !segment.end)?.label || config.lastLabel
      : config.lastLabel;

  const todayTotal = today ? workMs(today) : 0;
  const weekTotal = totalBetween(days, week.start, week.end);
  const monthTotal = totalBetween(days, month.start, month.end);
  const monthLabels = groupedLabels(days, month.start, month.end);

  container._timeclockCurrentDay = today;

  container.innerHTML = `
    <section class="timeclock-module">
      <div class="timeclock-hero ${dayStatusClass(today)}">
        <div class="timeclock-hero-top">
          <div>
            <p class="eyebrow">BADGEUSE</p>
            <h2 id="timeclock-live-clock">${new Intl.DateTimeFormat("fr-FR", { hour:"2-digit", minute:"2-digit", second:"2-digit" }).format(new Date())}</h2>
          </div>
          <span class="timeclock-state">${escapeHtml(dayStatusLabel(today))}</span>
        </div>

        <div class="timeclock-current">
          <span>Temps travaillé aujourd’hui</span>
          <strong id="timeclock-live-work">${humanDuration(todayTotal)}</strong>
          <small>${today?.arrivedAt ? `Arrivée ${localTime(today.arrivedAt)} · Pause ${humanDuration(pauseMs(today))}` : "Aucune arrivée enregistrée"}</small>
        </div>
      </div>

      <section class="timeclock-punch-card">
        <div class="field">
          <label for="timeclock-label">Nom du temps</label>
          <input id="timeclock-label" maxlength="80" value="${escapeHtml(currentLabel || "Travail")}" placeholder="Ex : IWS, TMA, Réunion, Administratif…">
        </div>

        <button class="timeclock-punch-btn ${action.className}" id="timeclock-punch">
          <span>${action.label}</span>
          <small>${action.hint}</small>
        </button>

        ${today && today.status !== "finished" ? `
          <div class="timeclock-secondary-actions">
            ${today.status === "working" ? `<button class="ghost-btn" id="timeclock-change-label">Changer de temps maintenant</button>` : ""}
            <button class="danger-btn" id="timeclock-finish-day">Terminer ma journée</button>
          </div>
        ` : ""}
      </section>

      <div class="timeclock-summary-grid">
        <article>
          <span>Aujourd’hui</span>
          <strong>${humanDuration(todayTotal)}</strong>
          <small>${today ? `${decimalHours(todayTotal).toLocaleString("fr-FR")} h` : "0 h"}</small>
        </article>
        <article>
          <span>Cette semaine</span>
          <strong>${humanDuration(weekTotal)}</strong>
          <small>${formatDate(week.start)} → ${formatDate(week.end)}</small>
        </article>
        <article>
          <span>Ce mois</span>
          <strong>${humanDuration(monthTotal)}</strong>
          <small>${decimalHours(monthTotal).toLocaleString("fr-FR")} h cumulées</small>
        </article>
      </div>

      ${today ? `
        <section class="timeclock-card">
          <div class="timeclock-section-head">
            <div>
              <h3>Aujourd’hui</h3>
              <p>Amplitude ${humanDuration(amplitudeMs(today))} · pauses ${humanDuration(pauseMs(today))}</p>
            </div>
            <button class="ghost-btn" id="timeclock-edit-today">Corriger</button>
          </div>
          <div class="timeclock-timeline">${renderTimeline(today)}</div>
        </section>
      ` : ""}

      ${monthLabels.length ? `
        <section class="timeclock-card">
          <div class="timeclock-section-head">
            <div>
              <h3>Temps par nom · ce mois</h3>
              <p>Répartition de tes heures selon le nom donné à chaque temps.</p>
            </div>
          </div>
          <div class="timeclock-label-summary">
            ${monthLabels.map(row => `
              <div>
                <span>${escapeHtml(row.label)}</span>
                <strong>${humanDuration(row.ms)}</strong>
              </div>
            `).join("")}
          </div>
        </section>
      ` : ""}

      <section class="timeclock-card">
        <div class="timeclock-section-head">
          <div>
            <h3>Historique</h3>
            <p>Les 30 derniers jours pointés. Touche une journée pour la corriger.</p>
          </div>
        </div>
        <div class="timeclock-history">
          ${days.length ? days.slice(0, 30).map(historyRow).join("") : `<div class="timeclock-empty">Ton historique apparaîtra ici après ton premier pointage.</div>`}
        </div>
      </section>

      <div class="timeclock-local-note">
        <strong>Indépendant et local</strong>
        <p>La Badgeuse n’alimente aucun autre module MyHub. Ses données restent sur ton appareil et sont incluses dans la sauvegarde MyHub.</p>
      </div>
    </section>
  `;

  const labelInput = container.querySelector("#timeclock-label");

  container.querySelector("#timeclock-punch")?.addEventListener("click", async () => {
    await punch(labelInput?.value);
    await renderTimeclock(container);
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
  });

  container.querySelector("#timeclock-change-label")?.addEventListener("click", async () => {
    const label = String(labelInput?.value || "").trim();
    if (!label) return alert("Donne un nom à ce temps.");
    await changeLabelNow(label);
    await renderTimeclock(container);
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
  });

  container.querySelector("#timeclock-finish-day")?.addEventListener("click", async () => {
    if (!confirm("Terminer ta journée maintenant ?")) return;
    await finishDay();
    await renderTimeclock(container);
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
  });

  container.querySelector("#timeclock-edit-today")?.addEventListener("click", () => {
    if (today) showDayEditor(today, container);
  });

  container.querySelectorAll("[data-timeclock-day]").forEach(button => {
    button.addEventListener("click", () => {
      const day = days.find(row => row.id === button.dataset.timeclockDay);
      if (day) showDayEditor(day, container);
    });
  });

  startLiveRefresh(container);
}

export async function getTimeclockSummary() {
  const days = await getDays();
  const week = weekBounds();
  const month = monthBounds();
  const today = days.find(day => day.date === todayISO());

  return {
    todayMs: today ? workMs(today) : 0,
    weekMs: totalBetween(days, week.start, week.end),
    monthMs: totalBetween(days, month.start, month.end),
    status: today?.status || "idle"
  };
}
