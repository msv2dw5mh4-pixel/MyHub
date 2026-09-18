import {
  getAll,
  getOne,
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

let currentView = "dashboard";
let selectedYear = new Date().getFullYear();
let calendarDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let currentBookingId = null;
let lastContainer = null;

const DEPOSIT_METHODS = ["Chèque", "Espèces", "Wero", "Autre"];
const DEPOSIT_STATUSES = [
  { id: "pending", label: "À recevoir" },
  { id: "received", label: "Reçue" },
  { id: "returned", label: "Rendue" },
  { id: "retained", label: "Retenue" }
];
const BOOKING_STATUSES = [
  { id: "reserved", label: "Réservée" },
  { id: "active", label: "En cours" },
  { id: "returned", label: "Terminée" },
  { id: "cancelled", label: "Annulée" }
];

function fmtMoney(value) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

function fmtDate(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(new Date(`${value}T12:00:00`));
  } catch {
    return value;
  }
}

function fmtShortDate(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "short"
    }).format(new Date(`${value}T12:00:00`));
  } catch {
    return value;
  }
}

function bookingDurationDays(booking) {
  if (!booking?.startDate || !booking?.endDate) return 0;
  const start = new Date(`${booking.startDate}T12:00:00`);
  const end = new Date(`${booking.endDate}T12:00:00`);
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function isDateWithin(date, start, end) {
  return date >= start && date <= end;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

function statusMeta(booking) {
  const today = todayISO();
  if (booking.status === "cancelled") return { id: "cancelled", label: "Annulée" };
  if (booking.status === "returned") return { id: "returned", label: "Terminée" };
  if (booking.status === "active") return { id: "active", label: "En cours" };

  if (booking.startDate <= today && booking.endDate >= today) {
    return { id: "active", label: "En cours" };
  }
  if (booking.endDate < today) return { id: "late", label: "Retour à confirmer" };
  return { id: "reserved", label: "Réservée" };
}

function depositStatusLabel(value) {
  return DEPOSIT_STATUSES.find(item => item.id === value)?.label || "À recevoir";
}

function bookingStatusLabel(value) {
  return BOOKING_STATUSES.find(item => item.id === value)?.label || "Réservée";
}

function barrelNames(booking, barrels) {
  return (booking.barrelIds || [])
    .map(id => barrels.find(b => b.id === id)?.name)
    .filter(Boolean)
    .join(" · ");
}

function localDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

async function ensureBarrelsSeeded() {
  const barrels = await getAll("rentalBarrels");
  if (barrels.length) return;

  const now = new Date().toISOString();
  for (let i = 1; i <= 3; i++) {
    await putOne("rentalBarrels", {
      id: `barrel_${i}`,
      name: `Tonneau ${i}`,
      number: i,
      active: true,
      notes: "",
      photo: "",
      createdAt: now,
      updatedAt: now
    });
  }
}

async function getRentalData() {
  await ensureBarrelsSeeded();
  const [barrels, bookings] = await Promise.all([
    getAll("rentalBarrels"),
    getAll("rentalBookings")
  ]);

  return {
    barrels: barrels
      .filter(item => item.active !== false)
      .sort((a, b) => Number(a.number || 999) - Number(b.number || 999) || String(a.name).localeCompare(String(b.name), "fr")),
    bookings: bookings.sort((a, b) =>
      String(b.startDate || "").localeCompare(String(a.startDate || "")) ||
      String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    )
  };
}

function compressImage(file, max = 1200, quality = 0.74) {
  if (!file) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = event => {
      const image = new Image();

      image.onload = () => {
        const ratio = Math.min(1, max / image.width, max / image.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));

        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };

      image.onerror = reject;
      image.src = String(event.target.result || "");
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function filesToPhotos(files) {
  const list = [...(files || [])].slice(0, 6);
  const photos = [];
  for (const file of list) {
    photos.push(await compressImage(file, 1200, 0.72));
  }
  return photos.filter(Boolean);
}

function tabs() {
  return `
    <nav class="rental-tabs">
      <button class="${currentView === "dashboard" ? "active" : ""}" data-rental-view="dashboard">Tableau de bord</button>
      <button class="${currentView === "planning" ? "active" : ""}" data-rental-view="planning">Planning</button>
      <button class="${currentView === "bookings" ? "active" : ""}" data-rental-view="bookings">Locations</button>
      <button class="${currentView === "barrels" ? "active" : ""}" data-rental-view="barrels">Tonneaux</button>
    </nav>
  `;
}

function bindTabs(shell) {
  shell.querySelectorAll("[data-rental-view]").forEach(btn => {
    btn.addEventListener("click", async () => {
      currentView = btn.dataset.rentalView;
      currentBookingId = null;
      await renderCurrent();
    });
  });
}

async function renderCurrent() {
  if (!lastContainer) return;
  const shell = lastContainer.querySelector("#rental-shell") || lastContainer;

  if (currentView === "planning") return renderPlanning(shell);
  if (currentView === "bookings") return renderBookings(shell);
  if (currentView === "barrels") return renderBarrels(shell);
  if (currentView === "detail") return renderBookingDetail(shell, currentBookingId);

  return renderDashboard(shell);
}

function bookingRow(booking, barrels) {
  const meta = statusMeta(booking);
  return `
    <article class="rental-booking-row" data-rental-booking="${booking.id}">
      <div class="rental-booking-date">
        <strong>${fmtShortDate(booking.startDate)}</strong>
        <span>→ ${fmtShortDate(booking.endDate)}</span>
      </div>
      <div class="rental-booking-main">
        <strong>${escapeHtml(booking.customerName || "Sans nom")}</strong>
        <span>${escapeHtml(barrelNames(booking, barrels) || "Aucun tonneau")} · ${bookingDurationDays(booking)} j</span>
        ${booking.eventType ? `<small>${escapeHtml(booking.eventType)}${booking.eventLocation ? ` · ${escapeHtml(booking.eventLocation)}` : ""}</small>` : ""}
      </div>
      <div class="rental-booking-side">
        <b>${fmtMoney(booking.price)}</b>
        <span class="rental-status ${meta.id}">${meta.label}</span>
      </div>
    </article>
  `;
}

async function renderDashboard(shell) {
  const data = await getRentalData();
  const bookings = data.bookings.filter(b => b.status !== "cancelled");
  const annual = bookings.filter(b => Number(String(b.startDate || "").slice(0, 4)) === selectedYear);
  const revenue = annual.reduce((sum, item) => sum + Number(item.price || 0), 0);
  const today = todayISO();

  const upcoming = bookings
    .filter(b => b.endDate >= today && b.status !== "returned")
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 4);

  const depositsOpen = bookings.filter(b =>
    ["received", "retained"].includes(b.depositStatus) &&
    b.status !== "returned"
  );

  const monthly = Array.from({ length: 12 }, (_, month) => {
    const rows = annual.filter(b => Number(String(b.startDate || "").slice(5, 7)) === month + 1);
    return rows.reduce((sum, item) => sum + Number(item.price || 0), 0);
  });
  const maxMonth = Math.max(1, ...monthly);

  const utilization = data.barrels.map(barrel => {
    const days = annual
      .filter(b => (b.barrelIds || []).includes(barrel.id))
      .reduce((sum, b) => sum + bookingDurationDays(b), 0);
    return { barrel, days };
  });

  shell.innerHTML = `
    <section class="rental-v31">
      <div class="rental-hero">
        <div>
          <p class="eyebrow">LOCATION</p>
          <h2>Mes tonneaux</h2>
          <p>${data.barrels.length} tonneaux · suivi local et privé</p>
        </div>
        <button class="primary-btn" id="rental-add-booking">+ Location</button>
      </div>

      ${tabs()}

      <section class="rental-year-row">
        <button class="icon-btn rental-year-nav" id="rental-year-prev">‹</button>
        <div><span>Bilan annuel</span><strong>${selectedYear}</strong></div>
        <button class="icon-btn rental-year-nav" id="rental-year-next">›</button>
      </section>

      <section class="rental-kpis">
        <article><span>Chiffre d'affaires</span><strong>${fmtMoney(revenue)}</strong><small>${annual.length} location${annual.length > 1 ? "s" : ""}</small></article>
        <article><span>Prix moyen</span><strong>${annual.length ? fmtMoney(revenue / annual.length) : fmtMoney(0)}</strong><small>par location</small></article>
        <article><span>Cautions en cours</span><strong>${depositsOpen.length}</strong><small>${fmtMoney(depositsOpen.reduce((sum, b) => sum + Number(b.depositAmount || 0), 0))}</small></article>
      </section>

      <section class="rental-card">
        <div class="rental-card-head">
          <div><h3>Chiffre d'affaires par mois</h3><p>Locations démarrant en ${selectedYear}</p></div>
        </div>
        <div class="rental-month-chart">
          ${monthly.map((value, month) => {
            const pct = Math.round((value / maxMonth) * 100);
            const label = new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(new Date(2026, month, 1)).replace(".", "");
            return `<div class="rental-month-bar">
              <div class="rental-month-bar-track"><span style="height:${Math.max(value ? 8 : 0, pct)}%"></span></div>
              <strong>${label}</strong>
              <small>${value ? Math.round(value) + "€" : ""}</small>
            </div>`;
          }).join("")}
        </div>
      </section>

      <section class="rental-card">
        <div class="rental-card-head">
          <div><h3>Utilisation des tonneaux</h3><p>Nombre de jours loués sur l'année</p></div>
        </div>
        <div class="rental-utilization">
          ${utilization.map(item => `
            <div class="rental-util-row">
              <span>🛢️ ${escapeHtml(item.barrel.name)}</span>
              <div><i style="width:${Math.min(100, Math.round(item.days / 60 * 100))}%"></i></div>
              <strong>${item.days} j</strong>
            </div>
          `).join("")}
        </div>
      </section>

      <section class="rental-card">
        <div class="rental-card-head">
          <div><h3>Prochaines locations</h3><p>${upcoming.length ? "À préparer ou à suivre" : "Aucune location à venir"}</p></div>
          <button class="ghost-btn" data-rental-view="planning">Planning</button>
        </div>
        <div class="rental-booking-list">
          ${upcoming.length
            ? upcoming.map(b => bookingRow(b, data.barrels)).join("")
            : `<div class="rental-empty"><span>🛢️</span><strong>Planning libre</strong><p>Crée une location pour réserver un tonneau.</p></div>`
          }
        </div>
      </section>

      <div class="rental-privacy-note">
        <strong>🔒 Données sensibles locales</strong>
        <span>Coordonnées, photos et pièces d'identité restent dans IndexedDB sur cet appareil et dans tes sauvegardes MyHub.</span>
      </div>
    </section>
  `;

  bindTabs(shell);

  shell.querySelector("#rental-add-booking").addEventListener("click", () => showBookingModal());
  shell.querySelector("#rental-year-prev").addEventListener("click", async () => { selectedYear--; await renderDashboard(shell); });
  shell.querySelector("#rental-year-next").addEventListener("click", async () => { selectedYear++; await renderDashboard(shell); });

  shell.querySelectorAll("[data-rental-booking]").forEach(row => row.addEventListener("click", async () => {
    currentBookingId = row.dataset.rentalBooking;
    currentView = "detail";
    await renderCurrent();
  }));
}

function monthBounds(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start, end };
}

async function renderPlanning(shell) {
  const data = await getRentalData();
  const { start, end } = monthBounds(calendarDate);
  const first = addDays(start, -((start.getDay() + 6) % 7));
  const last = addDays(end, 6 - ((end.getDay() + 6) % 7));
  const days = [];
  for (let date = new Date(first); date <= last; date = addDays(date, 1)) {
    days.push(new Date(date));
  }

  shell.innerHTML = `
    <section class="rental-v31">
      <div class="rental-hero">
        <div><p class="eyebrow">LOCATION</p><h2>Planning</h2><p>Disponibilités et réservations des 3 tonneaux.</p></div>
        <button class="primary-btn" id="rental-add-booking">+ Location</button>
      </div>

      ${tabs()}

      <section class="rental-calendar-head">
        <button class="icon-btn" id="rental-month-prev">‹</button>
        <div>
          <span>Planning mensuel</span>
          <strong>${new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(calendarDate)}</strong>
        </div>
        <button class="icon-btn" id="rental-month-next">›</button>
      </section>

      <div class="rental-calendar-legend">
        ${data.barrels.map((barrel, i) => `<span class="barrel-${(i % 3) + 1}">● ${escapeHtml(barrel.name)}</span>`).join("")}
      </div>

      <section class="rental-calendar">
        ${["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"].map(day => `<div class="rental-calendar-weekday">${day}</div>`).join("")}
        ${days.map(date => {
          const iso = localDate(date);
          const inMonth = date.getMonth() === calendarDate.getMonth();
          const dayBookings = data.bookings
            .filter(b => b.status !== "cancelled" && isDateWithin(iso, b.startDate, b.endDate))
            .sort((a, b) => String(a.customerName).localeCompare(String(b.customerName), "fr"));

          return `
            <article class="rental-calendar-day ${inMonth ? "" : "outside"} ${iso === todayISO() ? "today" : ""}">
              <strong>${date.getDate()}</strong>
              <div>
                ${dayBookings.slice(0, 4).map(booking => {
                  const firstBarrel = data.barrels.findIndex(b => (booking.barrelIds || []).includes(b.id));
                  return `<button class="rental-calendar-booking barrel-${(Math.max(0, firstBarrel) % 3) + 1}" data-rental-booking="${booking.id}">
                    ${escapeHtml(booking.customerName || "Location")}
                  </button>`;
                }).join("")}
                ${dayBookings.length > 4 ? `<small>+${dayBookings.length - 4}</small>` : ""}
              </div>
            </article>
          `;
        }).join("")}
      </section>

      <section class="rental-card">
        <div class="rental-card-head"><div><h3>Disponibilité aujourd'hui</h3><p>${fmtDate(todayISO())}</p></div></div>
        <div class="rental-availability-grid">
          ${data.barrels.map((barrel, i) => {
            const booking = data.bookings.find(b =>
              b.status !== "cancelled" &&
              (b.barrelIds || []).includes(barrel.id) &&
              isDateWithin(todayISO(), b.startDate, b.endDate)
            );
            return `<article class="${booking ? "busy" : "free"}">
              <span>🛢️</span>
              <strong>${escapeHtml(barrel.name)}</strong>
              <small>${booking ? `Loué · ${escapeHtml(booking.customerName || "")}` : "Disponible"}</small>
            </article>`;
          }).join("")}
        </div>
      </section>
    </section>
  `;

  bindTabs(shell);
  shell.querySelector("#rental-add-booking").addEventListener("click", () => showBookingModal());
  shell.querySelector("#rental-month-prev").addEventListener("click", async () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
    await renderPlanning(shell);
  });
  shell.querySelector("#rental-month-next").addEventListener("click", async () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
    await renderPlanning(shell);
  });
  shell.querySelectorAll("[data-rental-booking]").forEach(btn => btn.addEventListener("click", async event => {
    event.stopPropagation();
    currentBookingId = btn.dataset.rentalBooking;
    currentView = "detail";
    await renderCurrent();
  }));
}

