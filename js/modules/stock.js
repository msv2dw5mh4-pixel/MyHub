import {
  getAll,
  getOne,
  putOne,
  deleteOne,
  replaceStore
} from "../core/db.js";

import {
  escapeHtml,
  uid,
  openModal,
  closeModal
} from "../core/ui.js";

let screen = "home";
let currentFilter = "all";
let currentProductId = null;
let editingProductId = null;
let selectedPhoto = null;
let lastContainer = null;

const categories = [
  "Mobilier",
  "Électronique",
  "Informatique",
  "Outillage",
  "Maison",
  "Décoration",
  "Vêtements",
  "Sport",
  "Loisirs",
  "Autre"
];

export async function renderStock(container) {
  lastContainer = container;
  container.innerHTML = `<section class="stock-shell" id="stock-shell"></section>`;
  await renderCurrentScreen();
}

export function requestNewProduct() {
  editingProductId = null;
  currentProductId = null;
  selectedPhoto = null;
  screen = "add";
  window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "stock" }));
}

async function renderCurrentScreen() {
  if (!lastContainer) return;

  const shell = lastContainer.querySelector("#stock-shell") || lastContainer;

  switch (screen) {
    case "products":
      await renderProductsScreen(shell);
      break;
    case "add":
      await renderProductForm(shell);
      break;
    case "detail":
      await renderProductDetail(shell, currentProductId);
      break;
    case "stats":
      await renderStatsScreen(shell);
      break;
    default:
      await renderStockHome(shell);
  }
}

function toolbar(active) {
  return `
    <div class="stock-toolbar">
      <button class="stock-tab ${active === "home" ? "active" : ""}" data-stock-screen="home">Résumé</button>
      <button class="stock-tab ${active === "products" ? "active" : ""}" data-stock-screen="products">Produits</button>
      <button class="stock-tab ${active === "stats" ? "active" : ""}" data-stock-screen="stats">Stats</button>
    </div>
  `;
}

function bindToolbar(shell) {
  shell.querySelectorAll("[data-stock-screen]").forEach(btn => {
    btn.addEventListener("click", async () => {
      screen = btn.dataset.stockScreen;
      await renderCurrentScreen();
    });
  });
}

function getStatus(status) {
  switch (status) {
    case "sale":
      return { label: "En vente", className: "stock-status-sale" };
    case "sold":
      return { label: "Vendu", className: "stock-status-sold" };
    default:
      return { label: "En stock", className: "stock-status-stock" };
  }
}

function formatMoney(value) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

function formatSignedMoney(value) {
  const number = Number(value) || 0;
  const formatted = formatMoney(Math.abs(number));
  if (number > 0) return `+${formatted}`;
  if (number < 0) return `-${formatted}`;
  return formatted;
}

function formatDate(dateString) {
  if (!dateString) return "—";

  const date = new Date(`${dateString}T12:00:00`);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}

function getToday() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function calculateProfit(product) {
  if (product.status !== "sold") return 0;

  return (
    Number(product.salePrice || 0) -
    Number(product.purchasePrice || 0) -
    Number(product.fees || 0)
  );
}

function calculateROI(product) {
  const purchasePrice = Number(product.purchasePrice || 0);
  if (!purchasePrice) return 0;
  return (calculateProfit(product) / purchasePrice) * 100;
}

function potentialProfit(product) {
  return Number(product.targetPrice || 0) - Number(product.purchasePrice || 0);
}

function potentialROI(product) {
  const purchasePrice = Number(product.purchasePrice || 0);
  if (!purchasePrice) return 0;
  return (potentialProfit(product) / purchasePrice) * 100;
}

function sortProducts(products) {
  return [...products].sort((a, b) => {
    const aDate = a.createdAt || a.purchaseDate || "";
    const bDate = b.createdAt || b.purchaseDate || "";
    return bDate.localeCompare(aDate);
  });
}

async function allProducts() {
  return sortProducts(await getAll("products"));
}

