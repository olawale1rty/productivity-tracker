/* ═══════════════════════════════════════════════════════════════════════
   PRODUCTIVITY FRAMEWORK TRACKER — JavaScript (All Features)
   ═══════════════════════════════════════════════════════════════════════ */

// ── API ────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
    const res = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
        body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

// ── Toast (with variants) ──────────────────────────────────────────────
function toast(msg, variant = 'info', ms = 2500) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast toast-' + variant;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), ms);
}

function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ── Custom Confirm (replaces native confirm) ───────────────────────────
let _confirmResolve = null;
function customConfirm(title, message) {
    return new Promise(resolve => {
        _confirmResolve = resolve;
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmMessage').textContent = message;
        document.getElementById('confirmModal').classList.remove('hidden');
    });
}
document.getElementById('confirmOk').addEventListener('click', () => {
    document.getElementById('confirmModal').classList.add('hidden');
    if (_confirmResolve) { _confirmResolve(true); _confirmResolve = null; }
});
document.getElementById('confirmCancel').addEventListener('click', () => {
    document.getElementById('confirmModal').classList.add('hidden');
    if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
});

// ── Undo System ────────────────────────────────────────────────────────
let _undoAction = null;
let _undoTimer = null;
function showUndo(message, undoFn, ms = 5000) {
    _undoAction = undoFn;
    document.getElementById('undoMessage').textContent = message;
    document.getElementById('undoBar').classList.remove('hidden');
    clearTimeout(_undoTimer);
    _undoTimer = setTimeout(() => {
        document.getElementById('undoBar').classList.add('hidden');
        _undoAction = null;
    }, ms);
}
document.getElementById('undoBtn').addEventListener('click', async () => {
    document.getElementById('undoBar').classList.add('hidden');
    if (_undoAction) {
        try { await _undoAction(); toast('Undone!', 'success'); }
        catch (e) { toast('Undo failed', 'error'); }
        _undoAction = null;
    }
});

// ── State ──────────────────────────────────────────────────────────────
let currentListId = null;
let currentItems = [];
let currentFrameworks = [];
let frameworksCatalog = {};
let activeFrameworkTab = null;
let editingListId = null;
let editingItemId = null;
let draggedItemId = null;
let allLists = [];
let allTags = [];
let selectedItemIds = new Set();
let currentView = 'dashboard';

// ── Theme ──────────────────────────────────────────────────────────────
function initTheme() {
    const saved = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcons(saved);
}
function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcons(next);
}
function updateThemeIcons(theme) {
    document.getElementById('themeIconLight').classList.toggle('hidden', theme === 'dark');
    document.getElementById('themeIconDark').classList.toggle('hidden', theme === 'light');
}

// ── Auth ───────────────────────────────────────────────────────────────
let isLogin = true;
const authScreen = document.getElementById('authScreen');
const mainApp = document.getElementById('mainApp');

function toggleAuthMode() {
    isLogin = !isLogin;
    document.getElementById('authTitle').textContent = isLogin ? 'Sign In' : 'Create Account';
    document.getElementById('authSubmit').textContent = isLogin ? 'Sign In' : 'Create Account';
    document.getElementById('authSwitchText').textContent = isLogin ? "Don't have an account?" : 'Already have an account?';
    document.getElementById('authSwitch').textContent = isLogin ? 'Create one' : 'Sign in';
    document.getElementById('authError').textContent = '';
}

async function handleAuth() {
    const errEl = document.getElementById('authError');
    errEl.textContent = '';
    const username = document.getElementById('authUser').value.trim();
    const password = document.getElementById('authPass').value;
    if (!username || !password) { errEl.textContent = 'Fill in all fields'; return; }
    try {
        const data = await api(isLogin ? '/api/login' : '/api/register', {
            method: 'POST', body: { username, password }
        });
        showApp(data.username);
    } catch (e) { errEl.textContent = e.message; }
}

async function checkAuth() {
    try {
        const data = await api('/api/me');
        if (data.logged_in) showApp(data.username);
    } catch { }
}

function showApp(username) {
    authScreen.classList.add('hidden');
    mainApp.classList.remove('hidden');
    document.getElementById('navUser').textContent = username;
    // Avatar initials
    const initials = username.slice(0, 2).toUpperCase();
    document.getElementById('navAvatar').textContent = initials;
    loadCatalog();
    loadTags();
    switchView('dashboard');
}

// ── Sidebar Navigation ────────────────────────────────────────────────
function switchView(view) {
    currentView = view;
    // Hide all views
    ['dashboardView', 'listsView', 'sharedView', 'templatesView', 'detailView'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
    document.getElementById('breadcrumb').classList.add('hidden');
    // Update sidebar active
    document.querySelectorAll('.sidebar-item').forEach(el => {
        el.classList.toggle('active', el.dataset.view === view);
    });
    // Show target view
    switch (view) {
        case 'dashboard':
            document.getElementById('dashboardView').classList.remove('hidden');
            document.getElementById('dashboardView').classList.add('view-transition');
            loadDashboard();
            break;
        case 'lists':
            document.getElementById('listsView').classList.remove('hidden');
            document.getElementById('listsView').classList.add('view-transition');
            loadLists();
            break;
        case 'shared':
            document.getElementById('sharedView').classList.remove('hidden');
            document.getElementById('sharedView').classList.add('view-transition');
            loadSharedLists();
            break;
        case 'templates':
            document.getElementById('templatesView').classList.remove('hidden');
            document.getElementById('templatesView').classList.add('view-transition');
            loadTemplates();
            break;
    }
}

document.querySelectorAll('.sidebar-item').forEach(btn => {
    btn.addEventListener('click', () => {
        switchView(btn.dataset.view);
        // Close sidebar on mobile after navigation
        if (window.innerWidth < 769) {
            document.getElementById('sidebar').classList.remove('open');
            document.getElementById('sidebarOverlay').classList.remove('active');
        }
    });
});

// Sidebar toggle for mobile
document.getElementById('sidebarToggle').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active', sidebar.classList.contains('open'));
});
document.getElementById('sidebarOverlay').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('active');
});

// ── Loading States ─────────────────────────────────────────────────────
function showLoading() {
    document.getElementById('loadingSkeleton').classList.remove('hidden');
}
function hideLoading() {
    document.getElementById('loadingSkeleton').classList.add('hidden');
}

// ── Catalog ────────────────────────────────────────────────────────────
async function loadCatalog() {
    try { frameworksCatalog = await api('/api/frameworks-catalog'); }
    catch (e) { console.error(e); }
}

// ── Tags ───────────────────────────────────────────────────────────────
async function loadTags() {
    try { allTags = await api('/api/tags'); }
    catch (e) { console.error(e); }
    updateTagFilter();
}

function updateTagFilter() {
    const sel = document.getElementById('filterTag');
    if (!sel) return;
    const current = sel.value;
    // Clear and rebuild using createElement to avoid innerHTML quirks on <select>
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'All tags';
    sel.appendChild(defaultOpt);
    allTags.forEach(t => {
        const opt = document.createElement('option');
        opt.value = String(t.id);
        opt.textContent = t.name;
        sel.appendChild(opt);
    });
    sel.value = current;
}

// ── Dashboard ──────────────────────────────────────────────────────────
async function loadDashboard() {
    try {
        const data = await api('/api/dashboard');
        document.getElementById('statLists').textContent = data.total_lists;
        document.getElementById('statItems').textContent = data.total_items;
        document.getElementById('statCompleted').textContent = data.completed_items;
        document.getElementById('statOverdue').textContent = data.overdue_items;
        document.getElementById('statHighPri').textContent = data.high_priority;
        document.getElementById('statRate').textContent = data.completion_rate + '%';

        // Framework usage chart
        const chartEl = document.getElementById('fwUsageChart');
        const maxCount = Math.max(1, ...Object.values(data.framework_usage));
        if (Object.keys(data.framework_usage).length === 0) {
            chartEl.innerHTML = '<div style="font-size:0.82rem;color:var(--text-tertiary)">No frameworks in use yet</div>';
        } else {
            chartEl.innerHTML = '';
            for (const [key, cnt] of Object.entries(data.framework_usage)) {
                const fw = frameworksCatalog[key];
                if (!fw) continue;
                const pct = (cnt / maxCount * 100).toFixed(0);
                chartEl.innerHTML += `
                    <div class="fw-usage-row">
                        <span style="min-width:120px">${fw.icon} ${esc(fw.name)}</span>
                        <div class="fw-usage-bar-bg"><div class="fw-usage-bar" style="width:${pct}%;background:${fw.color}"></div></div>
                        <span class="fw-usage-count">${cnt}</span>
                    </div>`;
            }
        }

        // Recent items
        const recentEl = document.getElementById('recentItems');
        if (!data.recent_items.length) {
            recentEl.innerHTML = '<div style="font-size:0.82rem;color:var(--text-tertiary)">No items yet</div>';
        } else {
            recentEl.innerHTML = '';
            data.recent_items.forEach(item => {
                const priColor = item.priority === 'high' ? 'var(--danger)' : item.priority === 'low' ? 'var(--success)' : 'var(--warning)';
                recentEl.innerHTML += `
                    <div class="recent-item">
                        <div class="ri-priority" style="background:${priColor}"></div>
                        <span class="ri-title">${esc(item.title)}</span>
                        <span class="ri-list">${esc(item.list_name)}</span>
                    </div>`;
            });
        }
        // Also update sidebar list links
        loadSidebarLists();
    } catch (e) { console.error(e); }
}

