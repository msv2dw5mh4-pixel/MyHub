import { getAll, putOne, deleteOne } from "../core/db.js";
import { escapeHtml, uid, openModal, closeModal, todayISO } from "../core/ui.js";

let currentView = "overview";
let monthFilter = monthKey(todayISO());
let lastContainer = null;

function monthKey(dateString) {
  return String(dateString || todayISO()).slice(0,7);
}

function monthLabel(key) {
  const [year, month] = String(key).split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { month:'long', year:'numeric' }).format(new Date(year, (month || 1) - 1, 1));
}

function formatMoney(value) {
  return new Intl.NumberFormat('fr-FR', { style:'currency', currency:'EUR', minimumFractionDigits:0, maximumFractionDigits:2 }).format(Number(value) || 0);
}

function signedMoney(value) {
  const n = Number(value) || 0;
  const raw = formatMoney(Math.abs(n));
  return n > 0 ? `+${raw}` : n < 0 ? `-${raw}` : raw;
}

function tabs(active) {
  return `
    <div class="budget-tabs">
      <button class="budget-tab ${active === 'overview' ? 'active' : ''}" data-budget-view="overview">Résumé</button>
      <button class="budget-tab ${active === 'transactions' ? 'active' : ''}" data-budget-view="transactions">Transactions</button>
      <button class="budget-tab ${active === 'months' ? 'active' : ''}" data-budget-view="months">Mois</button>
    </div>
  `;
}

function bindTabs(shell) {
  shell.querySelectorAll('[data-budget-view]').forEach(btn => btn.addEventListener('click', async () => {
    currentView = btn.dataset.budgetView;
    await renderCurrentView();
  }));
}

async function getData() {
  const [transactions, projects, objectives] = await Promise.all([
    getAll('budgetTransactions'),
    getAll('projects'),
    getAll('objectives')
  ]);

  return {
    transactions: [...transactions].sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
    projects: projects.filter(project => project.active !== false),
    objectives: objectives.filter(objective => (objective.status || 'active') !== 'completed' && objective.status !== 'cancelled')
  };
}

function monthStats(transactions, key) {
  const rows = transactions.filter(tx => monthKey(tx.date) === key);
  const income = rows.filter(tx => tx.type === 'income').reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const expenses = rows.filter(tx => tx.type === 'expense').reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const savings = rows.filter(tx => tx.type === 'saving').reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  return {
    rows,
    income,
    expenses,
    savings,
    available: income - expenses - savings
  };
}

function expenseBreakdown(rows) {
  const map = new Map();
  rows.filter(tx => tx.type === 'expense').forEach(tx => {
    const key = tx.category || 'Autre';
    map.set(key, (map.get(key) || 0) + Number(tx.amount || 0));
  });
  return [...map.entries()].map(([category, amount]) => ({ category, amount })).sort((a,b) => b.amount - a.amount);
}

function transactionTypeLabel(type) {
  return type === 'income' ? 'Revenu' : type === 'saving' ? 'Épargne' : 'Dépense';
}

function amountClass(type) {
  return type === 'expense' ? 'expense' : 'income';
}

function transactionCard(tx, projectMap, objectiveMap) {
  const project = projectMap.get(tx.projectId);
  const objective = objectiveMap.get(tx.objectiveId);
  return `
    <article class="budget-item" data-budget-id="${tx.id}">
      <div class="budget-item-head">
        <div>
          <h3>${escapeHtml(tx.title || tx.category || transactionTypeLabel(tx.type))}</h3>
          <p>${new Intl.DateTimeFormat('fr-FR', { day:'numeric', month:'short', year:'numeric' }).format(new Date(`${tx.date}T12:00:00`))} · ${escapeHtml(tx.category || 'Sans catégorie')}${project ? ` · 📁 ${escapeHtml(project.title)}` : ''}${objective ? ` · 🎯 ${escapeHtml(objective.title)}` : ''}</p>
          ${tx.notes ? `<p>${escapeHtml(tx.notes)}</p>` : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:flex-start">
          <div class="budget-amount ${amountClass(tx.type)}">${tx.type === 'expense' ? '-' : '+'}${formatMoney(tx.amount)}</div>
          <button class="icon-btn" data-budget-edit="${tx.id}" aria-label="Modifier">✎</button>
        </div>
      </div>
    </article>
  `;
}