export async function getStockSummary() {
  const products = await allProducts();
  const sold = products.filter(p => p.status === "sold");
  const active = products.filter(p => p.status !== "sold");

  return {
    totalProducts: products.length,
    forSale: products.filter(p => p.status === "sale").length,
    sold: sold.length,
    purchaseValue: active.reduce((sum, p) => sum + Number(p.purchasePrice || 0), 0),
    estimatedValue: active.reduce((sum, p) => sum + Number(p.targetPrice || 0), 0),
    profit: sold.reduce((sum, p) => sum + calculateProfit(p), 0),
    revenue: sold.reduce((sum, p) => sum + Number(p.salePrice || 0), 0)
  };
}

function productCard(product) {
  const status = getStatus(product.status);
  const price = product.status === "sold" ? product.salePrice : product.targetPrice;

  const image = product.photo
    ? `<img class="stock-product-image" src="${product.photo}" alt="${escapeHtml(product.name)}">`
    : `<div class="stock-product-placeholder">📦</div>`;

  return `
    <button class="stock-product-card" data-product-id="${String(product.id)}">
      ${image}
      <div class="stock-product-info">
        <h3>${escapeHtml(product.name)}</h3>
        <p>${escapeHtml(product.category || "Autre")}</p>
        <span class="stock-status ${status.className}">${status.label}</span>
      </div>
      <div class="stock-product-price">${Number(price) > 0 ? formatMoney(price) : "—"}</div>
    </button>
  `;
}

function bindProductCards(shell, products) {
  shell.querySelectorAll("[data-product-id]").forEach(card => {
    card.addEventListener("click", async () => {
      const raw = card.dataset.productId;
      const product = products.find(p => String(p.id) === raw);
      if (!product) return;
      currentProductId = product.id;
      screen = "detail";
      await renderCurrentScreen();
    });
  });
}

async function renderStockHome(shell) {
  const products = await allProducts();
  const summary = await getStockSummary();

  shell.innerHTML = `
    ${toolbar("home")}

    <div class="stock-head">
      <div>
        <h2>Stock & Marge</h2>
        <p>Inventaire, ventes et rentabilité.</p>
      </div>
      <button class="primary-btn" id="stock-add-home">Ajouter</button>
    </div>

    <div class="stock-hero">
      <span>Bénéfice réalisé</span>
      <strong>${formatSignedMoney(summary.profit)}</strong>
      <small>${summary.sold === 1 ? "1 produit vendu" : `${summary.sold} produits vendus`}</small>
    </div>

    <div class="stock-stats-grid">
      <div class="stock-stat-card">
        <span>Produits</span>
        <strong>${summary.totalProducts}</strong>
      </div>
      <div class="stock-stat-card">
        <span>En vente</span>
        <strong>${summary.forSale}</strong>
      </div>
      <div class="stock-stat-card">
        <span>Valeur d'achat</span>
        <strong>${formatMoney(summary.purchaseValue)}</strong>
      </div>
      <div class="stock-stat-card">
        <span>Valeur prévue</span>
        <strong>${formatMoney(summary.estimatedValue)}</strong>
      </div>
    </div>

    <div class="stock-section">
      <div class="stock-section-title">
        <h3>Derniers produits</h3>
        <button class="stock-link-btn" id="stock-see-all">Tout voir</button>
      </div>

      <div class="stock-product-list">
        ${
          products.length
            ? products.slice(0, 4).map(productCard).join("")
            : `<div class="stock-empty">
                 <div class="stock-empty-icon">📦</div>
                 <h3>Aucun produit</h3>
                 <p>Commence par ajouter ton premier bien.</p>
               </div>`
        }
      </div>
    </div>
  `;

  bindToolbar(shell);
  bindProductCards(shell, products);

  shell.querySelector("#stock-add-home").addEventListener("click", async () => {
    editingProductId = null;
    currentProductId = null;
    selectedPhoto = null;
    screen = "add";
    await renderCurrentScreen();
  });

  shell.querySelector("#stock-see-all").addEventListener("click", async () => {
    screen = "products";
    await renderCurrentScreen();
  });
}