async function renderBookings(shell) {
  const data = await getRentalData();
  const active = data.bookings.filter(b => b.status !== "cancelled");
  const cancelled = data.bookings.filter(b => b.status === "cancelled");

  shell.innerHTML = `
    <section class="rental-v31">
      <div class="rental-hero">
        <div><p class="eyebrow">LOCATION</p><h2>Locations</h2><p>${active.length} location${active.length > 1 ? "s" : ""} enregistrée${active.length > 1 ? "s" : ""}</p></div>
        <button class="primary-btn" id="rental-add-booking">+ Location</button>
      </div>

      ${tabs()}

      <div class="rental-booking-list rental-booking-list-all">
        ${active.length
          ? active.map(b => bookingRow(b, data.barrels)).join("")
          : `<div class="rental-empty"><span>🛢️</span><strong>Aucune location</strong><p>Ajoute ta première location de tonneau.</p></div>`
        }
      </div>

      ${cancelled.length ? `
        <details class="rental-cancelled">
          <summary>${cancelled.length} location${cancelled.length > 1 ? "s" : ""} annulée${cancelled.length > 1 ? "s" : ""}</summary>
          <div class="rental-booking-list">${cancelled.map(b => bookingRow(b, data.barrels)).join("")}</div>
        </details>
      ` : ""}
    </section>
  `;

  bindTabs(shell);
  shell.querySelector("#rental-add-booking").addEventListener("click", () => showBookingModal());
  shell.querySelectorAll("[data-rental-booking]").forEach(row => row.addEventListener("click", async () => {
    currentBookingId = row.dataset.rentalBooking;
    currentView = "detail";
    await renderCurrent();
  }));
}