async function loadSidebarLists() {
    try {
        allLists = await api('/api/lists');
        const container = document.getElementById('sidebarListItems');
        if (!container) return;
        container.innerHTML = '';
        allLists.forEach(l => {
            const a = document.createElement('a');
            a.className = 'sidebar-list-link';
            a.textContent = l.name;
            a.title = l.name;
            a.href = '#';
            a.addEventListener('click', (e) => { e.preventDefault(); openList(l.id); });
            container.appendChild(a);
        });
    } catch (e) { console.error(e); }
}

// ── Lists ──────────────────────────────────────────────────────────────
async function loadLists() {
    showLoading();
    try {
        allLists = await api('/api/lists');
        hideLoading();
        renderLists(allLists);
    } catch (e) { hideLoading(); console.error(e); }
}

function renderLists(lists) {
    const grid = document.getElementById('listsGrid');
    const empty = document.getElementById('listsEmpty');
    grid.innerHTML = '';
    if (!lists.length) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    lists.forEach((l, idx) => {
        const card = document.createElement('div');
        card.className = 'list-card';
        card.style.animationDelay = (idx * 60) + 'ms';
        const badges = (l.frameworks || []).map(fk => {
            const fw = frameworksCatalog[fk];
            return fw ? `<span class="card-badge">${fw.icon} ${fw.name}</span>` : '';
        }).join('');
        const total = l.item_count || 0;
        const completed = l.completed_count || 0;
        const pct = total ? Math.round(completed / total * 100) : 0;
        card.innerHTML = `
            <h3>${esc(l.name)}</h3>
            <div class="card-desc">${esc(l.description || 'No description')}</div>
            <div class="card-meta">
                <span>${total} item${total !== 1 ? 's' : ''}${completed ? ` &middot; ${completed} done` : ''}</span>
                <div class="card-badges">${badges}</div>
            </div>
            ${total ? `<div class="card-progress"><div class="card-progress-bar" style="width:${pct}%"></div></div>` : ''}
        `;
        card.addEventListener('click', () => openList(l.id));
        grid.appendChild(card);
    });
}

// ── Shared Lists ───────────────────────────────────────────────────────
async function loadSharedLists() {
    try {
        const lists = await api('/api/shared-lists');
        const grid = document.getElementById('sharedGrid');
        const empty = document.getElementById('sharedEmpty');
        grid.innerHTML = '';
        if (!lists.length) { empty.classList.remove('hidden'); return; }
        empty.classList.add('hidden');
        lists.forEach(l => {
            const card = document.createElement('div');
            card.className = 'list-card';
            card.innerHTML = `
                <h3>${esc(l.name)}</h3>
                <div class="card-desc">${esc(l.description || 'No description')}</div>
                <div class="card-meta">
                    <span>Shared by ${esc(l.owner_name)} &middot; ${l.permission}</span>
                    <span>${l.item_count} item${l.item_count !== 1 ? 's' : ''}</span>
                </div>
            `;
            grid.appendChild(card);
        });
    } catch (e) { console.error(e); }
}

// ── Templates ──────────────────────────────────────────────────────────
async function loadTemplates() {
    try {
        const templates = await api('/api/templates');
        const grid = document.getElementById('templatesGrid');
        const empty = document.getElementById('templatesEmpty');
        grid.innerHTML = '';
        if (!templates.length) { empty.classList.remove('hidden'); return; }
        empty.classList.add('hidden');
        templates.forEach(t => {
            const items = JSON.parse(t.items_json || '[]');
            const card = document.createElement('div');
            card.className = 'list-card';
            card.innerHTML = `
                <h3>${esc(t.name)}</h3>
                <div class="card-desc">${esc(t.description || 'Template')}</div>
                <div class="card-meta">
                    <span>${items.length} item${items.length !== 1 ? 's' : ''}</span>
                    <div class="card-badges">
                        <button class="btn btn-xs btn-primary tmpl-use" data-id="${t.id}">Use</button>
                        <button class="btn btn-xs btn-danger-outline tmpl-del" data-id="${t.id}">Delete</button>
                    </div>
                </div>
            `;
            card.querySelector('.tmpl-use').addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    await api(`/api/templates/${t.id}/create-list`, { method: 'POST', body: { name: t.name + ' (copy)' } });
                    toast('List created from template', 'success');
                    switchView('lists');
                } catch (err) { toast(err.message, 'error'); }
            });
            card.querySelector('.tmpl-del').addEventListener('click', async (e) => {
                e.stopPropagation();
                const ok = await customConfirm('Delete Template', 'Delete this template permanently?');
                if (!ok) return;
                try {
                    await api(`/api/templates/${t.id}`, { method: 'DELETE' });
                    toast('Template deleted', 'success');
                    loadTemplates();
                } catch (err) { toast(err.message, 'error'); }
            });
            grid.appendChild(card);
        });
    } catch (e) { console.error(e); }
}

// ── Navigation ─────────────────────────────────────────────────────────
function openList(listId) {
    currentListId = listId;
    selectedItemIds.clear();
    updateBulkUI();
    // Hide all views, show detail
    ['dashboardView', 'listsView', 'sharedView', 'templatesView'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
    document.getElementById('detailView').classList.remove('hidden');
    document.getElementById('detailView').classList.add('view-transition');
    // Breadcrumb
    const bc = document.getElementById('breadcrumb');
    bc.classList.remove('hidden');
    bc.innerHTML = `<a href="#" onclick="goBack(); return false;">My Lists</a><span class="sep">/</span><span id="bcListName">...</span>`;
    // Reset tabs to items
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'items'));
    document.getElementById('itemsTabContent').classList.remove('hidden');
    document.getElementById('frameworksTabContent').classList.add('hidden');
    activeFrameworkTab = null;
    // Reset filters when opening a new list
    const searchEl = document.getElementById('searchItemsInput');
    const priEl = document.getElementById('filterPriority');
    const statusEl = document.getElementById('filterStatus');
    const tagEl = document.getElementById('filterTag');
    if (searchEl) searchEl.value = '';
    if (priEl) priEl.value = '';
    if (statusEl) statusEl.value = '';
    if (tagEl) tagEl.value = '';
    loadListDetail();
}

function goBack() {
    document.getElementById('detailView').classList.add('hidden');
    document.getElementById('breadcrumb').classList.add('hidden');
    currentListId = null;
    currentItems = [];
    currentFrameworks = [];
    activeFrameworkTab = null;
    selectedItemIds.clear();
    switchView('lists');
}

async function loadListDetail() {
    try {
        const [lists, items, frameworks] = await Promise.all([
            api('/api/lists'),
            api(`/api/lists/${currentListId}/items`),
            api(`/api/lists/${currentListId}/frameworks`)
        ]);
        allLists = lists;
        const list = lists.find(l => l.id === currentListId);
        document.getElementById('detailTitle').textContent = list?.name || 'List';
        document.getElementById('detailDesc').textContent = list?.description || '';
        const bcName = document.getElementById('bcListName');
        if (bcName) bcName.textContent = list?.name || '';
        currentItems = items;
        currentFrameworks = frameworks;
        // Refresh tag filter dropdown so newly created tags are available
        await loadTags();
        renderItems();
        renderFrameworksCatalog();
        renderFrameworkTabs();
        updateBadges();
    } catch (e) { toast(e.message, 'error'); }
}

function updateBadges() {
    const ic = document.getElementById('itemCountBadge');
    const fc = document.getElementById('fwCountBadge');
    if (ic) ic.textContent = currentItems.length;
    if (fc) fc.textContent = currentFrameworks.length;
}