async function renderProductsScreen(shell) {
  const products = await allProducts();

  shell.innerHTML = `
    ${toolbar("products")}

    <div class="stock-head">
      <div>
        <h2>Mes produits</h2>
        <p>${products.length} produit${products.length > 1 ? "s" : ""} enregistré${products.length > 1 ? "s" : ""}.</p>
      </div>
      <button class="primary-btn" id="stock-add-product">Ajouter</button>
    </div>

    <input class="stock-search" id="stock-search" type="search" placeholder="Rechercher un produit...">

    <div class="stock-filters">
      <button class="stock-filter ${currentFilter === "all" ? "active" : ""}" data-stock-filter="all">Tous</button>
      <button class="stock-filter ${currentFilter === "stock" ? "active" : ""}" data-stock-filter="stock">Stock</button>
      <button class="stock-filter ${currentFilter === "sale" ? "active" : ""}" data-stock-filter="sale">En vente</button>
      <button class="stock-filter ${currentFilter === "sold" ? "active" : ""}" data-stock-filter="sold">Vendus</button>
    </div>

    <div class="stock-product-list" id="stock-products-list"></div>
  `;

  bindToolbar(shell);

  const search = shell.querySelector("#stock-search");
  const list = shell.querySelector("#stock-products-list");

  function paintList() {
    const term = search.value.toLowerCase().trim();

    const visible = products.filter(product => {
      const matchesSearch =
        String(product.name || "").toLowerCase().includes(term) ||
        String(product.category || "").toLowerCase().includes(term);

      const matchesFilter =
        currentFilter === "all" || product.status === currentFilter;

      return matchesSearch && matchesFilter;
    });

    list.innerHTML = visible.length
      ? visible.map(productCard).join("")
      : `<div class="stock-empty">
           <div class="stock-empty-icon">📦</div>
           <h3>Aucun produit</h3>
           <p>Aucun produit ne correspond à cette recherche.</p>
         </div>`;

    bindProductCards(list, products);
  }

  paintList();

  search.addEventListener("input", paintList);

  shell.querySelectorAll("[data-stock-filter]").forEach(btn => {
    btn.addEventListener("click", () => {
      currentFilter = btn.dataset.stockFilter;
      shell.querySelectorAll("[data-stock-filter]").forEach(b => {
        b.classList.toggle("active", b === btn);
      });
      paintList();
    });
  });

  shell.querySelector("#stock-add-product").addEventListener("click", async () => {
    editingProductId = null;
    currentProductId = null;
    selectedPhoto = null;
    screen = "add";
    await renderCurrentScreen();
  });
}

