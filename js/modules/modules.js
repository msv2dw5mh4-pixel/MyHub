import { modules } from "../core/modules.js";

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function renderModules(container) {
  container.innerHTML = `
    <section class="modules-v27">
      <div class="section-head modules-v27-head">
        <div>
          <h2>Tous les modules</h2>
          <p class="muted">Retrouve rapidement l'outil dont tu as besoin.</p>
        </div>
      </div>

      <div class="modules-v27-search">
        <span>⌕</span>
        <input id="modules-filter" type="search" placeholder="Rechercher un module…" autocomplete="off">
      </div>

      <div class="modules-v27-grid" id="modules-grid">
        ${modules.filter(m => m.enabled).map(m => `
          <article class="modules-v27-card" data-module-route="${m.route}" data-module-search="${normalize(`${m.name} ${m.description}`)}">
            <div class="modules-v27-icon">${m.icon}</div>
            <div class="modules-v27-copy">
              <strong>${m.name}</strong>
              <span>${m.description}</span>
            </div>
            <b>›</b>
          </article>
        `).join("")}
      </div>

      <div class="empty" id="modules-empty" hidden>Aucun module ne correspond à cette recherche.</div>
    </section>
  `;

  container.querySelectorAll("[data-module-route]").forEach(item => {
    item.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: item.dataset.moduleRoute }));
    });
  });

  const input = container.querySelector("#modules-filter");
  const cards = [...container.querySelectorAll("[data-module-search]")];
  const empty = container.querySelector("#modules-empty");
  input?.addEventListener("input", () => {
    const q = normalize(input.value.trim());
    let visible = 0;
    cards.forEach(card => {
      const show = !q || card.dataset.moduleSearch.includes(q);
      card.hidden = !show;
      if (show) visible += 1;
    });
    empty.hidden = visible !== 0;
  });
}