export async function renderBudget(container) {
  lastContainer = container;
  container.innerHTML = `<section class="budget-shell" id="budget-shell"></section>`;
  await renderCurrentView();
}

export function requestNewBudgetEntry(preset = {}) {
  currentView = 'transactions';
  window.dispatchEvent(new CustomEvent('myhub:navigate', { detail: 'budget' }));
  setTimeout(() => showTransactionModal(null, preset), 120);
}

async function renderCurrentView() {
  if (!lastContainer) return;
  const shell = lastContainer.querySelector('#budget-shell') || lastContainer;
  if (currentView === 'transactions') return renderTransactions(shell);
  if (currentView === 'months') return renderMonths(shell);
  return renderOverview(shell);
}

async function renderOverview(shell) {
  const data = await getData();
  const stats = monthStats(data.transactions, monthFilter);
  const breakdown = expenseBreakdown(stats.rows);
  const projectMap = new Map(data.projects.map(item => [item.id, item]));
  const objectiveMap = new Map(data.objectives.map(item => [item.id, item]));

  shell.innerHTML = `
    ${tabs('overview')}
    <div class="budget-hero">
      <span>Budget · ${monthLabel(monthFilter)}</span>
      <strong>${signedMoney(stats.available)}</strong>
      <small>${formatMoney(stats.income)} de revenus · ${formatMoney(stats.expenses)} de dépenses · ${formatMoney(stats.savings)} d'épargne</small>
    </div>

    <section class="budget-section">
      <div class="budget-section-head">
        <div><h2>Vue rapide</h2><p>Le mois sélectionné en un coup d'œil.</p></div>
        <button class="primary-btn" id="budget-add">+ Mouvement</button>
      </div>
      <div class="budget-grid">
        <div class="budget-box"><span>Revenus</span><strong>${formatMoney(stats.income)}</strong><small>${stats.rows.filter(tx => tx.type === 'income').length} entrée(s)</small></div>
        <div class="budget-box"><span>Dépenses</span><strong>${formatMoney(stats.expenses)}</strong><small>${stats.rows.filter(tx => tx.type === 'expense').length} entrée(s)</small></div>
        <div class="budget-box"><span>Épargne</span><strong>${formatMoney(stats.savings)}</strong><small>${stats.rows.filter(tx => tx.type === 'saving').length} entrée(s)</small></div>
        <div class="budget-box"><span>Disponible</span><strong>${signedMoney(stats.available)}</strong><small>${monthLabel(monthFilter)}</small></div>
      </div>
    </section>

    <section class="budget-section">
      <div class="budget-section-head"><div><h2>Dépenses par catégorie</h2><p>Répartition du mois.</p></div></div>
      <div class="budget-bars">
        ${breakdown.length ? breakdown.slice(0,6).map(row => {
          const pct = stats.expenses > 0 ? Math.round((row.amount / stats.expenses) * 100) : 0;
          return `<div class="budget-bar-row"><header><strong>${escapeHtml(row.category)}</strong><span>${formatMoney(row.amount)} · ${pct} %</span></header><div class="budget-progress"><i style="width:${pct}%"></i></div></div>`;
        }).join('') : `<div class="budget-empty"><h3>Aucune dépense</h3><p>Ajoute tes premières opérations pour voir la répartition.</p></div>`}
      </div>
    </section>

    <section class="budget-section">
      <div class="budget-section-head"><div><h2>Derniers mouvements</h2><p>Les 5 plus récents.</p></div></div>
      <div class="budget-list">
        ${data.transactions.length ? data.transactions.slice(0,5).map(tx => transactionCard(tx, projectMap, objectiveMap)).join('') : `<div class="budget-empty"><h3>Aucun mouvement</h3><p>Commence par enregistrer un revenu, une dépense ou de l'épargne.</p></div>`}
      </div>
    </section>
  `;

  bindTabs(shell);
  bindTransactionActions(shell, data);
  shell.querySelector('#budget-add').addEventListener('click', () => showTransactionModal());
}

async function renderTransactions(shell) {
  const data = await getData();
  const projectMap = new Map(data.projects.map(item => [item.id, item]));
  const objectiveMap = new Map(data.objectives.map(item => [item.id, item]));
  const months = [...new Set(data.transactions.map(tx => monthKey(tx.date)))].sort().reverse();
  if (!months.includes(monthFilter) && months.length) monthFilter = months[0];
  const shown = data.transactions.filter(tx => monthFilter === 'all' ? true : monthKey(tx.date) === monthFilter);

  shell.innerHTML = `
    ${tabs('transactions')}
    <section class="budget-section">
      <div class="budget-section-head">
        <div><h2>Transactions</h2><p>${shown.length} ligne(s) affichée(s)</p></div>
        <button class="primary-btn" id="budget-add">+ Mouvement</button>
      </div>
      <div class="budget-filter-row">
        <button class="budget-filter ${monthFilter === 'all' ? 'active' : ''}" data-budget-month="all">Toutes</button>
        ${months.slice(0,8).map(key => `<button class="budget-filter ${monthFilter === key ? 'active' : ''}" data-budget-month="${key}">${escapeHtml(monthLabel(key))}</button>`).join('')}
      </div>
      <div class="budget-list" style="margin-top:12px">
        ${shown.length ? shown.map(tx => transactionCard(tx, projectMap, objectiveMap)).join('') : `<div class="budget-empty"><h3>Aucune transaction</h3><p>Rien dans cette vue.</p></div>`}
      </div>
    </section>
  `;
  bindTabs(shell);
  bindTransactionActions(shell, data);
  shell.querySelector('#budget-add').addEventListener('click', () => showTransactionModal());
  shell.querySelectorAll('[data-budget-month]').forEach(btn => btn.addEventListener('click', async () => { monthFilter = btn.dataset.budgetMonth; await renderTransactions(shell); }));
}

async function renderMonths(shell) {
  const data = await getData();
  const months = [...new Set(data.transactions.map(tx => monthKey(tx.date)))];
  const ordered = months.length ? months.sort().reverse() : [monthKey(todayISO())];

  shell.innerHTML = `
    ${tabs('months')}
    <section class="budget-section">
      <div class="budget-section-head"><div><h2>Historique mensuel</h2><p>Comparaison rapide mois par mois.</p></div></div>
      <div class="budget-list">
        ${ordered.map(key => {
          const stats = monthStats(data.transactions, key);
          return `<article class="budget-card"><div class="budget-card-head"><div><h3>${escapeHtml(monthLabel(key))}</h3><p>${stats.rows.length} mouvement(s)</p></div><div class="budget-amount ${stats.available >= 0 ? 'income' : 'expense'}">${signedMoney(stats.available)}</div></div><div class="budget-grid" style="margin-top:12px"><div class="budget-box"><span>Revenus</span><strong>${formatMoney(stats.income)}</strong></div><div class="budget-box"><span>Dépenses</span><strong>${formatMoney(stats.expenses)}</strong></div><div class="budget-box"><span>Épargne</span><strong>${formatMoney(stats.savings)}</strong></div><div class="budget-box"><span>Disponible</span><strong>${signedMoney(stats.available)}</strong></div></div></article>`;
        }).join('')}
      </div>
    </section>
  `;
  bindTabs(shell);
}

function bindTransactionActions(shell, data) {
  shell.querySelectorAll('[data-budget-edit]').forEach(btn => btn.addEventListener('click', event => {
    event.stopPropagation();
    showTransactionModal(btn.dataset.budgetEdit);
  }));
}

async function showTransactionModal(transactionId = null, preset = {}) {
  const data = await getData();
  const tx = data.transactions.find(item => item.id === transactionId);

  openModal(`
    <div class="modal-head">
      <div><p class="eyebrow">BUDGET</p><h2>${tx ? 'Modifier' : 'Nouveau'} mouvement</h2></div>
      <button class="icon-btn" id="budget-modal-close">×</button>
    </div>

    <form class="form-grid" id="budget-form">
      <div class="field"><label>Titre</label><input name="title" maxlength="120" value="${escapeHtml(tx?.title || preset.title || '')}" placeholder="Ex : Salaire, Courses Lidl, Virement épargne..."></div>
      <div class="row">
        <div class="field"><label>Type</label><select name="type"><option value="income" ${(tx?.type || preset.type || 'expense') === 'income' ? 'selected' : ''}>Revenu</option><option value="expense" ${(tx?.type || preset.type || 'expense') === 'expense' ? 'selected' : ''}>Dépense</option><option value="saving" ${(tx?.type || preset.type || 'expense') === 'saving' ? 'selected' : ''}>Épargne</option></select></div>
        <div class="field"><label>Montant (€)</label><input type="number" min="0" step="0.01" name="amount" required value="${tx?.amount ?? preset.amount ?? ''}" placeholder="0"></div>
      </div>
      <div class="row">
        <div class="field"><label>Date</label><input type="date" name="date" value="${tx?.date || preset.date || todayISO()}" required></div>
        <div class="field"><label>Catégorie</label><input name="category" maxlength="60" value="${escapeHtml(tx?.category || preset.category || '')}" placeholder="Courses, Logement, Sorties..."></div>
      </div>
      <div class="field"><label>Projet lié</label><select name="projectId"><option value="">Aucun</option>${data.projects.map(project => `<option value="${project.id}" ${(tx?.projectId || preset.projectId || '') === project.id ? 'selected' : ''}>${escapeHtml(project.title)}</option>`).join('')}</select></div>
      <div class="field"><label>Objectif lié</label><select name="objectiveId"><option value="">Aucun</option>${data.objectives.map(objective => `<option value="${objective.id}" ${(tx?.objectiveId || preset.objectiveId || '') === objective.id ? 'selected' : ''}>${escapeHtml(objective.title)}</option>`).join('')}</select></div>
      <div class="field"><label>Notes</label><textarea name="notes" placeholder="Précisions, compte utilisé, détails...">${escapeHtml(tx?.notes || preset.notes || '')}</textarea></div>
      <div class="actions"><button type="button" class="ghost-btn" id="budget-modal-cancel">Annuler</button><button class="primary-btn" type="submit">Enregistrer</button></div>
      ${tx ? `<button type="button" class="danger-btn" id="budget-delete">Supprimer</button>` : ''}
    </form>
  `);

  document.querySelector('#budget-modal-close').addEventListener('click', closeModal);
  document.querySelector('#budget-modal-cancel').addEventListener('click', closeModal);

  document.querySelector('#budget-form').addEventListener('submit', async event => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const saved = {
      ...(tx || {}),
      id: tx?.id || uid('budget_tx'),
      title: String(fd.get('title') || '').trim(),
      type: String(fd.get('type') || 'expense'),
      amount: Number(fd.get('amount') || 0),
      date: String(fd.get('date') || todayISO()),
      category: String(fd.get('category') || '').trim(),
      projectId: String(fd.get('projectId') || '') || null,
      objectiveId: String(fd.get('objectiveId') || '') || null,
      notes: String(fd.get('notes') || '').trim(),
      createdAt: tx?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await putOne('budgetTransactions', saved);
    closeModal();
    window.dispatchEvent(new CustomEvent('myhub:data-changed'));
    await renderCurrentView();
  });

  const del = document.querySelector('#budget-delete');
  if (del) del.addEventListener('click', async () => {
    if (!confirm('Supprimer cette transaction ?')) return;
    await deleteOne('budgetTransactions', tx.id);
    closeModal();
    window.dispatchEvent(new CustomEvent('myhub:data-changed'));
    await renderCurrentView();
  });
}

export async function getBudgetSummary() {
  const data = await getData();
  const stats = monthStats(data.transactions, monthKey(todayISO()));
  return {
    month: monthKey(todayISO()),
    income: stats.income,
    expenses: stats.expenses,
    savings: stats.savings,
    available: stats.available,
    count: stats.rows.length
  };
}
