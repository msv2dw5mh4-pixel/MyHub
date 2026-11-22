const THEME_KEY = "myhub.theme.preference";
const VALID = new Set(["dark", "light", "auto"]);

export function getThemePreference() {
  const saved = localStorage.getItem(THEME_KEY);
  return VALID.has(saved) ? saved : "dark";
}

export function resolveTheme(preference = getThemePreference()) {
  if (preference === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return preference;
}

export function applyTheme(preference = getThemePreference()) {
  const safe = VALID.has(preference) ? preference : "dark";
  const resolved = resolveTheme(safe);

  document.documentElement.dataset.themePreference = safe;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "dark" ? "#0b0d14" : "#f5f7fb");

  return { preference: safe, resolved };
}

export function setThemePreference(preference) {
  const safe = VALID.has(preference) ? preference : "dark";
  localStorage.setItem(THEME_KEY, safe);
  const state = applyTheme(safe);
  window.dispatchEvent(new CustomEvent("myhub:theme-changed", { detail: state }));
  return state;
}

export function initTheme() {
  applyTheme();

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (getThemePreference() === "auto") applyTheme("auto");
  };

  media.addEventListener?.("change", onChange);
  return () => media.removeEventListener?.("change", onChange);
}