// ── Search & Filter ────────────────────────────────────────────────────
function getFilteredItems() {
    let items = [...currentItems];
    const searchEl = document.getElementById('searchItemsInput');
    const priEl = document.getElementById('filterPriority');
    const statusEl = document.getElementById('filterStatus');
    const tagEl = document.getElementById('filterTag');

    const query = (searchEl?.value || '').toLowerCase().trim();
    const priority = priEl?.value || '';
    const status = statusEl?.value || '';
    const tagId = tagEl?.value || '';

    if (query) {
        items = items.filter(i => i.title.toLowerCase().includes(query) || (i.description || '').toLowerCase().includes(query));
    }
    if (priority) {
        items = items.filter(i => (i.priority || 'medium') === priority);
    }
    if (status === 'completed') {
        items = items.filter(i => i.completed);
    } else if (status === 'active') {
        items = items.filter(i => !i.completed);
    }
    if (tagId) {
        items = items.filter(i => (i.tags || []).some(t => t.id === parseInt(tagId)));
    }
    return items;
}

function bindFilterEvents() {
    const searchEl = document.getElementById('searchItemsInput');
    const priEl = document.getElementById('filterPriority');
    const statusEl = document.getElementById('filterStatus');
    const tagEl = document.getElementById('filterTag');
    const handler = () => { renderItems(); updateFilterIndicator(); };
    if (searchEl) searchEl.addEventListener('input', handler);
    if (priEl) priEl.addEventListener('change', handler);
    if (statusEl) statusEl.addEventListener('change', handler);
    if (tagEl) tagEl.addEventListener('change', handler);
}

function updateFilterIndicator() {
    const searchEl = document.getElementById('searchItemsInput');
    const priEl = document.getElementById('filterPriority');
    const statusEl = document.getElementById('filterStatus');
    const tagEl = document.getElementById('filterTag');
    const active = (searchEl?.value || '').trim() || (priEl?.value || '') || (statusEl?.value || '') || (tagEl?.value || '');
    let clearBtn = document.getElementById('clearFiltersBtn');
    if (active && !clearBtn) {
        clearBtn = document.createElement('button');
        clearBtn.id = 'clearFiltersBtn';
        clearBtn.className = 'btn btn-xs btn-ghost';
        clearBtn.textContent = 'Clear filters';
        clearBtn.style.marginLeft = '0.5rem';
        clearBtn.addEventListener('click', () => {
            if (searchEl) searchEl.value = '';
            if (priEl) priEl.value = '';
            if (statusEl) statusEl.value = '';
            if (tagEl) tagEl.value = '';
            renderItems();
            updateFilterIndicator();
        });
        const filterBar = tagEl?.parentElement;
        if (filterBar) filterBar.appendChild(clearBtn);
    } else if (!active && clearBtn) {
        clearBtn.remove();
    }
}

// ── Items ──────────────────────────────────────────────────────────────
function renderItems() {
    const list = document.getElementById('itemsList');
    const empty = document.getElementById('itemsEmpty');
    if (!list || !empty) return;
    list.innerHTML = '';
    const filtered = getFilteredItems();
    if (!filtered.length) {
        empty.classList.remove('hidden');
        const p = empty.querySelector('p');
        if (p) {
            if (currentItems.length) p.textContent = 'No items match your filters.';
            else p.textContent = 'No items yet. Add items above to get started.';
        }
        return;
    }
    empty.classList.add('hidden');
    const ba = document.getElementById('bulkActions');
    if (ba) ba.classList.toggle('hidden', currentItems.length === 0);

    filtered.forEach((item, i) => {
        const isCompleted = item.completed;
        const today = new Date().toISOString().split('T')[0];
        const isOverdue = item.due_date && item.due_date < today && !isCompleted;
        const priClass = (item.priority || 'medium');

        const row = document.createElement('div');
        row.className = 'item-row' + (isCompleted ? ' completed-item' : '');
        row.dataset.itemId = item.id;
        row.draggable = true;

        let tagsHtml = '';
        if (item.tags && item.tags.length) {
            tagsHtml = '<div class="item-tags-row">' + item.tags.map(t =>
                `<span class="item-tag-badge" style="background:${t.color}">${esc(t.name)}</span>`
            ).join('') + '</div>';
        }

        let dueHtml = '';
        if (item.due_date) {
            dueHtml = `<span class="item-due${isOverdue ? ' overdue' : ''}">${isOverdue ? '&#x26A0; ' : ''}${item.due_date}</span>`;
        }

        row.innerHTML = `
            <input type="checkbox" class="item-bulk-check" data-id="${item.id}" ${selectedItemIds.has(item.id) ? 'checked' : ''} aria-label="Select item" />
            <div class="item-drag-handle" aria-label="Drag to reorder">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
            </div>
            <input type="checkbox" class="item-checkbox" ${isCompleted ? 'checked' : ''} data-id="${item.id}" aria-label="Mark complete" />
            <div class="priority-dot ${priClass}" title="${priClass} priority"></div>
            <div class="item-content">
                <div class="item-title">${esc(item.title)}</div>
                ${item.description ? `<div class="item-desc">${esc(item.description)}</div>` : ''}
                ${tagsHtml}
                ${dueHtml}
            </div>
            <div class="item-actions">
                <button class="btn btn-xs btn-ghost" onclick="openEditItem(${item.id})" title="Edit" aria-label="Edit item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                </button>
                <button class="btn btn-xs btn-danger-outline" onclick="deleteItem(${item.id})" title="Delete" aria-label="Delete item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        `;

        // Completion toggle
        row.querySelector('.item-checkbox').addEventListener('change', async function () {
            try {
                await api(`/api/lists/${currentListId}/items/${item.id}/toggle`, { method: 'PUT' });
                const items = await api(`/api/lists/${currentListId}/items`);
                currentItems = items;
                renderItems();
                if (activeFrameworkTab) renderFrameworkView(activeFrameworkTab);
            } catch (e) { toast(e.message, 'error'); }
        });

        // Bulk selection
        row.querySelector('.item-bulk-check').addEventListener('change', function () {
            if (this.checked) selectedItemIds.add(item.id);
            else selectedItemIds.delete(item.id);
            updateBulkUI();
        });

        // Drag to reorder
        row.addEventListener('dragstart', (e) => {
            draggedItemId = item.id;
            row.classList.add('dragging-row');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(item.id));
        });
        row.addEventListener('dragend', () => {
            row.classList.remove('dragging-row');
        });
        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            const draggingRow = list.querySelector('.dragging-row');
            if (draggingRow && draggingRow !== row) {
                const rect = row.getBoundingClientRect();
                const after = e.clientY > rect.top + rect.height / 2;
                if (after) row.after(draggingRow);
                else row.before(draggingRow);
            }
        });
        row.addEventListener('drop', async (e) => {
            e.preventDefault();
            // Save new order
            const rows = list.querySelectorAll('.item-row');
            const order = Array.from(rows).map(r => parseInt(r.dataset.itemId));
            try {
                await api(`/api/lists/${currentListId}/items/reorder`, { method: 'PUT', body: { order } });
                const items = await api(`/api/lists/${currentListId}/items`);
                currentItems = items;
                renderItems();
            } catch (err) { toast(err.message, 'error'); }
        });

        // Touch drag support for item reorder
        let touchStartY = 0;
        const handle = row.querySelector('.item-drag-handle');
        handle.addEventListener('touchstart', (e) => {
            touchStartY = e.touches[0].clientY;
            row.classList.add('dragging-row');
            draggedItemId = item.id;
        }, { passive: true });
        handle.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            if (target) {
                const targetRow = target.closest('.item-row');
                if (targetRow && targetRow !== row) {
                    const rect = targetRow.getBoundingClientRect();
                    const after = touch.clientY > rect.top + rect.height / 2;
                    if (after) targetRow.after(row);
                    else targetRow.before(row);
                }
            }
        }, { passive: false });
        handle.addEventListener('touchend', async () => {
            row.classList.remove('dragging-row');
            const rows = list.querySelectorAll('.item-row');
            const order = Array.from(rows).map(r => parseInt(r.dataset.itemId));
            try {
                await api(`/api/lists/${currentListId}/items/reorder`, { method: 'PUT', body: { order } });
                const items = await api(`/api/lists/${currentListId}/items`);
                currentItems = items;
            } catch (err) { toast(err.message, 'error'); }
        });

        list.appendChild(row);
    });
}

// ── Bulk Actions UI ────────────────────────────────────────────────────
function updateBulkUI() {
    const cnt = document.getElementById('bulkCount');
    if (cnt) cnt.textContent = selectedItemIds.size + ' selected';
    const ba = document.getElementById('bulkActions');
    if (ba) ba.classList.toggle('hidden', currentItems.length === 0);
    const sa = document.getElementById('selectAllItems');
    if (sa) sa.checked = selectedItemIds.size === currentItems.length && currentItems.length > 0;
}