async function renderBarrels(shell) {
  const data = await getRentalData();

  shell.innerHTML = `
    <section class="rental-v31">
      <div class="rental-hero">
        <div><p class="eyebrow">LOCATION</p><h2>Tonneaux</h2><p>Le parc disponible à la location.</p></div>
        <button class="primary-btn" id="rental-add-barrel">+ Tonneau</button>
      </div>

      ${tabs()}

      <div class="rental-barrel-grid">
        ${data.barrels.map((barrel, index) => {
          const rows = data.bookings.filter(b => b.status !== "cancelled" && (b.barrelIds || []).includes(barrel.id));
          const revenue = rows.reduce((sum, b) => sum + Number(b.price || 0) / Math.max(1, (b.barrelIds || []).length), 0);
          const current = rows.find(b => isDateWithin(todayISO(), b.startDate, b.endDate) && b.status !== "returned");
          return `
            <article class="rental-barrel-card">
              ${barrel.photo
                ? `<img src="${barrel.photo}" alt="${escapeHtml(barrel.name)}">`
                : `<div class="rental-barrel-placeholder">🛢️</div>`
              }
              <div class="rental-barrel-content">
                <div>
                  <span>Tonneau ${barrel.number || index + 1}</span>
                  <h3>${escapeHtml(barrel.name)}</h3>
                </div>
                <span class="rental-status ${current ? "active" : "free"}">${current ? "Loué" : "Disponible"}</span>
                <div class="rental-barrel-stats">
                  <div><strong>${rows.length}</strong><span>locations</span></div>
                  <div><strong>${fmtMoney(revenue)}</strong><span>revenu estimé</span></div>
                </div>
                ${barrel.notes ? `<p>${escapeHtml(barrel.notes)}</p>` : ""}
                <button class="ghost-btn" data-edit-barrel="${barrel.id}">Modifier</button>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;

  bindTabs(shell);
  shell.querySelector("#rental-add-barrel").addEventListener("click", () => showBarrelModal());
  shell.querySelectorAll("[data-edit-barrel]").forEach(btn =>
    btn.addEventListener("click", () => showBarrelModal(btn.dataset.editBarrel))
  );
}

