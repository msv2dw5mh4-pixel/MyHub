import { getOne, putOne } from "../core/db.js";
import { escapeHtml } from "../core/ui.js";

const SETTINGS_KEY = "notifications.myhubReminder";
const LAST_SENT_KEY = "notifications.myhubReminder.lastSent";
let schedulerId = null;

const DAY_LABELS = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mer" },
  { value: 4, label: "Jeu" },
  { value: 5, label: "Ven" },
  { value: 6, label: "Sam" },
  { value: 0, label: "Dim" }
];

function defaults() {
  return {
    enabled: false,
    time: "20:30",
    days: [1,2,3,4,5,6,0],
    message: "C’est l’heure de compléter MyHub"
  };
}

async function getSettings() {
  const row = await getOne("settings", SETTINGS_KEY).catch(() => null);
  return { ...defaults(), ...(row?.value || {}) };
}

async function saveSettings(value) {
  await putOne("settings", {
    key: SETTINGS_KEY,
    value,
    updatedAt: new Date().toISOString()
  });
}

function notificationSupported() {
  return "Notification" in window && "serviceWorker" in navigator;
}

async function showMyHubNotification(message) {
  if (!notificationSupported()) {
    throw new Error("Les notifications ne sont pas prises en charge sur cet appareil.");
  }

  if (Notification.permission !== "granted") {
    throw new Error("Autorise d’abord les notifications.");
  }

  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification("MyHub", {
    body: message || defaults().message,
    icon: "./assets/icons/icon-192.png",
    badge: "./assets/icons/icon-192.png",
    tag: "myhub-daily-reminder",
    renotify: true,
    data: { route: "dashboard" }
  });

  try {
    if ("setAppBadge" in navigator) await navigator.setAppBadge(1);
  } catch {}
}

export async function clearMyHubBadge() {
  try {
    if ("clearAppBadge" in navigator) await navigator.clearAppBadge();
  } catch {}
}

async function checkScheduledReminder() {
  const settings = await getSettings();
  if (!settings.enabled || Notification.permission !== "granted") return;

  const now = new Date();
  if (!(settings.days || []).map(Number).includes(now.getDay())) return;

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  if (`${hh}:${mm}` !== settings.time) return;

  const dayKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}__${settings.time}`;
  const previous = await getOne("settings", LAST_SENT_KEY).catch(() => null);
  if (previous?.value === dayKey) return;

  await showMyHubNotification(settings.message);
  await putOne("settings", {
    key: LAST_SENT_KEY,
    value: dayKey,
    updatedAt: new Date().toISOString()
  });
}

export function startMyHubReminderScheduler() {
  if (schedulerId) return;
  checkScheduledReminder().catch(console.warn);
  schedulerId = setInterval(() => {
    checkScheduledReminder().catch(console.warn);
  }, 30000);
}

export async function getReminderSummary() {
  const settings = await getSettings();
  return {
    enabled: settings.enabled,
    time: settings.time,
    days: settings.days?.length || 0,
    permission: notificationSupported() ? Notification.permission : "unsupported"
  };
}

export async function renderNotifications(container) {
  const settings = await getSettings();
  const permission = notificationSupported() ? Notification.permission : "unsupported";
  const selected = new Set((settings.days || []).map(Number));

  container.innerHTML = `
    <section class="notification-module">
      <div class="notification-hero">
        <div>
          <p class="eyebrow">RAPPEL MYHUB</p>
          <h2>🔔 C’est l’heure de compléter MyHub</h2>
          <p>Un rappel simple, indépendant des autres modules.</p>
        </div>
        <label class="notification-switch">
          <input id="notification-enabled" type="checkbox" ${settings.enabled ? "checked" : ""}>
          <span></span>
        </label>
      </div>

      <section class="notification-card">
        <div class="notification-status">
          <div>
            <span>Autorisation iPhone</span>
            <strong>${
              permission === "granted" ? "✓ Notifications autorisées" :
              permission === "denied" ? "Notifications refusées" :
              permission === "unsupported" ? "Non pris en charge" :
              "Autorisation nécessaire"
            }</strong>
          </div>
          ${permission !== "granted" && permission !== "unsupported"
            ? `<button class="primary-btn" id="notification-permission">Autoriser</button>`
            : ""
          }
        </div>
      </section>

      <section class="notification-card">
        <h3>Quand me rappeler ?</h3>

        <div class="field notification-time-field">
          <label>Heure</label>
          <input type="time" id="notification-time" value="${escapeHtml(settings.time || "20:30")}">
        </div>

        <div class="notification-days">
          ${DAY_LABELS.map(day => `
            <label class="${selected.has(day.value) ? "active" : ""}">
              <input type="checkbox" value="${day.value}" ${selected.has(day.value) ? "checked" : ""}>
              <span>${day.label}</span>
            </label>
          `).join("")}
        </div>

        <div class="notification-actions-inline">
          <button class="ghost-btn" id="notification-everyday">Tous les jours</button>
          <button class="primary-btn" id="notification-save">Enregistrer</button>
        </div>
      </section>

      <section class="notification-card">
        <div>
          <h3>Message</h3>
          <p class="notification-message-preview">« ${escapeHtml(settings.message || defaults().message)} »</p>
        </div>
        <button class="notification-test-btn" id="notification-test">🔔 Tester la notification</button>
      </section>

      <section class="notification-info">
        <strong>Fonctionnement actuel</strong>
        <p>Le bouton de test envoie une vraie notification système. Le rappel programmé fonctionne tant que MyHub reste actif en arrière-plan. Pour garantir l’envoi lorsque l’application est complètement fermée, il faudra relier MyHub à un petit service Web Push. Aucune donnée personnelle n’a besoin d’être envoyée pour cela.</p>
      </section>
    </section>
  `;

  const enabled = container.querySelector("#notification-enabled");
  const time = container.querySelector("#notification-time");
  const dayInputs = [...container.querySelectorAll(".notification-days input")];

  function repaintDays() {
    dayInputs.forEach(input => {
      input.closest("label")?.classList.toggle("active", input.checked);
    });
  }

  dayInputs.forEach(input => input.addEventListener("change", repaintDays));

  container.querySelector("#notification-everyday").addEventListener("click", event => {
    event.preventDefault();
    dayInputs.forEach(input => input.checked = true);
    repaintDays();
  });

  container.querySelector("#notification-permission")?.addEventListener("click", async () => {
    if (!notificationSupported()) return alert("Les notifications ne sont pas prises en charge.");
    const result = await Notification.requestPermission();
    if (result === "granted") {
      alert("Notifications activées.");
      await renderNotifications(container);
    } else {
      alert("L’autorisation n’a pas été accordée.");
    }
  });

  container.querySelector("#notification-save").addEventListener("click", async () => {
    const days = dayInputs.filter(input => input.checked).map(input => Number(input.value));
    if (!days.length) return alert("Choisis au moins un jour.");

    const next = {
      enabled: enabled.checked,
      time: time.value || "20:30",
      days,
      message: settings.message || defaults().message
    };

    await saveSettings(next);
    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    alert("Rappel MyHub enregistré.");
  });

  container.querySelector("#notification-test").addEventListener("click", async () => {
    try {
      if (!notificationSupported()) return alert("Les notifications ne sont pas prises en charge.");
      if (Notification.permission !== "granted") {
        const result = await Notification.requestPermission();
        if (result !== "granted") return alert("Autorise les notifications pour effectuer le test.");
      }
      await showMyHubNotification(settings.message || defaults().message);
    } catch (error) {
      console.error(error);
      alert(error?.message || "Impossible d’envoyer la notification de test.");
    }
  });
}