function bindBulkActions() {
    const sa = document.getElementById('selectAllItems');
    if (sa) sa.addEventListener('change', function () {
        if (this.checked) currentItems.forEach(i => selectedItemIds.add(i.id));
        else selectedItemIds.clear();
        renderItems();
        updateBulkUI();
    });

    const bd = document.getElementById('bulkDeleteBtn');
    if (bd) bd.addEventListener('click', async () => {
        if (!selectedItemIds.size) return;
        const ok = await customConfirm('Delete Items', `Delete ${selectedItemIds.size} selected item(s)?`);
        if (!ok) return;
        try {
            await api(`/api/lists/${currentListId}/items/bulk-delete`, {
                method: 'POST', body: { ids: Array.from(selectedItemIds) }
            });
            toast(`${selectedItemIds.size} items deleted`, 'success');
            selectedItemIds.clear();
            const items = await api(`/api/lists/${currentListId}/items`);
            currentItems = items;
            renderItems();
            updateBadges();
            updateBulkUI();
        } catch (e) { toast(e.message, 'error'); }
    });

    const bm = document.getElementById('bulkMoveBtn');
    if (bm) bm.addEventListener('click', async () => {
        if (!selectedItemIds.size) return;
        // Populate target list dropdown
        const sel = document.getElementById('bulkMoveTarget');
        sel.innerHTML = '';
        allLists.filter(l => l.id !== currentListId).forEach(l => {
            sel.innerHTML += `<option value="${l.id}">${esc(l.name)}</option>`;
        });
        if (!sel.options.length) { toast('No other lists available', 'warning'); return; }
        openModal('bulkMoveModal');
    });

    const bmc = document.getElementById('bulkMoveConfirm');
    if (bmc) bmc.addEventListener('click', async () => {
        const targetId = parseInt(document.getElementById('bulkMoveTarget').value);
        if (!targetId) return;
        try {
            await api(`/api/lists/${currentListId}/items/bulk-move`, {
                method: 'POST', body: { ids: Array.from(selectedItemIds), target_list_id: targetId }
            });
            toast('Items moved', 'success');
            closeModal('bulkMoveModal');
            selectedItemIds.clear();
            const items = await api(`/api/lists/${currentListId}/items`);
            currentItems = items;
            renderItems();
            updateBadges();
            updateBulkUI();
        } catch (e) { toast(e.message, 'error'); }
    });
}

// ── Add Item ───────────────────────────────────────────────────────────
async function addItem() {
    const input = document.getElementById('newItemInput');
    const title = input.value.trim();
    if (!title) return;
    const priSel = document.getElementById('newItemPriority');
    const priority = priSel ? priSel.value : 'medium';
    try {
        await api(`/api/lists/${currentListId}/items`, { method: 'POST', body: { title, priority } });
        input.value = '';
        const items = await api(`/api/lists/${currentListId}/items`);
        currentItems = items;
        renderItems();
        updateBadges();
        if (activeFrameworkTab) renderFrameworkView(activeFrameworkTab);
        toast('Item added', 'success');
    } catch (e) { toast(e.message, 'error'); }
}

// ── Edit Item ──────────────────────────────────────────────────────────
async function openEditItem(itemId) {
    editingItemId = itemId;
    const item = currentItems.find(i => i.id === itemId);
    if (!item) return;
    document.getElementById('editItemTitle').value = item.title;
    document.getElementById('editItemDesc').value = item.description || '';
    const priEl = document.getElementById('editItemPriority');
    if (priEl) priEl.value = item.priority || 'medium';
    const dueEl = document.getElementById('editItemDue');
    if (dueEl) dueEl.value = item.due_date || '';
    // Load tags
    renderEditTags(item);
    // Load comments
    await loadItemComments(itemId);
    document.getElementById('itemModal').classList.remove('hidden');
    document.getElementById('editItemTitle').focus();
}

function renderEditTags(item) {
    const container = document.getElementById('editItemTags');
    if (!container) return;
    container.innerHTML = '';
    (item.tags || []).forEach(t => {
        const chip = document.createElement('span');
        chip.className = 'edit-tag-chip';
        chip.style.background = t.color;
        chip.innerHTML = `${esc(t.name)} <span class="tag-remove" data-tag-id="${t.id}">&times;</span>`;
        chip.querySelector('.tag-remove').addEventListener('click', async () => {
            try {
                await api(`/api/items/${item.id}/tags/${t.id}`, { method: 'DELETE' });
                const items = await api(`/api/lists/${currentListId}/items`);
                currentItems = items;
                const updated = currentItems.find(i => i.id === item.id);
                renderEditTags(updated);
                renderItems();
            } catch (e) { toast(e.message, 'error'); }
        });
        container.appendChild(chip);
    });
}

// ── Comments ───────────────────────────────────────────────────────────
async function loadItemComments(itemId) {
    const container = document.getElementById('itemComments');
    if (!container) return;
    try {
        const comments = await api(`/api/items/${itemId}/comments`);
        container.innerHTML = '';
        if (!comments.length) {
            container.innerHTML = '<div style="font-size:0.78rem;color:var(--text-tertiary);padding:0.3rem">No comments yet</div>';
            return;
        }
        comments.forEach(c => {
            const div = document.createElement('div');
            div.className = 'comment-item';
            div.innerHTML = `
                <div class="comment-meta">
                    <span>${esc(c.username)} &middot; ${c.created_at}</span>
                    <button class="comment-delete" data-id="${c.id}" aria-label="Delete comment">&times;</button>
                </div>
                <div class="comment-content">${esc(c.content)}</div>
            `;
            div.querySelector('.comment-delete').addEventListener('click', async () => {
                try {
                    await api(`/api/comments/${c.id}`, { method: 'DELETE' });
                    await loadItemComments(itemId);
                } catch (e) { toast(e.message, 'error'); }
            });
            container.appendChild(div);
        });
    } catch (e) { container.innerHTML = ''; }
}

function bindCommentEvents() {
    const btn = document.getElementById('addCommentBtn');
    if (btn) btn.addEventListener('click', async () => {
        const input = document.getElementById('newCommentInput');
        const content = input.value.trim();
        if (!content || !editingItemId) return;
        try {
            await api(`/api/items/${editingItemId}/comments`, { method: 'POST', body: { content } });
            input.value = '';
            await loadItemComments(editingItemId);
        } catch (e) { toast(e.message, 'error'); }
    });
    const input = document.getElementById('newCommentInput');
    if (input) input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            const btn2 = document.getElementById('addCommentBtn');
            if (btn2) btn2.click();
        }
    });
}

// ── Tags Management ────────────────────────────────────────────────────
function bindTagsEvents() {
    const btn = document.getElementById('manageTagsBtn');
    if (btn) btn.addEventListener('click', () => {
        renderTagsManager();
        openModal('tagsModal');
    });

    const addBtn = document.getElementById('addTagBtn');
    if (addBtn) addBtn.addEventListener('click', async () => {
        const name = document.getElementById('newTagName').value.trim();
        const color = document.getElementById('newTagColor').value;
        if (!name) return;
        try {
            await api('/api/tags', { method: 'POST', body: { name, color } });
            document.getElementById('newTagName').value = '';
            await loadTags();
            renderTagsManager();
        } catch (e) { toast(e.message, 'error'); }
    });
}

function renderTagsManager() {
    const container = document.getElementById('tagsList');
    if (!container) return;
    container.innerHTML = '';
    const item = currentItems.find(i => i.id === editingItemId);
    const itemTagIds = new Set((item?.tags || []).map(t => t.id));

    allTags.forEach(t => {
        const isOn = itemTagIds.has(t.id);
        const row = document.createElement('div');
        row.className = 'tag-row';
        row.innerHTML = `
            <div class="tag-color-swatch" style="background:${t.color}"></div>
            <span class="tag-name">${esc(t.name)}</span>
            <button class="tag-toggle-btn ${isOn ? 'active' : ''}" data-id="${t.id}">${isOn ? '&#x2713;' : '+'}</button>
            <button class="tag-delete-btn" data-id="${t.id}" aria-label="Delete tag">&times;</button>
        `;
        row.querySelector('.tag-toggle-btn').addEventListener('click', async () => {
            try {
                if (isOn) {
                    await api(`/api/items/${editingItemId}/tags/${t.id}`, { method: 'DELETE' });
                } else {
                    await api(`/api/items/${editingItemId}/tags/${t.id}`, { method: 'POST' });
                }
                const items = await api(`/api/lists/${currentListId}/items`);
                currentItems = items;
                renderTagsManager();
                renderItems();
                const updated = currentItems.find(i => i.id === editingItemId);
                renderEditTags(updated);
            } catch (e) { toast(e.message, 'error'); }
        });
        row.querySelector('.tag-delete-btn').addEventListener('click', async () => {
            try {
                await api(`/api/tags/${t.id}`, { method: 'DELETE' });
                await loadTags();
                const items = await api(`/api/lists/${currentListId}/items`);
                currentItems = items;
                renderTagsManager();
                renderItems();
                const updated = currentItems.find(i => i.id === editingItemId);
                if (updated) renderEditTags(updated);
            } catch (e) { toast(e.message, 'error'); }
        });
        container.appendChild(row);
    });
}