async function renderBookingDetail(shell, bookingId) {
  const data = await getRentalData();
  const booking = data.bookings.find(b => b.id === bookingId);

  if (!booking) {
    currentView = "bookings";
    return renderCurrent();
  }

  const meta = statusMeta(booking);

  shell.innerHTML = `
    <section class="rental-v31">
      <button class="rental-back" id="rental-detail-back">‹ Locations</button>

      <section class="rental-detail-hero">
        <div>
          <p class="eyebrow">LOCATION</p>
          <h2>${escapeHtml(booking.customerName || "Sans nom")}</h2>
          <p>${fmtDate(booking.startDate)} → ${fmtDate(booking.endDate)} · ${bookingDurationDays(booking)} jour${bookingDurationDays(booking) > 1 ? "s" : ""}</p>
        </div>
        <span class="rental-status ${meta.id}">${meta.label}</span>
      </section>

      <div class="rental-detail-actions">
        <button class="primary-btn" id="rental-edit-booking">Modifier</button>
        ${booking.status !== "returned" && booking.status !== "cancelled" ? `<button class="ghost-btn" id="rental-mark-returned">Marquer retournée</button>` : ""}
      </div>

      <section class="rental-card">
        <div class="rental-detail-grid">
          <div><span>Tonneaux</span><strong>${escapeHtml(barrelNames(booking, data.barrels) || "—")}</strong></div>
          <div><span>Prix</span><strong>${fmtMoney(booking.price)}</strong></div>
          <div><span>Caution</span><strong>${fmtMoney(booking.depositAmount)}</strong><small>${escapeHtml(booking.depositMethod || "—")} · ${depositStatusLabel(booking.depositStatus)}</small></div>
          <div><span>Événement</span><strong>${escapeHtml(booking.eventType || "—")}</strong><small>${escapeHtml(booking.eventLocation || "")}</small></div>
        </div>
      </section>

      <section class="rental-card">
        <div class="rental-card-head"><div><h3>Locataire</h3><p>Coordonnées enregistrées</p></div></div>
        <div class="rental-contact-list">
          <div><span>Nom</span><strong>${escapeHtml(booking.customerName || "—")}</strong></div>
          <div><span>Téléphone</span><strong>${escapeHtml(booking.customerPhone || "—")}</strong></div>
          <div><span>E-mail</span><strong>${escapeHtml(booking.customerEmail || "—")}</strong></div>
          <div><span>Adresse</span><strong>${escapeHtml(booking.customerAddress || "—")}</strong></div>
          <div><span>Ville / provenance</span><strong>${escapeHtml(booking.customerOrigin || "—")}</strong></div>
        </div>
      </section>

      <section class="rental-card">
        <div class="rental-card-head"><div><h3>État & photos</h3><p>Comparaison avant / après</p></div></div>
        <div class="rental-photo-sections">
          <div>
            <strong>Avant</strong>
            <div class="rental-photo-grid">
              ${(booking.beforePhotos || []).length
                ? booking.beforePhotos.map(photo => `<img src="${photo}" alt="Tonneau avant location">`).join("")
                : `<span class="rental-photo-empty">Aucune photo</span>`
              }
            </div>
          </div>
          <div>
            <strong>Après</strong>
            <div class="rental-photo-grid">
              ${(booking.afterPhotos || []).length
                ? booking.afterPhotos.map(photo => `<img src="${photo}" alt="Tonneau après location">`).join("")
                : `<span class="rental-photo-empty">Aucune photo</span>`
              }
            </div>
          </div>
        </div>

        <div class="rental-condition-grid">
          <div><span>État départ</span><strong>${escapeHtml(booking.conditionBefore || "—")}</strong></div>
          <div><span>État retour</span><strong>${escapeHtml(booking.conditionAfter || "—")}</strong></div>
        </div>
        ${booking.damageNotes ? `<div class="rental-damage"><strong>Dégâts / remarques</strong><p>${escapeHtml(booking.damageNotes)}</p></div>` : ""}
      </section>

      <section class="rental-card rental-id-card">
        <div class="rental-card-head">
          <div><h3>Pièce d'identité</h3><p>Donnée sensible stockée uniquement en local</p></div>
        </div>
        ${booking.idPhoto
          ? `<img src="${booking.idPhoto}" alt="Pièce d'identité du locataire">`
          : `<div class="rental-photo-empty">Aucune pièce d'identité enregistrée</div>`
        }
      </section>

      ${booking.notes ? `<section class="rental-card"><h3>Notes</h3><p class="rental-notes">${escapeHtml(booking.notes)}</p></section>` : ""}

      <button class="rental-delete" id="rental-delete-booking">Supprimer cette location</button>
    </section>
  `;

  shell.querySelector("#rental-detail-back").addEventListener("click", async () => {
    currentBookingId = null;
    currentView = "bookings";
    await renderCurrent();
  });
  shell.querySelector("#rental-edit-booking").addEventListener("click", () => showBookingModal(booking.id));
  shell.querySelector("#rental-mark-returned")?.addEventListener("click", async () => {
    await putOne("rentalBookings", {
      ...booking,
      status: "returned",
      returnedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderBookingDetail(shell, booking.id);
  });
  shell.querySelector("#rental-delete-booking").addEventListener("click", async () => {
    if (!confirm(`Supprimer la location de ${booking.customerName || "ce locataire"} ?`)) return;
    await deleteOne("rentalBookings", booking.id);
    currentBookingId = null;
    currentView = "bookings";
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrent();
  });
}

async function showBarrelModal(barrelId = null) {
  await ensureBarrelsSeeded();
  const barrels = await getAll("rentalBarrels");
  const barrel = barrels.find(b => b.id === barrelId) || {};
  let photo = barrel.photo || "";

  openModal(`
    <div class="modal-head">
      <div><p class="eyebrow">LOCATION</p><h2>${barrel.id ? "Modifier le tonneau" : "Nouveau tonneau"}</h2></div>
      <button class="icon-btn" id="rental-barrel-close">×</button>
    </div>

    <form class="form-grid" id="rental-barrel-form">
      <div class="field"><label>Nom</label><input name="name" required value="${escapeHtml(barrel.name || "")}" placeholder="Tonneau 1"></div>
      <div class="row">
        <div class="field"><label>Numéro</label><input type="number" name="number" min="1" value="${barrel.number || ""}"></div>
        <div class="field"><label>État</label><select name="active"><option value="1" ${barrel.active !== false ? "selected" : ""}>Actif</option><option value="0" ${barrel.active === false ? "selected" : ""}>Retiré</option></select></div>
      </div>
      <div class="field"><label>Photo</label><input type="file" id="rental-barrel-photo" accept="image/*"></div>
      ${photo ? `<img class="rental-form-preview" src="${photo}" alt="Photo tonneau">` : ""}
      <div class="field"><label>Notes</label><textarea name="notes" placeholder="Dimensions, état, détails...">${escapeHtml(barrel.notes || "")}</textarea></div>
      <div class="actions"><button class="ghost-btn" type="button" id="rental-barrel-cancel">Annuler</button><button class="primary-btn" type="submit">Enregistrer</button></div>
    </form>
  `);

  document.querySelector("#rental-barrel-close").addEventListener("click", closeModal);
  document.querySelector("#rental-barrel-cancel").addEventListener("click", closeModal);
  document.querySelector("#rental-barrel-photo").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (file) photo = await compressImage(file, 1200, 0.76);
  });

  document.querySelector("#rental-barrel-form").addEventListener("submit", async event => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const now = new Date().toISOString();

    await putOne("rentalBarrels", {
      ...barrel,
      id: barrel.id || uid("rental_barrel"),
      name: String(fd.get("name") || "").trim(),
      number: Number(fd.get("number") || 0) || null,
      active: fd.get("active") === "1",
      photo,
      notes: String(fd.get("notes") || "").trim(),
      createdAt: barrel.createdAt || now,
      updatedAt: now
    });

    closeModal();
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrent();
  });
}

async function showBookingModal(bookingId = null) {
  const data = await getRentalData();
  const booking = data.bookings.find(b => b.id === bookingId) || {};
  const selectedBarrels = new Set(booking.barrelIds || []);
  let beforePhotos = [...(booking.beforePhotos || [])];
  let afterPhotos = [...(booking.afterPhotos || [])];
  let idPhoto = booking.idPhoto || "";

  openModal(`
    <div class="modal-head">
      <div><p class="eyebrow">LOCATION</p><h2>${booking.id ? "Modifier la location" : "Nouvelle location"}</h2></div>
      <button class="icon-btn" id="rental-booking-close">×</button>
    </div>

    <form class="form-grid rental-booking-form" id="rental-booking-form">
      <section class="rental-form-section">
        <h3>Période & tonneaux</h3>
        <div class="row">
          <div class="field"><label>Départ</label><input type="date" name="startDate" required value="${booking.startDate || todayISO()}"></div>
          <div class="field"><label>Retour</label><input type="date" name="endDate" required value="${booking.endDate || booking.startDate || todayISO()}"></div>
        </div>
        <div class="row">
          <div class="field"><label>Heure départ</label><input type="time" name="pickupTime" value="${escapeHtml(booking.pickupTime || "")}"></div>
          <div class="field"><label>Heure retour</label><input type="time" name="returnTime" value="${escapeHtml(booking.returnTime || "")}"></div>
        </div>

        <div class="field">
          <label>Tonneaux</label>
          <div class="rental-barrel-checks">
            ${data.barrels.map((barrel, index) => `
              <label class="barrel-${(index % 3) + 1}">
                <input type="checkbox" name="barrelIds" value="${barrel.id}" ${selectedBarrels.has(barrel.id) ? "checked" : ""}>
                <span>🛢️ ${escapeHtml(barrel.name)}</span>
              </label>
            `).join("")}
          </div>
        </div>
        <div class="rental-conflict-note" id="rental-conflict-note"></div>
      </section>

      <section class="rental-form-section">
        <h3>Locataire</h3>
        <div class="field"><label>Nom / prénom</label><input name="customerName" required value="${escapeHtml(booking.customerName || "")}" placeholder="Nom du locataire"></div>
        <div class="row">
          <div class="field"><label>Téléphone</label><input type="tel" name="customerPhone" value="${escapeHtml(booking.customerPhone || "")}"></div>
          <div class="field"><label>E-mail</label><input type="email" name="customerEmail" value="${escapeHtml(booking.customerEmail || "")}"></div>
        </div>
        <div class="field"><label>Adresse</label><input name="customerAddress" value="${escapeHtml(booking.customerAddress || "")}"></div>
        <div class="field"><label>Ville / provenance</label><input name="customerOrigin" value="${escapeHtml(booking.customerOrigin || "")}" placeholder="D'où viennent-ils ?"></div>
      </section>

      <section class="rental-form-section">
        <h3>Location & caution</h3>
        <div class="row">
          <div class="field"><label>Prix location</label><input type="number" name="price" min="0" step="0.01" value="${booking.price ?? ""}" placeholder="€"></div>
          <div class="field"><label>Montant caution</label><input type="number" name="depositAmount" min="0" step="0.01" value="${booking.depositAmount ?? ""}" placeholder="€"></div>
        </div>
        <div class="row">
          <div class="field"><label>Moyen caution</label><select name="depositMethod">${DEPOSIT_METHODS.map(value => `<option ${booking.depositMethod === value ? "selected" : ""}>${value}</option>`).join("")}</select></div>
          <div class="field"><label>Statut caution</label><select name="depositStatus">${DEPOSIT_STATUSES.map(item => `<option value="${item.id}" ${booking.depositStatus === item.id ? "selected" : ""}>${item.label}</option>`).join("")}</select></div>
        </div>
        <div class="field"><label>Statut location</label><select name="status">${BOOKING_STATUSES.map(item => `<option value="${item.id}" ${(booking.status || "reserved") === item.id ? "selected" : ""}>${item.label}</option>`).join("")}</select></div>
      </section>

      <section class="rental-form-section">
        <h3>Événement</h3>
        <div class="row">
          <div class="field"><label>Type d'événement</label><input name="eventType" value="${escapeHtml(booking.eventType || "")}" placeholder="Mariage, anniversaire, fête..."></div>
          <div class="field"><label>Lieu de l'événement</label><input name="eventLocation" value="${escapeHtml(booking.eventLocation || "")}"></div>
        </div>
        <div class="field"><label>Informations annexes</label><textarea name="notes" placeholder="Accès, horaires, organisation, remarques...">${escapeHtml(booking.notes || "")}</textarea></div>
      </section>

      <section class="rental-form-section">
        <h3>État des tonneaux</h3>
        <div class="row">
          <div class="field"><label>État avant</label><input name="conditionBefore" value="${escapeHtml(booking.conditionBefore || "")}" placeholder="Bon état..."></div>
          <div class="field"><label>État après</label><input name="conditionAfter" value="${escapeHtml(booking.conditionAfter || "")}"></div>
        </div>
        <div class="field"><label>Dégâts / remarques retour</label><textarea name="damageNotes">${escapeHtml(booking.damageNotes || "")}</textarea></div>

        <div class="field"><label>Photos avant</label><input type="file" id="rental-before-photos" accept="image/*" multiple><small class="muted">${beforePhotos.length} photo${beforePhotos.length > 1 ? "s" : ""} enregistrée${beforePhotos.length > 1 ? "s" : ""}</small></div>
        ${beforePhotos.length ? `<label class="rental-remove-media"><input type="checkbox" name="clearBeforePhotos"> Supprimer les photos avant existantes</label>` : ""}

        <div class="field"><label>Photos après</label><input type="file" id="rental-after-photos" accept="image/*" multiple><small class="muted">${afterPhotos.length} photo${afterPhotos.length > 1 ? "s" : ""} enregistrée${afterPhotos.length > 1 ? "s" : ""}</small></div>
        ${afterPhotos.length ? `<label class="rental-remove-media"><input type="checkbox" name="clearAfterPhotos"> Supprimer les photos après existantes</label>` : ""}
      </section>

      <section class="rental-form-section rental-sensitive-section">
        <h3>Pièce d'identité</h3>
        <p>Cette photo reste uniquement dans les données locales de MyHub et dans tes sauvegardes.</p>
        <div class="field"><label>Photo de la pièce</label><input type="file" id="rental-id-photo" accept="image/*"></div>
        ${idPhoto ? `<img class="rental-form-preview rental-id-preview" src="${idPhoto}" alt="Pièce d'identité"><label class="rental-remove-media"><input type="checkbox" name="clearIdPhoto"> Supprimer la photo existante</label>` : ""}
      </section>

      <div class="actions">
        <button class="ghost-btn" type="button" id="rental-booking-cancel">Annuler</button>
        <button class="primary-btn" type="submit">Enregistrer</button>
      </div>
    </form>
  `);

  const form = document.querySelector("#rental-booking-form");
  const conflictNote = document.querySelector("#rental-conflict-note");

  const checkConflicts = () => {
    const fd = new FormData(form);
    const startDate = String(fd.get("startDate") || "");
    const endDate = String(fd.get("endDate") || "");
    const ids = fd.getAll("barrelIds").map(String);

    if (!startDate || !endDate || !ids.length) {
      conflictNote.textContent = "";
      conflictNote.className = "rental-conflict-note";
      return [];
    }

    const conflicts = data.bookings.filter(existing =>
      existing.id !== booking.id &&
      existing.status !== "cancelled" &&
      (existing.barrelIds || []).some(id => ids.includes(id)) &&
      overlaps(startDate, endDate, existing.startDate, existing.endDate)
    );

    if (conflicts.length) {
      conflictNote.className = "rental-conflict-note danger";
      conflictNote.textContent = `⚠️ Conflit : ${conflicts.map(item => `${barrelNames(item, data.barrels)} (${fmtShortDate(item.startDate)}–${fmtShortDate(item.endDate)})`).join(", ")}`;
    } else {
      conflictNote.className = "rental-conflict-note ok";
      conflictNote.textContent = "✓ Tonneau(x) disponible(s) sur cette période";
    }

    return conflicts;
  };

  form.querySelectorAll('input[name="startDate"], input[name="endDate"], input[name="barrelIds"]').forEach(input => {
    input.addEventListener("change", checkConflicts);
  });
  checkConflicts();

  document.querySelector("#rental-booking-close").addEventListener("click", closeModal);
  document.querySelector("#rental-booking-cancel").addEventListener("click", closeModal);

  document.querySelector("#rental-before-photos").addEventListener("change", async event => {
    beforePhotos = [...beforePhotos, ...(await filesToPhotos(event.target.files))].slice(0, 8);
  });
  document.querySelector("#rental-after-photos").addEventListener("change", async event => {
    afterPhotos = [...afterPhotos, ...(await filesToPhotos(event.target.files))].slice(0, 8);
  });
  document.querySelector("#rental-id-photo").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (file) idPhoto = await compressImage(file, 1400, 0.76);
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const fd = new FormData(form);
    const startDate = String(fd.get("startDate") || "");
    const endDate = String(fd.get("endDate") || "");
    const barrelIds = fd.getAll("barrelIds").map(String);

    if (!barrelIds.length) return alert("Sélectionne au moins un tonneau.");
    if (!startDate || !endDate) return alert("Renseigne les dates de départ et de retour.");
    if (endDate < startDate) return alert("La date de retour ne peut pas être avant la date de départ.");

    const conflicts = checkConflicts();
    if (conflicts.length) return alert("Un des tonneaux est déjà réservé sur cette période.");

    if (fd.get("clearBeforePhotos")) beforePhotos = [];
    if (fd.get("clearAfterPhotos")) afterPhotos = [];
    if (fd.get("clearIdPhoto")) idPhoto = "";

    const now = new Date().toISOString();

    const saved = {
      ...booking,
      id: booking.id || uid("rental_booking"),
      barrelIds,
      startDate,
      endDate,
      pickupTime: String(fd.get("pickupTime") || ""),
      returnTime: String(fd.get("returnTime") || ""),
      customerName: String(fd.get("customerName") || "").trim(),
      customerPhone: String(fd.get("customerPhone") || "").trim(),
      customerEmail: String(fd.get("customerEmail") || "").trim(),
      customerAddress: String(fd.get("customerAddress") || "").trim(),
      customerOrigin: String(fd.get("customerOrigin") || "").trim(),
      price: Number(fd.get("price") || 0),
      depositAmount: Number(fd.get("depositAmount") || 0),
      depositMethod: String(fd.get("depositMethod") || "Chèque"),
      depositStatus: String(fd.get("depositStatus") || "pending"),
      status: String(fd.get("status") || "reserved"),
      eventType: String(fd.get("eventType") || "").trim(),
      eventLocation: String(fd.get("eventLocation") || "").trim(),
      notes: String(fd.get("notes") || "").trim(),
      conditionBefore: String(fd.get("conditionBefore") || "").trim(),
      conditionAfter: String(fd.get("conditionAfter") || "").trim(),
      damageNotes: String(fd.get("damageNotes") || "").trim(),
      beforePhotos,
      afterPhotos,
      idPhoto,
      createdAt: booking.createdAt || now,
      updatedAt: now
    };

    await putOne("rentalBookings", saved);
    closeModal();
    currentBookingId = saved.id;
    currentView = "detail";
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrent();
  });
}

export async function renderRental(container) {
  lastContainer = container;
  await ensureBarrelsSeeded();
  container.innerHTML = `<section id="rental-shell"></section>`;
  await renderCurrent();
}

export function requestNewRentalBooking() {
  currentView = "bookings";
  window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "rental" }));
  setTimeout(() => showBookingModal(), 120);
}

export async function getRentalSummary() {
  await ensureBarrelsSeeded();
  const [barrels, bookings] = await Promise.all([
    getAll("rentalBarrels"),
    getAll("rentalBookings")
  ]);

  const activeBarrels = barrels.filter(b => b.active !== false);
  const rows = bookings.filter(b => b.status !== "cancelled");
  const today = todayISO();
  const year = new Date().getFullYear();

  const current = rows.filter(b => b.startDate <= today && b.endDate >= today && b.status !== "returned");
  const upcoming = rows
    .filter(b => b.startDate >= today && b.status !== "returned")
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const revenueYear = rows
    .filter(b => Number(String(b.startDate || "").slice(0, 4)) === year)
    .reduce((sum, b) => sum + Number(b.price || 0), 0);

  return {
    barrels: activeBarrels.length,
    active: current.length,
    upcoming: upcoming.length,
    nextDate: upcoming[0]?.startDate || null,
    nextCustomer: upcoming[0]?.customerName || "",
    revenueYear
  };
}
