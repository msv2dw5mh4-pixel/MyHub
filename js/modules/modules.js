import { modules, moduleGroups } from "../core/modules.js";

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function sortedModules(groupId) {
  return modules
    .filter(module => module.enabled && module.group === groupId)
    .sort((a,b) => Number(a.order || 999) - Number(b.order || 999));
}

export function renderModules(container) {
  container.innerHTML = `
    <section class="modules-v32">
      <div class="section-head modules-v27-head">
        <div>
          <h2>Tous les modules</h2>
          <p class="muted">Les outils sont regroupés par usage pour retrouver plus vite ce que tu cherches.</p>
        </div>
      </div>

      <div class="modules-v27-search">
        <span>⌕</span>
        <input id="modules-filter" type="search" placeholder="Rechercher un module…" autocomplete="off">
      </div>

      <div id="modules-groups">
        ${moduleGroups.map(group => {
          const rows = sortedModules(group.id);
          if (!rows.length) return "";
          return `
            <section class="modules-v32-group" data-module-group>
              <div class="modules-v32-group-head">
                <div>
                  <h3>${group.name}</h3>
                  <p>${group.description}</p>
                </div>
                <span>${rows.length}</span>
              </div>

              <div class="modules-v27-grid">
                ${rows.map(module => `
                  <article
                    class="modules-v27-card"
                    data-module-route="${module.route}"
                    data-module-search="${normalize(`${module.name} ${module.description} ${group.name}`)}"
                  >
                    <div class="modules-v27-icon">${module.icon}</div>
                    <div class="modules-v27-copy">
                      <strong>${module.name}</strong>
                      <span>${module.description}</span>
                    </div>
                    <b>›</b>
                  </article>
                `).join("")}
              </div>
            </section>
          `;
        }).join("")}
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
  const groups = [...container.querySelectorAll("[data-module-group]")];
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

    empty.hidden = visible !== 0;
  });
}