// ── Save Item Edit ─────────────────────────────────────────────────────
async function saveEditItem() {
    const title = document.getElementById('editItemTitle').value.trim();
    const description = document.getElementById('editItemDesc').value.trim();
    const priEl = document.getElementById('editItemPriority');
    const dueEl = document.getElementById('editItemDue');
    const priority = priEl ? priEl.value : 'medium';
    const due_date = dueEl ? (dueEl.value || null) : null;
    if (!title) { toast('Title is required', 'warning'); return; }
    try {
        await api(`/api/lists/${currentListId}/items/${editingItemId}`, {
            method: 'PUT', body: { title, description, priority, due_date }
        });
        document.getElementById('itemModal').classList.add('hidden');
        const items = await api(`/api/lists/${currentListId}/items`);
        currentItems = items;
        renderItems();
        if (activeFrameworkTab) renderFrameworkView(activeFrameworkTab);
        toast('Item updated', 'success');
    } catch (e) { toast(e.message, 'error'); }
}

async function deleteItem(itemId) {
    const ok = await customConfirm('Delete Item', 'Delete this item?');
    if (!ok) return;
    const deletedItem = currentItems.find(i => i.id === itemId);
    try {
        await api(`/api/lists/${currentListId}/items/${itemId}`, { method: 'DELETE' });
        const items = await api(`/api/lists/${currentListId}/items`);
        currentItems = items;
        renderItems();
        updateBadges();
        if (activeFrameworkTab) renderFrameworkView(activeFrameworkTab);
        toast('Item deleted', 'success');
        // Undo
        if (deletedItem) {
            showUndo(`Deleted "${deletedItem.title}"`, async () => {
                await api(`/api/lists/${currentListId}/items`, {
                    method: 'POST',
                    body: { title: deletedItem.title, description: deletedItem.description, priority: deletedItem.priority, due_date: deletedItem.due_date }
                });
                const items2 = await api(`/api/lists/${currentListId}/items`);
                currentItems = items2;
                renderItems();
                updateBadges();
            });
        }
    } catch (e) { toast(e.message, 'error'); }
}

// ── Export / Import ────────────────────────────────────────────────────
function bindExportImport() {
    const expBtn = document.getElementById('exportListBtn');
    if (expBtn) expBtn.addEventListener('click', () => {
        if (!currentListId) return;
        window.open(`/api/lists/${currentListId}/export?format=json`, '_blank');
    });

    const impBtn = document.getElementById('importListBtn');
    if (impBtn) impBtn.addEventListener('click', () => {
        openModal('importModal');
    });

    const impSub = document.getElementById('importSubmit');
    if (impSub) impSub.addEventListener('click', async () => {
        const raw = document.getElementById('importData').value.trim();
        if (!raw) { toast('Enter data to import', 'warning'); return; }
        try {
            let data;
            try {
                data = JSON.parse(raw);
            } catch {
                // Treat as plain text list (one item per line)
                const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
                data = { name: 'Imported List', items: lines.map(l => ({ title: l })) };
            }
            await api('/api/lists/import', { method: 'POST', body: data });
            toast('List imported', 'success');
            closeModal('importModal');
            document.getElementById('importData').value = '';
            switchView('lists');
        } catch (e) { toast(e.message, 'error'); }
    });
}

// ── Share ──────────────────────────────────────────────────────────────
function bindShareEvents() {
    const shareBtn = document.getElementById('shareListBtn');
    if (shareBtn) shareBtn.addEventListener('click', async () => {
        await loadShares();
        openModal('shareModal');
    });

    const shareSub = document.getElementById('shareSubmit');
    if (shareSub) shareSub.addEventListener('click', async () => {
        const username = document.getElementById('shareUsername').value.trim();
        const permission = document.getElementById('sharePermission').value;
        if (!username) { toast('Enter a username', 'warning'); return; }
        try {
            await api(`/api/lists/${currentListId}/share`, { method: 'POST', body: { username, permission } });
            toast('List shared', 'success');
            document.getElementById('shareUsername').value = '';
            await loadShares();
        } catch (e) { toast(e.message, 'error'); }
    });
}

async function loadShares() {
    if (!currentListId) return;
    try {
        const shares = await api(`/api/lists/${currentListId}/share`);
        const container = document.getElementById('currentShares');
        if (!container) return;
        if (!shares.length) {
            container.innerHTML = '<div style="font-size:0.82rem;color:var(--text-tertiary)">Not shared with anyone</div>';
            return;
        }
        container.innerHTML = '<h4>Currently shared with</h4>';
        shares.forEach(s => {
            container.innerHTML += `
                <div class="share-entry">
                    <div class="share-info"><span>${esc(s.username)}</span><span class="share-perm">${s.permission}</span></div>
                    <button class="btn btn-xs btn-danger-outline" onclick="removeShare(${s.id})" aria-label="Remove share">&times;</button>
                </div>
            `;
        });
    } catch (e) { console.error(e); }
}

async function removeShare(shareId) {
    try {
        await api(`/api/lists/${currentListId}/share/${shareId}`, { method: 'DELETE' });
        toast('Share removed', 'success');
        await loadShares();
    } catch (e) { toast(e.message, 'error'); }
}

// ── Save as Template ───────────────────────────────────────────────────
function bindTemplateEvents() {
    const saveBtn = document.getElementById('saveTemplateBtn');
    if (saveBtn) saveBtn.addEventListener('click', () => {
        const el = document.getElementById('templateName');
        if (el) el.value = document.getElementById('detailTitle').textContent || '';
        openModal('templateModal');
    });

    const tmplSave = document.getElementById('templateSave');
    if (tmplSave) tmplSave.addEventListener('click', async () => {
        const name = document.getElementById('templateName').value.trim();
        if (!name) { toast('Template name required', 'warning'); return; }
        try {
            await api(`/api/lists/${currentListId}/save-template`, { method: 'POST', body: { name } });
            toast('Template saved', 'success');
            closeModal('templateModal');
        } catch (e) { toast(e.message, 'error'); }
    });
}

// ── Frameworks Catalog ─────────────────────────────────────────────────
function renderFrameworksCatalog() {
    const container = document.getElementById('frameworksCatalog');
    if (!container) return;
    container.innerHTML = '';
    for (const [key, fw] of Object.entries(frameworksCatalog)) {
        const isSelected = currentFrameworks.includes(key);
        const card = document.createElement('div');
        card.className = `fw-catalog-card${isSelected ? ' selected' : ''}`;
        card.innerHTML = `
            <div class="fw-catalog-header">
                <div>
                    <div class="fw-catalog-name">${esc(fw.name)}</div>
                    <div class="fw-catalog-author">by ${esc(fw.author)}</div>
                </div>
                <div class="fw-catalog-icon" style="background:${fw.color}15;color:${fw.color}">${fw.icon}</div>
            </div>
            <div class="fw-catalog-desc">${esc(fw.description)}</div>
            <button class="fw-toggle-btn${isSelected ? ' active' : ''}" data-key="${key}">
                ${isSelected ? '&#x2713; Active' : 'Activate'}
            </button>
        `;
        card.querySelector('.fw-toggle-btn').addEventListener('click', () => toggleFramework(key));
        container.appendChild(card);
    }
}

async function toggleFramework(key) {
    const wasActive = currentFrameworks.includes(key);
    try {
        if (wasActive) {
            await api(`/api/lists/${currentListId}/frameworks/${key}`, { method: 'DELETE' });
            currentFrameworks = currentFrameworks.filter(k => k !== key);
            if (activeFrameworkTab === key) activeFrameworkTab = null;
            toast('Framework removed', 'success');
            showUndo(`Removed ${frameworksCatalog[key]?.name}`, async () => {
                await api(`/api/lists/${currentListId}/frameworks`, { method: 'POST', body: { framework_key: key } });
                currentFrameworks.push(key);
                renderFrameworksCatalog();
                renderFrameworkTabs();
                updateBadges();
            });
        } else {
            await api(`/api/lists/${currentListId}/frameworks`, { method: 'POST', body: { framework_key: key } });
            currentFrameworks.push(key);
            toast('Framework activated', 'success');
        }
        renderFrameworksCatalog();
        renderFrameworkTabs();
        updateBadges();
    } catch (e) { toast(e.message, 'error'); }
}

