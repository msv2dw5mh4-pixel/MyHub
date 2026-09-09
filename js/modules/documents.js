import { getAll, putOne, deleteOne } from "../core/db.js";
import { escapeHtml, uid, openModal, closeModal, todayISO } from "../core/ui.js";
import { syncDocumentTasks, documentStatus } from "../core/document_tasks.js";


function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });
}

let currentView = "overview";
let currentDocumentId = null;
let dueFilter = "all";
let lastContainer = null;

export async function renderDocuments(container) {
  lastContainer = container;
  container.innerHTML = `<section class="documents-shell" id="documents-shell"></section>`;
  await syncDocumentTasks();
  await renderCurrentView();
}

export function requestNewDocument(preset = {}) {
  currentView = "list";
  window.dispatchEvent(new CustomEvent("myhub:navigate", { detail: "documents" }));
  setTimeout(() => showDocumentModal(null, preset), 120);
}

function tabs(active) {
  return `
    <div class="documents-tabs">
      <button class="documents-tab ${active === "overview" ? "active" : ""}" data-doc-view="overview">Résumé</button>
      <button class="documents-tab ${active === "list" ? "active" : ""}" data-doc-view="list">Documents</button>
      <button class="documents-tab ${active === "due" ? "active" : ""}" data-doc-view="due">Échéances</button>
    </div>
  `;
}

function bindTabs(shell) {
  shell.querySelectorAll("[data-doc-view]").forEach(btn => {
    btn.addEventListener("click", async () => {
      currentView = btn.dataset.docView;
      currentDocumentId = null;
      await renderCurrentView();
    });
  });
}

async function getData() {
  const [documents, assets, projects] = await Promise.all([
    getAll("documents"),
    getAll("maintenanceAssets"),
    getAll("projects")
  ]);

  return {
    documents: [...documents]
      .filter(doc => doc.active !== false)
      .sort((a,b) => String(a.expiryDate || "9999-12-31").localeCompare(String(b.expiryDate || "9999-12-31")) || String(a.title || "").localeCompare(String(b.title || ""))),
    assets,
    projects
  };
}