async function renderProductForm(shell) {
  const products = await allProducts();
  const product = editingProductId !== null
    ? products.find(p => String(p.id) === String(editingProductId))
    : null;

  if (product && selectedPhoto === null) {
    selectedPhoto = product.photo || null;
  }

  const isEditing = Boolean(product);
  const lockedSold = product?.status === "sold";

  shell.innerHTML = `
    <button class="stock-back" id="stock-form-back">‹ Retour</button>

    <div class="stock-head">
      <div>
        <h2>${isEditing ? "Modifier le produit" : "Nouveau produit"}</h2>
        <p>${isEditing ? "Mets à jour les informations du bien." : "Ajoute un bien à ton inventaire."}</p>
      </div>
    </div>

    <form class="stock-form" id="stock-product-form">
      <div>
        <input class="stock-photo-input" type="file" id="stock-product-photo" accept="image/*" capture="environment">
        <label class="stock-photo-preview" for="stock-product-photo" id="stock-photo-preview">
          ${
            selectedPhoto
              ? `<img src="${selectedPhoto}" alt="Photo du produit">`
              : `<div class="stock-photo-inner">
                   <span class="stock-photo-icon">📷</span>
                   <strong>Ajouter une photo</strong>
                   <small>Appareil photo ou photothèque</small>
                 </div>`
          }
        </label>
      </div>

      <div class="stock-field">
        <label for="stock-product-name">Nom du produit</label>
        <input id="stock-product-name" name="name" required maxlength="120"
          value="${escapeHtml(product?.name || "")}" placeholder="Ex : Perceuse Makita">
      </div>

      <div class="stock-field">
        <label for="stock-product-category">Catégorie</label>
        <select id="stock-product-category" name="category">
          ${categories.map(category =>
            `<option ${category === (product?.category || "Mobilier") ? "selected" : ""}>${category}</option>`
          ).join("")}
        </select>
      </div>

      <div class="stock-price-grid">
        <div class="stock-field">
          <label for="stock-purchase-price">Prix d'achat</label>
          <div class="stock-money-input">
            <input type="number" id="stock-purchase-price" name="purchasePrice" min="0" step="0.01"
              value="${product?.purchasePrice ?? ""}" placeholder="0" required>
            <span>€</span>
          </div>
        </div>

        <div class="stock-field">
          <label for="stock-target-price">Vente souhaitée</label>
          <div class="stock-money-input">
            <input type="number" id="stock-target-price" name="targetPrice" min="0" step="0.01"
              value="${product?.targetPrice ?? ""}" placeholder="0">
            <span>€</span>
          </div>
        </div>
      </div>

      <div class="stock-field">
        <label for="stock-purchase-date">Date d'achat</label>
        <input type="date" id="stock-purchase-date" name="purchaseDate"
          value="${product?.purchaseDate || getToday()}">
      </div>

      <div class="stock-field">
        <label for="stock-product-description">Description</label>
        <textarea id="stock-product-description" name="description"
          placeholder="État, origine, dimensions, informations utiles...">${escapeHtml(product?.description || "")}</textarea>
      </div>

      ${
        lockedSold
          ? `<div class="stock-field">
               <label>Statut</label>
               <input value="Vendu" disabled>
             </div>`
          : `<div class="stock-field">
               <label for="stock-product-status">Statut</label>
               <select id="stock-product-status" name="status">
                 <option value="stock" ${(product?.status || "stock") === "stock" ? "selected" : ""}>En stock</option>
                 <option value="sale" ${product?.status === "sale" ? "selected" : ""}>En vente</option>
               </select>
             </div>`
      }

      <button type="submit" class="stock-primary">
        ${isEditing ? "Enregistrer les modifications" : "Ajouter le produit"}
      </button>
    </form>
  `;

  shell.querySelector("#stock-form-back").addEventListener("click", async () => {
    screen = isEditing ? "detail" : "products";
    editingProductId = null;
    selectedPhoto = null;
    await renderCurrentScreen();
  });

  const photoInput = shell.querySelector("#stock-product-photo");
  const photoPreview = shell.querySelector("#stock-photo-preview");

  photoInput.addEventListener("change", async () => {
    const file = photoInput.files?.[0];
    if (!file) return;

    try {
      selectedPhoto = await compressImage(file);
      photoPreview.innerHTML = `<img src="${selectedPhoto}" alt="Photo du produit">`;
    } catch (error) {
      console.error(error);
      alert("Impossible de traiter cette photo.");
    }
  });

  shell.querySelector("#stock-product-form").addEventListener("submit", async event => {
    event.preventDefault();

    const fd = new FormData(event.target);
    const name = String(fd.get("name") || "").trim();

    if (!name) {
      alert("Indique un nom pour le produit.");
      return;
    }

    const base = product || {};

    const saved = {
      ...base,
      id: product?.id ?? uid("product"),
      name,
      category: String(fd.get("category") || "Autre"),
      purchasePrice: Number(fd.get("purchasePrice") || 0),
      targetPrice: Number(fd.get("targetPrice") || 0),
      purchaseDate: String(fd.get("purchaseDate") || ""),
      description: String(fd.get("description") || "").trim(),
      status: lockedSold ? "sold" : String(fd.get("status") || "stock"),
      photo: selectedPhoto ?? product?.photo ?? null,
      salePrice: product?.salePrice ?? null,
      fees: Number(product?.fees || 0),
      saleDate: product?.saleDate ?? null,
      createdAt: product?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await putOne("products", saved);

    editingProductId = null;
    selectedPhoto = null;
    currentProductId = saved.id;
    screen = "detail";

    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrentScreen();
  });
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = event => {
      const image = new Image();

      image.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const MAX_WIDTH = 1000;
        const MAX_HEIGHT = 1000;

        let width = image.width;
        let height = image.height;

        if (width > MAX_WIDTH || height > MAX_HEIGHT) {
          const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
          width *= ratio;
          height *= ratio;
        }

        canvas.width = Math.round(width);
        canvas.height = Math.round(height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };

      image.onerror = reject;
      image.src = event.target.result;
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function renderProductDetail(shell, id) {
  const products = await allProducts();
  const product = products.find(p => String(p.id) === String(id));

  if (!product) {
    screen = "products";
    await renderCurrentScreen();
    return;
  }

  const status = getStatus(product.status);
  const realProfit = calculateProfit(product);
  const realROI = calculateROI(product);
  const pProfit = potentialProfit(product);
  const pROI = potentialROI(product);

  const financialCards = product.status === "sold"
    ? `
      <div class="stock-detail-card"><span>Prix d'achat</span><strong>${formatMoney(product.purchasePrice)}</strong></div>
      <div class="stock-detail-card"><span>Prix de vente</span><strong>${formatMoney(product.salePrice)}</strong></div>
      <div class="stock-detail-card ${realProfit >= 0 ? "stock-positive" : "stock-negative"}"><span>Bénéfice</span><strong>${formatSignedMoney(realProfit)}</strong></div>
      <div class="stock-detail-card ${realROI >= 0 ? "stock-positive" : "stock-negative"}"><span>Rentabilité</span><strong>${realROI.toFixed(1)} %</strong></div>
    `
    : `
      <div class="stock-detail-card"><span>Prix d'achat</span><strong>${formatMoney(product.purchasePrice)}</strong></div>
      <div class="stock-detail-card"><span>Vente prévue</span><strong>${formatMoney(product.targetPrice)}</strong></div>
      <div class="stock-detail-card ${pProfit >= 0 ? "stock-positive" : "stock-negative"}"><span>Marge potentielle</span><strong>${formatSignedMoney(pProfit)}</strong></div>
      <div class="stock-detail-card ${pROI >= 0 ? "stock-positive" : "stock-negative"}"><span>Rentabilité potentielle</span><strong>${pROI.toFixed(1)} %</strong></div>
    `;

  shell.innerHTML = `
    <button class="stock-back" id="stock-detail-back">‹ Mes produits</button>

    ${
      product.photo
        ? `<img src="${product.photo}" class="stock-detail-photo" alt="${escapeHtml(product.name)}">`
        : `<div class="stock-detail-photo-placeholder">📦</div>`
    }

    <div class="stock-detail-title">
      <h2>${escapeHtml(product.name)}</h2>
      <p>${escapeHtml(product.category || "Autre")}</p>
      <span class="stock-status ${status.className}">${status.label}</span>
    </div>

    <div class="stock-detail-grid">${financialCards}</div>

    <div class="stock-detail-section">
      <h3>Informations</h3>
      <div class="stock-detail-row"><span>Date d'achat</span><strong>${product.purchaseDate ? formatDate(product.purchaseDate) : "Non renseignée"}</strong></div>
      ${
        product.status === "sold"
          ? `
            <div class="stock-detail-row"><span>Date de vente</span><strong>${product.saleDate ? formatDate(product.saleDate) : "Non renseignée"}</strong></div>
            <div class="stock-detail-row"><span>Frais</span><strong>${formatMoney(product.fees || 0)}</strong></div>
          `
          : ""
      }
    </div>

    <div class="stock-detail-section">
      <h3>Description</h3>
      <p>${product.description ? escapeHtml(product.description) : "Aucune description."}</p>
    </div>

    ${
      product.status !== "sold"
        ? `<button class="stock-primary" id="stock-sell" style="margin-top:12px">Marquer comme vendu</button>`
        : ""
    }

    <div class="stock-detail-actions">
      <button class="stock-secondary" id="stock-edit">Modifier</button>
      <button class="stock-danger" id="stock-delete">Supprimer</button>
    </div>
  `;

  shell.querySelector("#stock-detail-back").addEventListener("click", async () => {
    screen = "products";
    currentProductId = null;
    await renderCurrentScreen();
  });

  shell.querySelector("#stock-edit").addEventListener("click", async () => {
    editingProductId = product.id;
    selectedPhoto = product.photo || null;
    screen = "add";
    await renderCurrentScreen();
  });

  shell.querySelector("#stock-delete").addEventListener("click", async () => {
    if (!confirm(`Supprimer définitivement "${product.name}" ?`)) return;

    await deleteOne("products", product.id);

    if (product.sourceAssetId) {
      const asset = await getOne("maintenanceAssets", product.sourceAssetId);
      if (asset) {
        await putOne("maintenanceAssets", {
          ...asset,
          stockProductId: null,
          ownershipStatus: asset.ownershipStatus === "sale" ? "active" : asset.ownershipStatus,
          updatedAt: new Date().toISOString()
        });
      }
    }

    currentProductId = null;
    screen = "products";

    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrentScreen();
  });

  const sellButton = shell.querySelector("#stock-sell");
  if (sellButton) {
    sellButton.addEventListener("click", () => showSaleModal(product));
  }
}

function showSaleModal(product) {
  openModal(`
    <div class="stock-shell">
      <div class="modal-head">
        <div>
          <p class="eyebrow">PRODUIT VENDU</p>
          <h2>Enregistrer la vente</h2>
        </div>
        <button class="icon-btn" id="stock-sale-close">×</button>
      </div>

      <form class="stock-form" id="stock-sale-form">
        <div class="stock-field">
          <label for="stock-sale-price">Prix de vente</label>
          <div class="stock-money-input">
            <input type="number" id="stock-sale-price" name="salePrice" min="0" step="0.01" value="${product.targetPrice || ""}" required>
            <span>€</span>
          </div>
        </div>

        <div class="stock-field">
          <label for="stock-sale-fees">Frais</label>
          <div class="stock-money-input">
            <input type="number" id="stock-sale-fees" name="fees" min="0" step="0.01" value="0">
            <span>€</span>
          </div>
        </div>

        <div class="stock-field">
          <label for="stock-sale-date">Date de vente</label>
          <input type="date" id="stock-sale-date" name="saleDate" value="${getToday()}">
        </div>

        <label style="display:flex;gap:8px;align-items:center;padding:10px 0">
          <input type="checkbox" id="stock-sale-budget" name="addToBudget" checked>
          Ajouter automatiquement cette vente dans Budget
        </label>

        <div class="stock-sale-summary">
          <div>
            <span>Bénéfice estimé</span>
            <strong id="stock-sale-profit">0 €</strong>
          </div>
          <div>
            <span>Rentabilité</span>
            <strong id="stock-sale-roi">0 %</strong>
          </div>
        </div>

        <button class="stock-primary" type="submit">Confirmer la vente</button>
      </form>
    </div>
  `);

  const salePrice = document.querySelector("#stock-sale-price");
  const fees = document.querySelector("#stock-sale-fees");

  function updatePreview() {
    const price = Number(salePrice.value || 0);
    const feeValue = Number(fees.value || 0);
    const purchase = Number(product.purchasePrice || 0);
    const profit = price - purchase - feeValue;
    const roi = purchase > 0 ? (profit / purchase) * 100 : 0;

    document.querySelector("#stock-sale-profit").textContent = formatSignedMoney(profit);
    document.querySelector("#stock-sale-roi").textContent = `${roi.toFixed(1)} %`;
  }

  updatePreview();
  salePrice.addEventListener("input", updatePreview);
  fees.addEventListener("input", updatePreview);

  document.querySelector("#stock-sale-close").addEventListener("click", closeModal);

  document.querySelector("#stock-sale-form").addEventListener("submit", async event => {
    event.preventDefault();

    const fd = new FormData(event.target);
    const price = Number(fd.get("salePrice"));

    if (!Number.isFinite(price) || price < 0) {
      alert("Indique un prix de vente valide.");
      return;
    }

    const updated = {
      ...product,
      salePrice: price,
      fees: Number(fd.get("fees") || 0),
      saleDate: String(fd.get("saleDate") || ""),
      status: "sold",
      updatedAt: new Date().toISOString()
    };

    await putOne("products", updated);

    if (updated.sourceAssetId) {
      const asset = await getOne("maintenanceAssets", updated.sourceAssetId);
      if (asset) {
        await putOne("maintenanceAssets", {
          ...asset,
          stockProductId: updated.id,
          ownershipStatus: "sold",
          updatedAt: new Date().toISOString()
        });
      }
    }

    if (fd.get("addToBudget") === "on") {
      await putOne("budgetTransactions", {
        id: `budget_stock_${updated.id}`,
        title: `Vente · ${updated.name || updated.title || "Produit"}`,
        type: "income",
        amount: Number(updated.salePrice || 0),
        date: updated.saleDate || getToday(),
        category: "Vente Stock",
        projectId: null,
        objectiveId: null,
        source: "stock-sale",
        productId: updated.id,
        notes: updated.fees ? `Frais de vente : ${formatMoney(updated.fees)}` : "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    closeModal();

    currentProductId = updated.id;
    screen = "detail";

    window.dispatchEvent(new CustomEvent("myhub:data-changed"));
    await renderCurrentScreen();
  });
}

async function renderStatsScreen(shell) {
  const products = await allProducts();
  const sold = products.filter(p => p.status === "sold");

  const revenue = sold.reduce((sum, p) => sum + Number(p.salePrice || 0), 0);
  const profit = sold.reduce((sum, p) => sum + calculateProfit(p), 0);
  const averageROI = sold.length
    ? sold.reduce((sum, p) => sum + calculateROI(p), 0) / sold.length
    : 0;

  shell.innerHTML = `
    ${toolbar("stats")}

    <div class="stock-head">
      <div>
        <h2>Statistiques</h2>
        <p>Performances réalisées sur les produits vendus.</p>
      </div>
    </div>

    <div class="stock-big-stats">
      <div class="stock-big-stat"><span>Chiffre d'affaires</span><strong>${formatMoney(revenue)}</strong></div>
      <div class="stock-big-stat"><span>Bénéfice total</span><strong>${formatSignedMoney(profit)}</strong></div>
      <div class="stock-big-stat"><span>Produits vendus</span><strong>${sold.length}</strong></div>
      <div class="stock-big-stat"><span>Marge moyenne</span><strong>${averageROI.toFixed(1)} %</strong></div>
    </div>

    <div class="stock-section">
      <div class="stock-section-title"><h3>Ancienne application Stock</h3></div>

      <div class="stock-data-card">
        <div>
          <strong>Importer une sauvegarde Stock & Marge</strong>
          <p>Utilise un fichier JSON exporté depuis ton ancienne application. Les produits MyHub actuels seront remplacés.</p>
        </div>

        <input type="file" id="stock-legacy-import" accept=".json,application/json" hidden>
        <button class="stock-secondary" id="stock-legacy-import-btn">Importer une sauvegarde Stock</button>
      </div>
    </div>
  `;

  bindToolbar(shell);

  const input = shell.querySelector("#stock-legacy-import");
  shell.querySelector("#stock-legacy-import-btn").addEventListener("click", () => input.click());

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const backup = JSON.parse(await file.text());

      if (!backup || !Array.isArray(backup.products)) {
        throw new Error("Ce fichier n'est pas une sauvegarde Stock & Marge valide.");
      }

      if (!confirm(
        `Cette sauvegarde contient ${backup.products.length} produit(s).\n\n` +
        "Les produits présents dans MyHub seront remplacés. Continuer ?"
      )) {
        input.value = "";
        return;
      }

      const normalized = backup.products.map(product => ({
        ...product,
        id: product.id ?? uid("product"),
        createdAt: product.createdAt || new Date().toISOString()
      }));

      await replaceStore("products", normalized);

      alert("Sauvegarde Stock importée avec succès.");
      window.dispatchEvent(new CustomEvent("myhub:data-changed"));

      screen = "home";
      await renderCurrentScreen();
    } catch (error) {
      console.error(error);
      alert(error?.message || "Impossible d'importer cette sauvegarde.");
    }

    input.value = "";
  });
}