// ── Framework Tabs & Views ─────────────────────────────────────────────
function renderFrameworkTabs() {
    const tabsEl = document.getElementById('frameworkTabs');
    const viewport = document.getElementById('frameworkViewport');
    const titleEl = document.getElementById('activeFrameworksTitle');
    if (!tabsEl || !viewport) return;

    if (!currentFrameworks.length) {
        if (titleEl) titleEl.style.display = 'none';
        tabsEl.innerHTML = '';
        viewport.innerHTML = '';
        return;
    }

    if (titleEl) titleEl.style.display = '';
    tabsEl.innerHTML = '';

    currentFrameworks.forEach(key => {
        const fw = frameworksCatalog[key];
        if (!fw) return;
        const tab = document.createElement('button');
        tab.className = `fw-tab${activeFrameworkTab === key ? ' active' : ''}`;
        tab.setAttribute('aria-label', fw.name + ' framework view');
        tab.innerHTML = `${fw.icon} ${fw.name}`;
        tab.addEventListener('click', () => {
            activeFrameworkTab = key;
            renderFrameworkTabs();
            renderFrameworkView(key);
        });
        tabsEl.appendChild(tab);
    });

    if (!activeFrameworkTab && currentFrameworks.length) {
        activeFrameworkTab = currentFrameworks[0];
        renderFrameworkTabs();
        renderFrameworkView(activeFrameworkTab);
        return;
    }
    if (activeFrameworkTab) renderFrameworkView(activeFrameworkTab);
}

async function renderFrameworkView(key) {
    const viewport = document.getElementById('frameworkViewport');
    if (!viewport) return;
    if (!currentItems.length) {
        const fw = frameworksCatalog[key];
        viewport.innerHTML = `<div class="empty-state-sm"><p>${fw ? fw.icon + ' ' : ''}Add items to your list first, then organize them with ${fw ? fw.name : 'this framework'}.</p></div>`;
        return;
    }

    let savedData = {};
    try { savedData = await api(`/api/lists/${currentListId}/framework-data/${key}`); }
    catch { }

    switch (key) {
        case 'eisenhower': renderEisenhower(viewport, savedData); break;
        case 'timeboxing': renderTimeboxing(viewport, savedData); break;
        case 'impact_effort': renderImpactEffort(viewport, savedData); break;
        case 'kanban': renderKanban(viewport, savedData); break;
        case 'stop_doing': renderStopDoing(viewport, savedData); break;
        case 'pareto': renderPareto(viewport, savedData); break;
        default: viewport.innerHTML = '<div class="empty-state-sm"><p>Framework view not available.</p></div>';
    }
}

// ── Drag & Drop helpers ────────────────────────────────────────────────
function makeDropZone(zone, onDrop) {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        if (draggedItemId) { onDrop(draggedItemId); draggedItemId = null; }
    });
}

function setupTouchDragForChips(vp, frameworkKey) {
    const chips = vp.querySelectorAll('.fw-item-chip');
    chips.forEach(chip => {
        let clone = null;
        chip.addEventListener('touchstart', (e) => {
            draggedItemId = parseInt(chip.dataset.itemId);
            clone = chip.cloneNode(true);
            clone.style.position = 'fixed';
            clone.style.pointerEvents = 'none';
            clone.style.opacity = '0.7';
            clone.style.zIndex = '999';
            clone.style.width = chip.offsetWidth + 'px';
            document.body.appendChild(clone);
        }, { passive: true });
        chip.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (clone) {
                const t = e.touches[0];
                clone.style.left = (t.clientX - 30) + 'px';
                clone.style.top = (t.clientY - 15) + 'px';
            }
        }, { passive: false });
        chip.addEventListener('touchend', (e) => {
            if (clone) { clone.remove(); clone = null; }
            const t = e.changedTouches[0];
            const target = document.elementFromPoint(t.clientX, t.clientY);
            if (target) {
                const zone = target.closest('.drop-zone');
                if (zone && draggedItemId) {
                    const val = zone.dataset.quadrant || zone.dataset.column || zone.dataset.category;
                    if (val) {
                        const field = zone.dataset.quadrant ? 'quadrant' : zone.dataset.column ? 'column' : 'category';
                        api(`/api/items/${draggedItemId}/framework-data/${frameworkKey}`, {
                            method: 'PUT',
                            body: { data: { [field]: val } }
                        }).then(() => renderFrameworkView(frameworkKey)).catch(err => toast(err.message, 'error'));
                    }
                }
            }
            draggedItemId = null;
        });
    });
}

