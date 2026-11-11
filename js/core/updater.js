import { APP_VERSION } from "./version.js";

const VERSION_URL = "./version.json";
const CHECK_TIMEOUT_MS = 8000;
let updateBanner = null;
let lastState = null;

function versionParts(value) {
  return String(value || "")
    .replace(/^v/i, "")
    .split(".")
    .map(part => Number.parseInt(part, 10))
    .map(part => Number.isFinite(part) ? part : 0);
}

export function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const av = left[i] || 0;
    const bv = right[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }

  return 0;
}

async function fetchWithTimeout(url, options = {}, timeout = CHECK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function checkForAppUpdate() {
  try {
    const response = await fetchWithTimeout(
      `${VERSION_URL}?check=${Date.now()}`,
      {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" }
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const remote = await response.json();
    const remoteVersion = String(remote?.version || "").trim();
    if (!remoteVersion) throw new Error("Version distante absente.");

    const state = {
      ok: true,
      installedVersion: APP_VERSION,
      latestVersion: remoteVersion,
      updateAvailable: compareVersions(remoteVersion, APP_VERSION) > 0,
      date: remote?.date || "",
      title: remote?.title || "",
      summary: remote?.summary || "",
      checkedAt: new Date().toISOString()
    };

    lastState = state;
    return state;
  } catch (error) {
    const state = {
      ok: false,
      installedVersion: APP_VERSION,
      latestVersion: null,
      updateAvailable: false,
      error: error?.name === "AbortError"
        ? "La vérification a expiré."
        : "Impossible de vérifier la dernière version.",
      checkedAt: new Date().toISOString()
    };

    lastState = state;
    return state;
  }
}

export function getLastUpdateState() {
  return lastState;
}

function waitForControllerChange(timeout = 5000) {
  return new Promise(resolve => {
    if (!("serviceWorker" in navigator)) {
      resolve(false);
      return;
    }

    let done = false;

    const finish = value => {
      if (done) return;
      done = true;
      navigator.serviceWorker.removeEventListener("controllerchange", handler);
      clearTimeout(timer);
      resolve(value);
    };

    const handler = () => finish(true);
    const timer = setTimeout(() => finish(false), timeout);

    navigator.serviceWorker.addEventListener("controllerchange", handler);
  });
}

function waitForWorkerInstalled(worker, timeout = 10000) {
  return new Promise(resolve => {
    if (!worker) {
      resolve(null);
      return;
    }

    if (worker.state === "installed" || worker.state === "activated") {
      resolve(worker);
      return;
    }

    let done = false;

    const finish = value => {
      if (done) return;
      done = true;
      worker.removeEventListener("statechange", handler);
      clearTimeout(timer);
      resolve(value);
    };

    const handler = () => {
      if (worker.state === "installed" || worker.state === "activated") {
        finish(worker);
      } else if (worker.state === "redundant") {
        finish(null);
      }
    };

    const timer = setTimeout(() => finish(worker), timeout);
    worker.addEventListener("statechange", handler);
  });
}

function forceFreshReload() {
  const url = new URL(window.location.href);
  url.searchParams.set("myhub-update", Date.now().toString());
  window.location.replace(url.toString());
}

export async function installAvailableUpdate(onProgress = () => {}) {
  onProgress("Préparation de la mise à jour…");

  if (!("serviceWorker" in navigator)) {
    onProgress("Rechargement de MyHub…");
    forceFreshReload();
    return;
  }

  let registration = await navigator.serviceWorker.getRegistration();

  if (!registration) {
    onProgress("Installation du service de mise à jour…");
    registration = await navigator.serviceWorker.register(
      `./service-worker.js?update=${Date.now()}`,
      { updateViaCache: "none" }
    );
  }

  onProgress("Téléchargement de la nouvelle version…");

  try {
    await registration.update();
  } catch (error) {
    console.warn("[MyHub Update] registration.update()", error);
  }

  let candidate = registration.waiting || registration.installing;

  if (candidate?.state === "installing") {
    onProgress("Installation des nouveaux fichiers…");
    candidate = await waitForWorkerInstalled(candidate);
  }

  const controllerPromise = waitForControllerChange();

  if (registration.waiting) {
    onProgress("Activation de la nouvelle version…");
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  } else if (candidate?.state === "installed") {
    onProgress("Activation de la nouvelle version…");
    candidate.postMessage({ type: "SKIP_WAITING" });
  }

  await controllerPromise;

  onProgress("Redémarrage de MyHub…");
  forceFreshReload();
}

function removeBanner() {
  updateBanner?.remove();
  updateBanner = null;
}

export function showUpdateBanner(state) {
  if (!state?.updateAvailable) {
    removeBanner();
    return;
  }

  if (updateBanner && document.body.contains(updateBanner)) return;

  const banner = document.createElement("aside");
  banner.className = "app-update-banner";
  banner.innerHTML = `
    <div>
      <strong>MyHub ${state.latestVersion} disponible</strong>
      <span>${state.title || "Une nouvelle version est prête."}</span>
    </div>
    <button type="button" class="app-update-banner-btn">Mettre à jour</button>
    <button type="button" class="app-update-banner-close" aria-label="Fermer">×</button>
  `;

  banner.querySelector(".app-update-banner-close")?.addEventListener("click", removeBanner);

  banner.querySelector(".app-update-banner-btn")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;

    try {
      await installAvailableUpdate(message => {
        button.textContent = message;
      });
    } catch (error) {
      console.error("[MyHub Update]", error);
      button.disabled = false;
      button.textContent = "Réessayer";
    }
  });

  document.body.appendChild(banner);
  updateBanner = banner;
}

export async function checkAndShowUpdate() {
  const state = await checkForAppUpdate();
  if (state.updateAvailable) showUpdateBanner(state);
  return state;
}

export function startAppUpdateWatcher() {
  setTimeout(() => {
    checkAndShowUpdate().catch(error => {
      console.warn("[MyHub Update] Vérification initiale", error);
    });
  }, 2500);

  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    checkAndShowUpdate().catch(() => {});
  }, 30 * 60 * 1000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    checkAndShowUpdate().catch(() => {});
  });
}