function fmtDate(date) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00`));
}

function statusClass(status) {
  if (status.state === "due") return "due";
  if (status.state === "soon") return "soon";
  if (status.state === "ok") return "ok";
  return "none";
}

function statusLabel(status) {
  if (status.state === "due") return "À renouveler";
  if (status.state === "soon") return "Bientôt";
  if (status.state === "ok") return "À jour";
  return "Sans échéance";
}

function dueText(doc, status) {
  if (!doc.expiryDate) return "Aucune date d'expiration";
  if (status.remainingDays < 0) return `Document expiré depuis ${Math.abs(status.remainingDays)} jour(s)`;
  if (status.remainingDays === 0) return "Expire aujourd'hui";
  return `${fmtDate(doc.expiryDate)} · dans ${status.remainingDays} jour(s)`;
}

function documentCard(doc, data) {
  const status = documentStatus(doc);
  const asset = data.assets.find(item => item.id === doc.assetId);
  const project = data.projects.find(item => item.id === doc.projectId);
  return `
    <article class="documents-card" data-document-id="${doc.id}">
      <div class="documents-card-head">
        <div>
          <h3>${escapeHtml(doc.title)}</h3>
          <p>${escapeHtml(doc.category || "Document")}${doc.reference ? ` · ${escapeHtml(doc.reference)}` : ""}</p>
          <span class="documents-status ${statusClass(status)}">${statusLabel(status)}</span>
        </div>
        <button class="icon-btn" data-edit-document="${doc.id}" aria-label="Modifier">✎</button>
      </div>

      <div class="documents-due-line ${status.state === "due" ? "due" : status.state === "soon" ? "soon" : ""}">${dueText(doc, status)}</div>

      <div class="documents-meta">
        <div class="documents-metric"><span>Émis le</span><strong>${fmtDate(doc.issueDate)}</strong></div>
        <div class="documents-metric"><span>Rappel</span><strong>${doc.expiryDate ? `${Number(doc.remindDays ?? 30)} j avant` : "—"}</strong></div>
        <div class="documents-metric"><span>Lien</span><strong>${asset?.name || project?.title || "—"}</strong></div>
      </div>
    </article>
  `;
}

async function renderCurrentView() {
  if (!lastContainer) return;
  const shell = lastContainer.querySelector('#documents-shell') || lastContainer;
  await syncDocumentTasks();

  if (currentView === 'detail') return renderDetail(shell, currentDocumentId);
  if (currentView === 'list') return renderList(shell);
  if (currentView === 'due') return renderDue(shell);
  return renderOverview(shell);
}

async function renderOverview(shell) {
  const data = await getData();
  const docs = data.documents.map(doc => ({ doc, status: documentStatus(doc) }));
  const due = docs.filter(item => item.status.state === 'due');
  const soon = docs.filter(item => item.status.state === 'soon');

  shell.innerHTML = `
    ${tabs('overview')}
    <div class="documents-hero">
      <span>Documents & échéances</span>
      <strong>${due.length} à renouveler</strong>
      <small>${soon.length} bientôt · ${data.documents.length} document${data.documents.length > 1 ? 's' : ''} suivi${data.documents.length > 1 ? 's' : ''}</small>
    </div>

    <section class="documents-section">
      <div class="documents-section-head">
        <div>
          <h2>Priorités</h2>
          <p>Tout ce qui doit être renouvelé ou surveillé.</p>
        </div>
        <button class="primary-btn" id="documents-add">+ Document</button>
      </div>
      <div class="documents-list">
        ${due.length || soon.length ? docs.filter(item => ["due","soon"].includes(item.status.state)).slice(0,5).map(item => documentCard(item.doc, data)).join('') : `<div class="documents-empty"><h3>Rien d'urgent</h3><p>Aucune échéance proche pour tes documents.</p></div>`}
      </div>
    </section>
  `;

  bindTabs(shell);
  bindDocumentActions(shell, data);
  shell.querySelector('#documents-add').addEventListener('click', () => showDocumentModal());
}

async function renderList(shell) {
  const data = await getData();
  shell.innerHTML = `
    ${tabs('list')}
    <section class="documents-section">
      <div class="documents-section-head">
        <div><h2>Mes documents</h2><p>${data.documents.length} document${data.documents.length > 1 ? 's' : ''}</p></div>
        <button class="primary-btn" id="documents-add">+ Document</button>
      </div>
      <div class="documents-list">
        ${data.documents.length ? data.documents.map(doc => documentCard(doc, data)).join('') : `<div class="documents-empty"><h3>Aucun document</h3><p>Ajoute passeport, assurance, contrat, garantie ou facture importante.</p></div>`}
      </div>
    </section>
  `;
  bindTabs(shell);
  bindDocumentActions(shell, data);
  shell.querySelector('#documents-add').addEventListener('click', () => showDocumentModal());
}

async function renderDue(shell) {
  const data = await getData();
  let docs = data.documents.map(doc => ({ doc, status: documentStatus(doc) }));
  if (dueFilter !== 'all') docs = docs.filter(item => item.status.state === dueFilter);
  shell.innerHTML = `
    ${tabs('due')}
    <section class="documents-section">
      <div class="documents-section-head">
        <div><h2>Échéances</h2><p>Des tâches automatiques sont créées à l'approche de l'expiration.</p></div>
      </div>
      <div class="documents-filter-row">
        <button class="documents-filter ${dueFilter === 'all' ? 'active' : ''}" data-doc-filter="all">Tous</button>
        <button class="documents-filter ${dueFilter === 'due' ? 'active' : ''}" data-doc-filter="due">À renouveler</button>
        <button class="documents-filter ${dueFilter === 'soon' ? 'active' : ''}" data-doc-filter="soon">Bientôt</button>
        <button class="documents-filter ${dueFilter === 'ok' ? 'active' : ''}" data-doc-filter="ok">À jour</button>
        <button class="documents-filter ${dueFilter === 'none' ? 'active' : ''}" data-doc-filter="none">Sans échéance</button>
      </div>
      <div class="documents-list" style="margin-top:12px">
        ${docs.length ? docs.map(item => documentCard(item.doc, data)).join('') : `<div class="documents-empty"><h3>Aucun document</h3><p>Rien dans ce filtre.</p></div>`}
      </div>
    </section>
  `;
  bindTabs(shell);
  bindDocumentActions(shell, data);
  shell.querySelectorAll('[data-doc-filter]').forEach(btn => btn.addEventListener('click', async () => { dueFilter = btn.dataset.docFilter; await renderDue(shell); }));
}

async function renderDetail(shell, documentId) {
  const data = await getData();
  const doc = data.documents.find(item => item.id === documentId);
  if (!doc) {
    currentView = 'list';
    currentDocumentId = null;
    return renderCurrentView();
  }
  const status = documentStatus(doc);
  const asset = data.assets.find(item => item.id === doc.assetId);
  const project = data.projects.find(item => item.id === doc.projectId);

  shell.innerHTML = `
    <button class="stock-back" id="document-back">‹ Documents</button>
    <div class="documents-hero">
      <span>${escapeHtml(doc.category || 'DOCUMENT')}</span>
      <strong>${escapeHtml(doc.title)}</strong>
      <small>${statusLabel(status)}${doc.expiryDate ? ` · ${fmtDate(doc.expiryDate)}` : ''}</small>
    </div>

    <section class="documents-detail-card" style="margin-top:12px">
      <div class="documents-detail-head">
        <h3>Informations</h3>
        <button class="primary-btn" id="document-edit">Modifier</button>
      </div>
      <div class="maintenance-detail-row"><span>Référence</span><strong>${escapeHtml(doc.reference || '—')}</strong></div>
      <div class="maintenance-detail-row"><span>Date d'émission</span><strong>${fmtDate(doc.issueDate)}</strong></div>
      <div class="maintenance-detail-row"><span>Date d'expiration</span><strong>${fmtDate(doc.expiryDate)}</strong></div>
      <div class="maintenance-detail-row"><span>Rappel</span><strong>${doc.expiryDate ? `${Number(doc.remindDays ?? 30)} jours avant` : '—'}</strong></div>
      <div class="maintenance-detail-row"><span>Bien lié</span><strong>${escapeHtml(asset?.name || '—')}</strong></div>
      <div class="maintenance-detail-row"><span>Projet lié</span><strong>${escapeHtml(project?.title || '—')}</strong></div>
      <div class="maintenance-detail-row"><span>Fichier local</span><strong>${doc.attachmentName ? escapeHtml(doc.attachmentName) : '—'}</strong></div>
    </section>

    ${doc.notes ? `<section class="documents-detail-card" style="margin-top:12px"><h3>Notes</h3><p class="muted" style="margin:8px 0 0;line-height:1.55">${escapeHtml(doc.notes)}</p></section>` : ''}

    <div class="documents-actions">
      ${doc.attachmentData ? `<a class="primary-btn" href="${doc.attachmentData}" download="${escapeHtml(doc.attachmentName || 'document')}" target="_blank" rel="noopener">Ouvrir / enregistrer le fichier</a>` : ''}
      ${asset ? `<button class="ghost-btn" id="document-open-asset">Voir le bien</button>` : ''}
      ${project ? `<button class="ghost-btn" id="document-open-project">Voir le projet</button>` : ''}
      <button class="danger-btn" id="document-delete">Supprimer</button>
    </div>
  `;

  shell.querySelector('#document-back').addEventListener('click', async () => {
    currentDocumentId = null; currentView = 'list'; await renderCurrentView();
  });
  shell.querySelector('#document-edit').addEventListener('click', () => showDocumentModal(doc.id));
  const openAsset = shell.querySelector('#document-open-asset');
  if (openAsset) openAsset.addEventListener('click', () => window.dispatchEvent(new CustomEvent('myhub:navigate', { detail: 'maintenance' })));
  const openProject = shell.querySelector('#document-open-project');
  if (openProject) openProject.addEventListener('click', () => window.dispatchEvent(new CustomEvent('myhub:navigate', { detail: 'projects' })));
  shell.querySelector('#document-delete').addEventListener('click', async () => {
    if (!confirm(`Supprimer le document "${doc.title}" ?`)) return;
    await deleteOne('documents', doc.id);
    await syncDocumentTasks();
    window.dispatchEvent(new CustomEvent('myhub:data-changed'));
    currentDocumentId = null; currentView = 'list';
    await renderCurrentView();
  });
}

function bindDocumentActions(shell, data) {
  shell.querySelectorAll('[data-document-id]').forEach(card => {
    card.addEventListener('click', async event => {
      if (event.target.closest('[data-edit-document]')) return;
      currentDocumentId = card.dataset.documentId;
      currentView = 'detail';
      await renderCurrentView();
    });
  });
  shell.querySelectorAll('[data-edit-document]').forEach(btn => btn.addEventListener('click', event => {
    event.stopPropagation();
    showDocumentModal(btn.dataset.editDocument);
  }));
}

async function showDocumentModal(documentId = null, preset = {}) {
  const [documents, assets, projects] = await Promise.all([
    getAll('documents'),
    getAll('maintenanceAssets'),
    getAll('projects')
  ]);
  const doc = documents.find(item => item.id === documentId);
  const activeProjects = projects.filter(item => item.active !== false);
  const activeAssets = assets.filter(item => item.active !== false);

  openModal(`
    <div class="modal-head">
      <div><p class="eyebrow">DOCUMENT</p><h2>${doc ? 'Modifier' : 'Nouveau'} document</h2></div>
      <button class="icon-btn" id="document-modal-close">×</button>
    </div>

    <form class="form-grid" id="document-form">
      <div class="field"><label>Nom</label><input name="title" required maxlength="120" value="${escapeHtml(doc?.title || preset.title || '')}" placeholder="Ex : Assurance voiture"></div>
      <div class="field"><label>Catégorie</label><input name="category" maxlength="60" value="${escapeHtml(doc?.category || preset.category || '')}" placeholder="Identité, Assurance, Garantie, Contrat..."></div>
      <div class="field"><label>Référence / numéro</label><input name="reference" maxlength="100" value="${escapeHtml(doc?.reference || preset.reference || '')}" placeholder="Facultatif"></div>
      <div class="row">
        <div class="field"><label>Date d'émission</label><input type="date" name="issueDate" value="${doc?.issueDate || preset.issueDate || ''}"></div>
        <div class="field"><label>Date d'expiration</label><input type="date" name="expiryDate" value="${doc?.expiryDate || preset.expiryDate || ''}"></div>
      </div>
      <div class="field"><label>Alerte X jours avant</label><input type="number" min="0" step="1" name="remindDays" value="${doc?.remindDays ?? preset.remindDays ?? 30}"></div>
      <div class="field"><label>Bien lié</label><select name="assetId"><option value="">Aucun</option>${activeAssets.map(asset => `<option value="${asset.id}" ${(doc?.assetId || preset.assetId || '') === asset.id ? 'selected' : ''}>${escapeHtml(asset.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Projet lié</label><select name="projectId"><option value="">Aucun</option>${activeProjects.map(project => `<option value="${project.id}" ${(doc?.projectId || preset.projectId || '') === project.id ? 'selected' : ''}>${escapeHtml(project.title)}</option>`).join('')}</select></div>
      <div class="field">
        <label>Fichier local (facultatif)</label>
        <input type="file" name="attachment" accept="application/pdf,image/*,.pdf">
        ${doc?.attachmentName ? `<small class="muted">Actuel : ${escapeHtml(doc.attachmentName)} · laisser vide pour le conserver.</small><label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" name="removeAttachment"> Supprimer le fichier actuel</label>` : `<small class="muted">PDF ou image, 5 Mo maximum. Inclus dans la sauvegarde JSON MyHub.</small>`}
      </div>
      <div class="field"><label>Notes</label><textarea name="notes" placeholder="Commentaires, emplacement du fichier, rappel utile...">${escapeHtml(doc?.notes || preset.notes || '')}</textarea></div>
      <div class="actions"><button type="button" class="ghost-btn" id="document-modal-cancel">Annuler</button><button class="primary-btn" type="submit">Enregistrer</button></div>
    </form>
  `);

  document.querySelector('#document-modal-close').addEventListener('click', closeModal);
  document.querySelector('#document-modal-cancel').addEventListener('click', closeModal);

  document.querySelector('#document-form').addEventListener('submit', async event => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const file = fd.get('attachment');
    const removeAttachment = fd.get('removeAttachment') === 'on';
    let attachmentData = removeAttachment ? '' : (doc?.attachmentData || '');
    let attachmentName = removeAttachment ? '' : (doc?.attachmentName || '');
    let attachmentType = removeAttachment ? '' : (doc?.attachmentType || '');

    if (file instanceof File && file.size > 0) {
      if (file.size > 5 * 1024 * 1024) {
        alert('Le fichier doit faire moins de 5 Mo.');
        return;
      }
      attachmentData = await fileToDataUrl(file);
      attachmentName = file.name;
      attachmentType = file.type || '';
    }

    const saved = {
      ...(doc || {}),
      id: doc?.id || uid('document'),
      title: String(fd.get('title') || '').trim(),
      category: String(fd.get('category') || '').trim(),
      reference: String(fd.get('reference') || '').trim(),
      issueDate: String(fd.get('issueDate') || ''),
      expiryDate: String(fd.get('expiryDate') || ''),
      remindDays: Number(fd.get('remindDays') || 0),
      assetId: String(fd.get('assetId') || '') || null,
      projectId: String(fd.get('projectId') || '') || null,
      notes: String(fd.get('notes') || '').trim(),
      attachmentData,
      attachmentName,
      attachmentType,
      taskDismissedKey: doc?.taskDismissedKey || null,
      active: true,
      createdAt: doc?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await putOne('documents', saved);
    await syncDocumentTasks();
    closeModal();
    window.dispatchEvent(new CustomEvent('myhub:data-changed'));
    currentDocumentId = saved.id;
    currentView = 'detail';
    await renderCurrentView();
  });
}

export async function getDocumentsSummary() {
  await syncDocumentTasks();
  const data = await getData();
  const rows = data.documents.map(doc => documentStatus(doc));
  return {
    total: data.documents.length,
    due: rows.filter(row => row.state === 'due').length,
    soon: rows.filter(row => row.state === 'soon').length
  };
}