function setupMatrixDragDrop(vp, frameworkKey, dataField) {
    const chips = vp.querySelectorAll('.fw-item-chip');
    const zones = vp.querySelectorAll('.drop-zone');
    chips.forEach(chip => {
        chip.addEventListener('dragstart', e => {
            draggedItemId = parseInt(chip.dataset.itemId);
            chip.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    });
    zones.forEach(zone => {
        makeDropZone(zone, async (itemId) => {
            const val = zone.dataset[dataField];
            try {
                await api(`/api/items/${itemId}/framework-data/${frameworkKey}`, {
                    method: 'PUT', body: { data: { [dataField]: val } }
                });
                renderFrameworkView(frameworkKey);
            } catch (e) { toast(e.message, 'error'); }
        });
    });
}

// ── EISENHOWER MATRIX ──────────────────────────────────────────────────
function renderEisenhower(vp, savedData) {
    const quadrants = [
        { key: 'do', label: 'Do It Now', sublabel: 'Urgent & Important', cls: 'eq-do' },
        { key: 'schedule', label: 'Schedule It', sublabel: 'Not Urgent & Important', cls: 'eq-schedule' },
        { key: 'delegate', label: 'Delegate It', sublabel: 'Urgent & Not Important', cls: 'eq-delegate' },
        { key: 'eliminate', label: 'Eliminate It', sublabel: 'Not Urgent & Not Important', cls: 'eq-eliminate' }
    ];
    const placements = {};
    for (const item of currentItems) {
        const d = savedData[item.id]?.data;
        placements[item.id] = d?.quadrant || 'unassigned';
    }
    let html = '<div class="matrix-wrapper">';
    html += '<div class="matrix-axis-y">Important &rarr;</div>';
    html += '<div class="matrix-corner-labels"><span>Urgent</span><span>Not Urgent</span></div>';
    html += '<div class="eisenhower-grid">';
    quadrants.forEach(q => {
        const items = currentItems.filter(i => placements[i.id] === q.key);
        html += `<div class="eisenhower-cell ${q.cls}">
            <div class="eisenhower-label"><span class="eisenhower-label-dot"></span>${q.label}</div>
            <div class="drop-zone" data-quadrant="${q.key}">
                ${items.map(i => `<div class="fw-item-chip" draggable="true" data-item-id="${i.id}"><span class="chip-title">${esc(i.title)}</span></div>`).join('')}
            </div>
        </div>`;
    });
    html += '</div></div>';
    const unassigned = currentItems.filter(i => placements[i.id] === 'unassigned');
    html += `<div class="unassigned-area">
        <div class="unassigned-label">Unassigned Items (drag to a quadrant)</div>
        <div class="drop-zone unassigned-items" data-quadrant="unassigned">
            ${unassigned.map(i => `<div class="fw-item-chip" draggable="true" data-item-id="${i.id}"><span class="chip-title">${esc(i.title)}</span></div>`).join('')}
        </div>
    </div>`;
    vp.innerHTML = html;
    setupMatrixDragDrop(vp, 'eisenhower', 'quadrant');
    setupTouchDragForChips(vp, 'eisenhower');
}

// ── IMPACT / EFFORT MATRIX ─────────────────────────────────────────────
function renderImpactEffort(vp, savedData) {
    const quadrants = [
        { key: 'quickwin', label: 'Quick / Easy Wins', cls: 'ie-quickwin' },
        { key: 'major', label: 'Major Projects', cls: 'ie-major' },
        { key: 'fillin', label: 'Fill-in Tasks', cls: 'ie-fillin' },
        { key: 'thankless', label: 'Thankless Tasks', cls: 'ie-thankless' }
    ];
    const placements = {};
    for (const item of currentItems) {
        const d = savedData[item.id]?.data;
        placements[item.id] = d?.quadrant || 'unassigned';
    }
    let html = '<div class="matrix-wrapper">';
    html += '<div class="matrix-axis-y">Impact &rarr;</div>';
    html += '<div class="matrix-corner-labels"><span>Low Effort</span><span>High Effort</span></div>';
    html += '<div class="ie-matrix">';
    quadrants.forEach(q => {
        const items = currentItems.filter(i => placements[i.id] === q.key);
        html += `<div class="ie-cell ${q.cls}">
            <div class="ie-label"><span class="ie-label-dot"></span>${q.label}</div>
            <div class="drop-zone" data-quadrant="${q.key}">
                ${items.map(i => `<div class="fw-item-chip" draggable="true" data-item-id="${i.id}"><span class="chip-title">${esc(i.title)}</span></div>`).join('')}
            </div>
        </div>`;
    });
    html += '</div></div>';
    const unassigned = currentItems.filter(i => placements[i.id] === 'unassigned');
    html += `<div class="unassigned-area">
        <div class="unassigned-label">Unassigned Items (drag to a quadrant)</div>
        <div class="drop-zone unassigned-items" data-quadrant="unassigned">
            ${unassigned.map(i => `<div class="fw-item-chip" draggable="true" data-item-id="${i.id}"><span class="chip-title">${esc(i.title)}</span></div>`).join('')}
        </div>
    </div>`;
    vp.innerHTML = html;
    setupMatrixDragDrop(vp, 'impact_effort', 'quadrant');
    setupTouchDragForChips(vp, 'impact_effort');
}

// ── KANBAN BOARD ───────────────────────────────────────────────────────
function renderKanban(vp, savedData) {
    const columns = [
        { key: 'backlog', label: 'Backlog', cls: 'kanban-backlog' },
        { key: 'doing', label: 'Doing', cls: 'kanban-doing' },
        { key: 'review', label: 'Review', cls: 'kanban-review' },
        { key: 'done', label: 'Done', cls: 'kanban-done' }
    ];
    const placements = {};
    for (const item of currentItems) {
        const d = savedData[item.id]?.data;
        placements[item.id] = d?.column || 'backlog';
    }
    let html = '<div class="kanban-board">';
    columns.forEach(col => {
        const items = currentItems.filter(i => placements[i.id] === col.key);
        html += `<div class="kanban-column ${col.cls}">
            <div class="kanban-col-header"><span>${col.label}</span><span class="kanban-col-count">${items.length}</span></div>
            <div class="drop-zone" data-column="${col.key}" style="min-height:200px">
                ${items.map(i => `<div class="fw-item-chip" draggable="true" data-item-id="${i.id}"><span class="chip-title">${esc(i.title)}</span></div>`).join('')}
            </div>
        </div>`;
    });
    html += '</div>';
    vp.innerHTML = html;
    const chips = vp.querySelectorAll('.fw-item-chip');
    const zones = vp.querySelectorAll('.drop-zone');
    chips.forEach(chip => {
        chip.addEventListener('dragstart', e => {
            draggedItemId = parseInt(chip.dataset.itemId);
            chip.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    });
    zones.forEach(zone => {
        makeDropZone(zone, async (itemId) => {
            const column = zone.dataset.column;
            try {
                await api(`/api/items/${itemId}/framework-data/kanban`, {
                    method: 'PUT', body: { data: { column } }
                });
                renderFrameworkView('kanban');
            } catch (e) { toast(e.message, 'error'); }
        });
    });
    setupTouchDragForChips(vp, 'kanban');
}

// ── TIMEBOXING ─────────────────────────────────────────────────────────
function renderTimeboxing(vp, savedData) {
    let html = '<div class="timeboxing-container">';
    html += '<div class="timebox-items">';
    currentItems.forEach(item => {
        const d = savedData[item.id]?.data || {};
        const minutes = d.minutes || 30;
        const status = d.status || 'idle';
        html += `<div class="timebox-item" data-item-id="${item.id}">
            <span class="timebox-title">${esc(item.title)}</span>
            <div class="timebox-time-wrap">
                <input type="number" class="timebox-time-input" value="${minutes}" min="5" max="480" step="5" data-item-id="${item.id}" aria-label="Time in minutes" />
                <span class="timebox-unit">min</span>
            </div>
            <button class="timebox-status ${status}" data-item-id="${item.id}" data-status="${status}">
                ${status === 'idle' ? 'Start' : status === 'running' ? 'Running' : 'Done'}
            </button>
        </div>`;
    });
    let totalMin = 0;
    currentItems.forEach(item => { totalMin += (savedData[item.id]?.data?.minutes) || 30; });
    const hrs = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    html += '</div>';
    html += `<div class="timebox-total"><span>Total: <strong>${hrs}h ${mins}m</strong></span></div>`;
    html += '</div>';
    vp.innerHTML = html;

    vp.querySelectorAll('.timebox-time-input').forEach(input => {
        input.addEventListener('change', async function () {
            const itemId = parseInt(this.dataset.itemId);
            const minutes = parseInt(this.value) || 30;
            const d = savedData[itemId]?.data || {};
            try {
                await api(`/api/items/${itemId}/framework-data/timeboxing`, {
                    method: 'PUT', body: { data: { ...d, minutes } }
                });
                renderFrameworkView('timeboxing');
            } catch (e) { toast(e.message, 'error'); }
        });
    });

    vp.querySelectorAll('.timebox-status').forEach(btn => {
        btn.addEventListener('click', async function () {
            const itemId = parseInt(this.dataset.itemId);
            const curr = this.dataset.status;
            const next = curr === 'idle' ? 'running' : curr === 'running' ? 'done' : 'idle';
            const d = savedData[itemId]?.data || {};
            try {
                await api(`/api/items/${itemId}/framework-data/timeboxing`, {
                    method: 'PUT', body: { data: { ...d, status: next } }
                });
                renderFrameworkView('timeboxing');
            } catch (e) { toast(e.message, 'error'); }
        });
    });
}

// ── STOP DOING LIST ────────────────────────────────────────────────────
function renderStopDoing(vp, savedData) {
    const placements = {};
    for (const item of currentItems) {
        const d = savedData[item.id]?.data;
        placements[item.id] = d?.category || 'unassigned';
    }
    const keepItems = currentItems.filter(i => placements[i.id] === 'keep');
    const stopItems = currentItems.filter(i => placements[i.id] === 'stop');
    const unassigned = currentItems.filter(i => placements[i.id] === 'unassigned');

    let html = '<div class="stopdoing-container"><div class="stopdoing-sections">';
    html += `<div class="stopdoing-section keep-section">
        <div class="stopdoing-header">&#x2705; Keep Doing</div>
        <div class="drop-zone" data-category="keep" style="min-height:150px">
            ${keepItems.map(i => `<div class="fw-item-chip" draggable="true" data-item-id="${i.id}"><span class="chip-title">${esc(i.title)}</span></div>`).join('')}
        </div>
    </div>`;
    html += `<div class="stopdoing-section stop-section">
        <div class="stopdoing-header">&#x1f6d1; Stop Doing</div>
        <div class="drop-zone" data-category="stop" style="min-height:150px">
            ${stopItems.map(i => `<div class="fw-item-chip" draggable="true" data-item-id="${i.id}"><span class="chip-title">${esc(i.title)}</span></div>`).join('')}
        </div>
    </div>`;
    html += '</div>';
    html += `<div style="margin-top:1rem">
        <div class="unassigned-label">Unassigned (drag to a section)</div>
        <div class="drop-zone unassigned-items" data-category="unassigned" style="min-height:40px;padding:0.5rem;background:var(--surface2);border-radius:var(--radius-sm)">
            ${unassigned.map(i => `<div class="fw-item-chip" draggable="true" data-item-id="${i.id}"><span class="chip-title">${esc(i.title)}</span></div>`).join('')}
        </div>
    </div></div>`;
    vp.innerHTML = html;

    const chips = vp.querySelectorAll('.fw-item-chip');
    const zones = vp.querySelectorAll('.drop-zone');
    chips.forEach(chip => {
        chip.addEventListener('dragstart', e => {
            draggedItemId = parseInt(chip.dataset.itemId);
            chip.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    });
    zones.forEach(zone => {
        makeDropZone(zone, async (itemId) => {
            const category = zone.dataset.category;
            try {
                await api(`/api/items/${itemId}/framework-data/stop_doing`, {
                    method: 'PUT', body: { data: { category } }
                });
                renderFrameworkView('stop_doing');
            } catch (e) { toast(e.message, 'error'); }
        });
    });
    setupTouchDragForChips(vp, 'stop_doing');
}

// ── PARETO PRINCIPLE ───────────────────────────────────────────────────
function renderPareto(vp, savedData) {
    const placements = {};
    for (const item of currentItems) {
        const d = savedData[item.id]?.data;
        placements[item.id] = d?.category || 'unassigned';
    }
    const vitalItems = currentItems.filter(i => placements[i.id] === 'vital');
    const trivialItems = currentItems.filter(i => placements[i.id] === 'trivial');
    const unassigned = currentItems.filter(i => placements[i.id] === 'unassigned');
    const total = currentItems.length;
    const vitalPct = total ? Math.round((vitalItems.length / total) * 100) : 0;
    const trivialPct = total ? Math.round((trivialItems.length / total) * 100) : 0;

    let html = '<div class="pareto-container">';
    html += `<div class="pareto-explanation"><span class="icon">&#x1f3af;</span>
        <div>Identify the <strong>vital 20%</strong> of items driving most results, and the <strong>trivial 80%</strong> that can be reduced, delegated, or eliminated.</div>
    </div>`;
    html += '<div class="pareto-sections">';
    html += `<div class="pareto-section vital-section">
        <div class="pareto-label">&#x1f31f; Vital Few (20%)</div>
        <div class="drop-zone" data-category="vital" style="min-height:150px">
            ${vitalItems.map(i => `<div class="fw-item-chip" draggable="true" data-item-id="${i.id}"><span class="chip-title">${esc(i.title)}</span></div>`).join('')}
        </div>
    </div>`;
    html += `<div class="pareto-section trivial-section">
        <div class="pareto-label">&#x1f4e6; Trivial Many (80%)</div>
        <div class="drop-zone" data-category="trivial" style="min-height:150px">
            ${trivialItems.map(i => `<div class="fw-item-chip" draggable="true" data-item-id="${i.id}"><span class="chip-title">${esc(i.title)}</span></div>`).join('')}
        </div>
    </div>`;
    html += '</div>';

    if (vitalItems.length || trivialItems.length) {
        html += `<div class="pareto-bar-container">
            <div class="pareto-bar">
                <div class="pareto-bar-vital" style="width:${vitalPct || 1}%">${vitalPct}%</div>
                <div class="pareto-bar-trivial" style="width:${trivialPct || 1}%">${trivialPct}%</div>
            </div>
            <div class="pareto-stats">
                <span>${vitalItems.length} vital item${vitalItems.length !== 1 ? 's' : ''}</span>
                <span>${trivialItems.length} trivial item${trivialItems.length !== 1 ? 's' : ''}</span>
            </div>
        </div>`;
    }

    html += `<div style="margin-top:1rem">
        <div class="unassigned-label">Unassigned (drag to a section)</div>
        <div class="drop-zone unassigned-items" data-category="unassigned" style="min-height:40px;padding:0.5rem;background:var(--surface2);border-radius:var(--radius-sm)">
            ${unassigned.map(i => `<div class="fw-item-chip" draggable="true" data-item-id="${i.id}"><span class="chip-title">${esc(i.title)}</span></div>`).join('')}
        </div>
    </div></div>`;
    vp.innerHTML = html;

    const chips = vp.querySelectorAll('.fw-item-chip');
    const zones = vp.querySelectorAll('.drop-zone');
    chips.forEach(chip => {
        chip.addEventListener('dragstart', e => {
            draggedItemId = parseInt(chip.dataset.itemId);
            chip.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    });
    zones.forEach(zone => {
        makeDropZone(zone, async (itemId) => {
            const category = zone.dataset.category;
            try {
                await api(`/api/items/${itemId}/framework-data/pareto`, {
                    method: 'PUT', body: { data: { category } }
                });
                renderFrameworkView('pareto');
            } catch (e) { toast(e.message, 'error'); }
        });
    });
    setupTouchDragForChips(vp, 'pareto');
}

// ── Modal helpers ──────────────────────────────────────────────────────
function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('hidden');
    setTimeout(() => {
        const firstInput = modal.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="color"]), textarea, select');
        if (firstInput) firstInput.focus();
    }, 50);
}
function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('hidden');
}

// Close modals on overlay click or close button
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });
});
document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal));
});

