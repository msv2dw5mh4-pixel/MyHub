import { modules, moduleGroups, getModuleActivationState, setModuleActive } from "../core/modules.js";

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function sorted(rows) {
  return [...rows].sort((a, b) => Number(a.order || 999) - Number(b.order || 999));
}

function moduleCard(module, active) {
  return `
    <article class="modules-v36-card ${active ? "is-active" : "is-available"}"
      data-module-search="${normalize(`${module.name} ${module.description}`)}">
      <button class="modules-v36-open" data-module-route="${module.route}" ${active ? "" : "disabled"}>
        <div class="modules-v27-icon">${module.icon}</div>
        <div class="modules-v27-copy">
          <strong>${module.name}</strong>
          <span>${module.description}</span>
        </div>
      </button>
      <div class="modules-v36-actions">
        ${module.core
          ? `<span class="modules-v36-core">Noyau MyHub</span>`
          : active
            ? `<button class="ghost-btn modules-v36-toggle" data-module-toggle="${module.id}" data-next-state="off">Désactiver</button>`
            : `<button class="primary-btn modules-v36-toggle" data-module-toggle="${module.id}" data-next-state="on">Activer</button>`
        }
      </div>
    </article>
  `;
}

export async function renderModules(container) {
  const state = await getModuleActivationState();
  const activeIds = new Set(state.activeIds);
  const activeModules = modules.filter(module => activeIds.has(module.id));
  const availableModules = modules.filter(module => !activeIds.has(module.id));

  container.innerHTML = `
    <section class="modules-v36">
      <div class="modules-v36-hero">
        <div>
          <p class="eyebrow">MYHUB MODULAIRE</p>
          <h2>Active seulement ce que tu utilises</h2>
          <p>Commence léger puis ajoute les modules au fur et à mesure. Désactiver un module ne supprime jamais ses données.</p>
        </div>
        <div class="modules-v36-count"><strong>${activeModules.length}</strong><span>modules actifs</span></div>
      </div>

      <div class="modules-v27-search">
        <span>⌕</span>
        <input id="modules-filter" type="search" placeholder="Rechercher un module…" autocomplete="off">
      </div>

      <section class="modules-v36-section" data-module-section>
        <div class="modules-v36-section-head">
          <div><h3>Mes modules</h3><p>Ceux qui font actuellement partie de ton MyHub.</p></div>
          <span>${activeModules.length}</span>
        </div>
        <div class="modules-v36-grid">
          ${moduleGroups.map(group => {
            const rows = sorted(activeModules.filter(module => module.group === group.id));
            if (!rows.length) return "";
            return `
              <div class="modules-v36-group" data-module-group>
                <div class="modules-v36-group-label"><strong>${group.name}</strong><span>${group.description}</span></div>
                ${rows.map(module => moduleCard(module, true)).join("")}
              </div>`;
          }).join("")}
        </div>
      </section>

      <section class="modules-v36-section modules-v36-library" data-module-section>
        <div class="modules-v36-section-head">
          <div><h3>Bibliothèque</h3><p>Modules disponibles à activer quand tu en as besoin.</p></div>
          <span>${availableModules.length}</span>
        </div>
        <div class="modules-v36-grid">
          ${moduleGroups.map(group => {
            const rows = sorted(availableModules.filter(module => module.group === group.id));
            if (!rows.length) return "";
            return `
              <div class="modules-v36-group" data-module-group>
                <div class="modules-v36-group-label"><strong>${group.name}</strong><span>${group.description}</span></div>
                ${rows.map(module => moduleCard(module, false)).join("")}
              </div>`;
          }).join("") || `<div class="empty">Tous les modules sont actifs.</div>`}
        </div>
      </section>

      <div class="modules-v36-note">
        <strong>Aucune suppression de données</strong>
        <p>Tu peux désactiver un module aujourd’hui et le réactiver dans plusieurs mois : ses données locales seront toujours là.</p>
      </div>
      <div class="empty" id="modules-empty" hidden>Aucun module ne correspond à cette recherche.</div>
    </section>
  `;

  container.querySelectorAll("[data-module-route]").forEach(button => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: button.dataset.moduleRoute }));
    });
  });

  container.querySelectorAll("[data-module-toggle]").forEach(button => {
    button.addEventListener("click", async () => {
      const id = button.dataset.moduleToggle;
      const activate = button.dataset.nextState === "on";
      if (!activate && !confirm("Désactiver ce module ? Ses données seront conservées.")) return;
      button.disabled = true;
      button.textContent = activate ? "Activation…" : "Désactivation…";
      await setModuleActive(id, activate);
      await renderModules(container);
    });
  });

  const input = container.querySelector("#modules-filter");
  const cards = [...container.querySelectorAll("[data-module-search]")];
  const groups = [...container.querySelectorAll("[data-module-group]")];
  const sections = [...container.querySelectorAll("[data-module-section]")];
  const empty = container.querySelector("#modules-empty");

  input?.addEventListener("input", () => {
    const query = normalize(input.value.trim());
    let visible = 0;
    cards.forEach(card => {
      const show = !query || card.dataset.moduleSearch.includes(query);
      card.hidden = !show;
      if (show) visible += 1;
    });
    groups.forEach(group => {
      const groupCards = [...group.querySelectorAll("[data-module-search]")];
      group.hidden = !groupCards.some(card => !card.hidden);
    });
    sections.forEach(section => {
      const sectionCards = [...section.querySelectorAll("[data-module-search]")];
      section.hidden = Boolean(query) && sectionCards.length > 0 && !sectionCards.some(card => !card.hidden);
    });
    empty.hidden = visible !== 0;
  });
}