// ── List modal ─────────────────────────────────────────────────────────
function bindListModal() {
    const newBtn = document.getElementById('newListBtn');
    if (newBtn) newBtn.addEventListener('click', () => {
        editingListId = null;
        document.getElementById('listModalTitle').textContent = 'New List';
        document.getElementById('modalName').value = '';
        document.getElementById('modalDesc').value = '';
        openModal('listModal');
    });

    const editBtn = document.getElementById('editListBtn');
    if (editBtn) editBtn.addEventListener('click', () => {
        editingListId = currentListId;
        document.getElementById('listModalTitle').textContent = 'Edit List';
        document.getElementById('modalName').value = document.getElementById('detailTitle').textContent;
        document.getElementById('modalDesc').value = document.getElementById('detailDesc').textContent;
        openModal('listModal');
    });

    const saveBtn = document.getElementById('modalSave');
    if (saveBtn) saveBtn.addEventListener('click', async () => {
        const name = document.getElementById('modalName').value.trim();
        const description = document.getElementById('modalDesc').value.trim();
        if (!name) { toast('Name is required', 'warning'); return; }
        try {
            if (editingListId) {
                await api(`/api/lists/${editingListId}`, { method: 'PUT', body: { name, description } });
                document.getElementById('detailTitle').textContent = name;
                document.getElementById('detailDesc').textContent = description;
                const bcName = document.getElementById('bcListName');
                if (bcName) bcName.textContent = name;
                toast('List updated', 'success');
            } else {
                await api('/api/lists', { method: 'POST', body: { name, description } });
                toast('List created', 'success');
                loadLists();
                loadSidebarLists();
            }
            closeModal('listModal');
        } catch (e) { toast(e.message, 'error'); }
    });

    const delBtn = document.getElementById('deleteListBtn');
    if (delBtn) delBtn.addEventListener('click', async () => {
        const ok = await customConfirm('Delete List', 'Delete this list and all its data?');
        if (!ok) return;
        try {
            await api(`/api/lists/${currentListId}`, { method: 'DELETE' });
            toast('List deleted', 'success');
            goBack();
            loadSidebarLists();
        } catch (e) { toast(e.message, 'error'); }
    });
}

// ── Item events ────────────────────────────────────────────────────────
function bindItemEvents() {
    const addBtn = document.getElementById('addItemBtn');
    if (addBtn) addBtn.addEventListener('click', addItem);
    const addInput = document.getElementById('newItemInput');
    if (addInput) addInput.addEventListener('keydown', e => { if (e.key === 'Enter') addItem(); });
    const saveBtn = document.getElementById('editItemSave');
    if (saveBtn) saveBtn.addEventListener('click', saveEditItem);
}

// ── Tabs switching ─────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        const items = document.getElementById('itemsTabContent');
        const fw = document.getElementById('frameworksTabContent');
        if (items) items.classList.toggle('hidden', target !== 'items');
        if (fw) fw.classList.toggle('hidden', target !== 'frameworks');
    });
});

// ── Auth events ────────────────────────────────────────────────────────
document.getElementById('authSwitch').addEventListener('click', e => { e.preventDefault(); toggleAuthMode(); });
document.getElementById('authSubmit').addEventListener('click', handleAuth);
document.getElementById('authPass').addEventListener('keydown', e => { if (e.key === 'Enter') handleAuth(); });
document.getElementById('logoutBtn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    location.reload();
});

// ── Theme toggle ───────────────────────────────────────────────────────
document.getElementById('themeToggle').addEventListener('click', toggleTheme);

// ── Keyboard Shortcuts ─────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const isModal = document.querySelector('.modal-overlay:not(.hidden)');

    if (e.key === 'Escape') {
        if (isModal) {
            isModal.classList.add('hidden');
            if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
            return;
        }
        const shortcuts = document.getElementById('shortcutsHelp');
        if (shortcuts) shortcuts.classList.add('hidden');
        if (currentListId) { goBack(); return; }
    }

    if (isInput || isModal) return;

    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        const shortcuts = document.getElementById('shortcutsHelp');
        if (shortcuts) shortcuts.classList.toggle('hidden');
    }
    if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        const btn = document.getElementById('newListBtn');
        if (btn) btn.click();
    }
    if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        switchView('dashboard');
    }
    if (e.key === '/') {
        e.preventDefault();
        const searchInput = document.getElementById('searchItemsInput');
        const itemsTab = document.getElementById('itemsTabContent');
        if (searchInput && itemsTab && !itemsTab.classList.contains('hidden')) {
            searchInput.focus();
        }
    }
    if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        const btn = document.getElementById('undoBtn');
        if (btn) btn.click();
    }
});

// ── Bind all event listeners ───────────────────────────────────────────
function bindAllEvents() {
    bindFilterEvents();
    bindBulkActions();
    bindCommentEvents();
    bindTagsEvents();
    bindExportImport();
    bindShareEvents();
    bindTemplateEvents();
    bindListModal();
    bindItemEvents();
}
bindAllEvents();

// ── PWA Registration ───────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/sw.js').catch(() => { });
}

// ── Init ───────────────────────────────────────────────────────────────
initTheme();
checkAuth();
