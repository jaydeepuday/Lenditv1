// ─────────────────────────────────────────────────────────────
// main.js — LendIT Frontend Application
// SPA with hash-based routing. Each page has a render function
// and uses AbortController for cleanup.
// ─────────────────────────────────────────────────────────────

import { api, BACKEND_URL } from './api.js';

// ─── State ───────────────────────────────────────────────────
const isExamMode = true; // Added for Exam Mode
const ENABLE_EXAM_PASS = false; // 🚩 Feature flag — set true to show Exam Pass option in UI

const state = {
  user: null,         // Current user profile or null
  pageController: null, // AbortController for current page
  unreadChats: 0,     // Unread chat message count
};

// ─── Status → Action Maps ────────────────────────────────────
const RENTER_ACTIONS = {
  REQUESTED: [],
  ACCEPTED: ['Pay'],
  ACTIVE: ['Collect'],
  GRACE: [],
  RETURNED: [],
  REJECTED: [],
  LATE: [],
  CANCELLED: [],
};

const LENDER_ACTIONS = {
  REQUESTED: ['Accept', 'Reject'],
  ACCEPTED: [],
  ACTIVE: [],
  GRACE: [],
  RETURNED: [],
  REJECTED: [],
  LATE: [],
  CANCELLED: [],
};

const ACTION_HANDLERS = {
  Accept: (id) => api.respondBorrow(id, { action: 'ACCEPTED' }),
  Reject: (id) => api.respondBorrow(id, { action: 'REJECTED' }),
  Pay: (id) => api.payBorrow(id),
  Collect: (id) => api.collectBorrow(id),
  Return: (id) => api.returnBorrow(id),
  Cancel: (id) => api.cancelBorrow(id),
};

// Item categories
const CATEGORIES = [
  'ELECTRONICS', 'BOOKS', 'SPORTS', 'CLOTHING',
  'TOOLS', 'STATIONERY', 'KITCHEN', 'OTHER',
];

// Campus pickup/return locations
const CAMPUS_LOCATIONS = [
  { value: 'OVAL_TREE', label: 'Oval Tree' },
  { value: 'ICREATE', label: 'iCreate' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'SPORTX', label: 'SportX' },
  { value: 'FOUNTAIN', label: 'Fountain' },
  { value: 'BLU', label: 'Blu' },
  { value: 'RISE', label: 'Rise' },
  { value: 'RACE', label: 'Race' },
  { value: 'LIBRARY', label: 'Library' },
];

/** Human-readable label for a CampusLocation enum value */
function locationLabel(val) {
  if (!val) return '—';
  const found = CAMPUS_LOCATIONS.find(l => l.value === val);
  return found ? found.label : val;
}

// ─── DOM Refs ────────────────────────────────────────────────
const $app = document.getElementById('app');
const $navLinks = document.getElementById('navbar-links');
const $navToggle = document.getElementById('nav-toggle');
const $errorBanner = document.getElementById('error-banner');
const $spinner = document.getElementById('spinner');

// ─── Helpers ─────────────────────────────────────────────────

/** Show global loading spinner */
function showLoading() {
  $spinner.classList.add('visible');
  document.body.style.pointerEvents = 'none';
}

/** Hide global loading spinner */
function hideLoading() {
  $spinner.classList.remove('visible');
  document.body.style.pointerEvents = '';
}

/** Show error banner that auto-hides after 6 seconds. Replaces existing content if already visible. */
function showError(msg) {
  // Update content immediately
  $errorBanner.innerHTML = `<span style="flex:1">${msg}</span><button style="margin-left:12px;color:rgba(255,255,255,0.8);font-weight:bold;padding:4px 8px;border-radius:50%;" onclick="this.parentElement.classList.remove('visible')" onmouseover="this.style.color='white'" onmouseout="this.style.color='rgba(255,255,255,0.8)'">✕</button>`;
  
  if ($errorBanner.classList.contains('visible')) {
    // Subtle "pulse" animation if already visible to signal new error
    $errorBanner.animate([
      { transform: 'translateX(-50%) scale(1)' },
      { transform: 'translateX(-50%) scale(1.03)' },
      { transform: 'translateX(-50%) scale(1)' }
    ], { duration: 200 });
  }

  $errorBanner.classList.add('visible');
  
  // Clear any existing timeout to reset the countdown
  if ($errorBanner._timeout) clearTimeout($errorBanner._timeout);
  $errorBanner._timeout = setTimeout(() => {
    $errorBanner.classList.remove('visible');
    $errorBanner._timeout = null;
  }, 6000);
}

// ─── Auto-hide Navbar on Scroll ──────────────────────────────
let lastScrollY = window.scrollY;
const $navbar = document.querySelector('.navbar');

window.addEventListener('scroll', () => {
  if (document.body.classList.contains('nav-open')) return; // Don't hide if mobile menu is open
  
  const currentScrollY = window.scrollY;
  if (currentScrollY > lastScrollY && currentScrollY > 100) {
    $navbar.classList.add('navbar-hidden');
  } else {
    $navbar.classList.remove('navbar-hidden');
  }
  lastScrollY = currentScrollY;
}, { passive: true });

/** Navigate to a hash route */
function navigate(hash) {
  window.location.hash = hash;
}

/** Format currency in INR */
function formatPrice(amount) {
  if (amount == null) return '—';
  return '₹' + Number(amount).toLocaleString('en-IN');
}

/** Get status badge HTML */
function statusBadge(status) {
  const cls = (status || '').toLowerCase();
  return `<span class="badge badge-${cls}">${status}</span>`;
}

/** Placeholder image for items without photos */
function itemImage(images, hasImage) {
  // images array is populated on detail page; browse list only sends hasImage flag
  if (images && images.length > 0) return images[0];
  if (hasImage) return null; // has image but not loaded yet — caller should show placeholder
  return 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#2a2a2a"/><text x="50%" y="44%" fill="#666" font-family="sans-serif" font-size="36" text-anchor="middle" dy=".35em">📷</text><text x="50%" y="62%" fill="#555" font-family="sans-serif" font-size="14" text-anchor="middle" dy=".35em">No Image</text></svg>'
  );
}


/** Destroy current page listeners */
function destroyPage() {
  if (state.pageController) {
    state.pageController.abort();
    state.pageController = null;
  }
}

/** Create a new AbortController for the current page */
function createPageController() {
  state.pageController = new AbortController();
  return state.pageController.signal;
}

/** Utility: safely add event listener with page signal */
function listen(el, event, handler, signal) {
  if (el) el.addEventListener(event, handler, { signal });
}

/** Generate footer HTML */
function footerHtml() {
  return `
    <footer class="site-footer">
      <a href="#/terms">Terms & Conditions</a>
      <span class="footer-sep">|</span>
      <a href="#/privacy">Privacy Policy</a>
    </footer>`;
}

// ─── Toast Notifications ─────────────────────────────────────
const $toastContainer = document.createElement('div');
$toastContainer.id = 'toast-container';
document.body.appendChild($toastContainer);

function showToast(title, body, link) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <div class="toast-title">${escapeHtml(title)}</div>
    <div class="toast-body">${escapeHtml(body)}</div>
  `;
  if (link) {
    toast.style.cursor = 'pointer';
    toast.addEventListener('click', () => { navigate(link); toast.remove(); });
  }
  $toastContainer.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => toast.classList.add('show'));

  // Auto remove
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

let globalSocket = null;
function initGlobalSocket() {
  if (!state.user) {
    if (globalSocket) { globalSocket.disconnect(); globalSocket = null; }
    removeFab();
    return;
  }
  if (!globalSocket) {
    globalSocket = io(`${BACKEND_URL}/chat`, {
      withCredentials: true,
      transports: ['polling', 'websocket'],
    });
    globalSocket.on('notification', (payload) => {
      // Increment unread if it's a chat notification and we're NOT on that chat page
      if (payload.link && payload.link.startsWith('#/chat/')) {
        const currentHash = window.location.hash || '#/';
        if (!currentHash.startsWith('#/chat/')) {
          state.unreadChats++;
          updateChatBadges();
        }
      }
      showToast(payload.title, payload.body, payload.link);
    });
  }
  // Only show FAB if user has active chats — don't distract new/idle users
  checkAndShowFab();
}

/** Check for active transactions and show FAB only if any exist */
async function checkAndShowFab() {
  try {
    const CHAT_STATUSES = ['ACCEPTED', 'PAID', 'ACTIVE', 'GRACE', 'LATE'];
    const [rentals, lendings] = await Promise.all([api.myRentals(), api.myLendings()]);
    const allTx = [
      ...(Array.isArray(rentals) ? rentals : rentals.data || []),
      ...(Array.isArray(lendings) ? lendings : lendings.data || []),
    ];
    const hasActiveChats = allTx.some(tx => CHAT_STATUSES.includes(tx.status));
    if (hasActiveChats) createFab();
    else removeFab();
  } catch {
    // Can't fetch — don't show FAB
    removeFab();
  }
}

// ─── Floating Chat Button ──────────────────────────────────────

function createFab() {
  if (document.getElementById('chat-fab')) return;
  const fab = document.createElement('button');
  fab.id = 'chat-fab';
  fab.className = 'chat-fab';
  fab.innerHTML = '💬';
  fab.addEventListener('click', () => navigate('#/chats'));
  document.body.appendChild(fab);
  updateChatBadges();
}

function removeFab() {
  const fab = document.getElementById('chat-fab');
  if (fab) fab.remove();
}

function updateChatBadges() {
  const count = state.unreadChats;
  // FAB badge
  const fab = document.getElementById('chat-fab');
  if (fab) {
    const existing = fab.querySelector('.fab-badge');
    if (existing) existing.remove();
    if (count > 0) {
      const badge = document.createElement('span');
      badge.className = 'fab-badge';
      badge.textContent = count > 9 ? '9+' : count;
      fab.appendChild(badge);
    }
  }
  // Nav badge
  const navBadge = document.getElementById('nav-chat-badge');
  if (navBadge) {
    navBadge.textContent = count > 9 ? '9+' : count;
    navBadge.style.display = count > 0 ? 'inline-flex' : 'none';
  }
}

// ─── Auth Check ──────────────────────────────────────────────

async function checkAuth() {
  try {
    state.user = await api.getProfile();
  } catch {
    // Silently ignore — 401 is expected on public pages when not logged in
    state.user = null;
  }
  initGlobalSocket();
  renderNav();
}

/** Require auth — redirect to login if not logged in */
function requireAuth() {
  if (!state.user) {
    navigate('#/auth');
    return false;
  }
  return true;
}

// ─── Navbar Rendering ────────────────────────────────────────

function renderNav() {
  const hash = window.location.hash || '#/';
  const isActive = (h) => hash === h ? 'active' : '';

  if (state.user) {
    $navLinks.innerHTML = `
      <a href="#/browse" class="${isActive('#/browse')}">Browse</a>
      <a href="#/list-item" class="${isActive('#/list-item')}">List Item</a>
      <a href="#/chats" class="${isActive('#/chats')}">Chats<span id="nav-chat-badge" class="nav-badge" style="display:${state.unreadChats > 0 ? 'inline-flex' : 'none'}">${state.unreadChats}</span></a>
      <a href="#/wallet" class="${isActive('#/wallet')}">Wallet</a>
      <a href="#/rentals" class="${isActive('#/rentals')}">My Rentals</a>
      ${state.user.role === 'ADMIN' ? `<a href="#/admin" class="${isActive('#/admin')}" style="color:var(--color-warning);">⚙️ Admin</a>` : ''}
      <button id="btn-logout">Logout</button>
    `;
    const logoutBtn = document.getElementById('btn-logout');
    logoutBtn.addEventListener('click', async () => {
      try {
        await api.logout();
      } catch (_) { /* ignore */ }
      state.user = null;
      initGlobalSocket(); // will disconnect
      renderNav();
      navigate('#/');
    });
  } else {
    $navLinks.innerHTML = `
      <a href="#/browse" class="${isActive('#/browse')}">Browse</a>
      <a href="#/auth" class="${isActive('#/auth')}">Login</a>
    `;
  }
}

// Mobile nav toggle
$navToggle.addEventListener('click', () => {
  const isOpen = $navLinks.classList.toggle('open');
  document.body.classList.toggle('nav-open', isOpen);
});

// Close mobile nav on link click
$navLinks.addEventListener('click', (e) => {
  if (e.target.tagName === 'A') {
    $navLinks.classList.remove('open');
  }
});

// ─── Router ──────────────────────────────────────────────────

function router() {
  destroyPage();

  const hash = window.location.hash || '#/';
  const hashPath = hash.split('?')[0]; // strip query params before routing
  const [path, ...rest] = hashPath.slice(2).split('/');
  const param = rest.join('/');

  // Close mobile nav on any navigation
  $navLinks.classList.remove('open');
  document.body.classList.remove('nav-open'); // Remove scroll lock if present

  renderNav();

  switch (path) {
    case '':
      renderLanding();
      break;
    case 'browse':
      renderBrowse();
      break;
    case 'item':
      renderItemDetail(param);
      break;
    case 'auth':
      renderAuth();
      break;
    case 'wallet':
      renderWallet();
      break;
    case 'rentals':
      renderRentals();
      break;
    case 'list-item':
      renderListItem();
      break;
    case 'chats':
      renderChatList();
      break;
    case 'chat':
      renderChat(param);
      break;
    case 'checkout':
      renderCheckout(param);
      break;
    case 'terms':
      renderTerms();
      break;
    case 'privacy':
      renderPrivacy();
      break;
    case 'admin':
      renderAdmin();
      break;
    default:
      $app.innerHTML = `<div class="page empty-state"><p>Page not found</p><a href="#/" class="btn btn-secondary">Go Home</a></div>${footerHtml()}`;
  }
}

window.addEventListener('hashchange', router);

// ─── Page: Admin Dashboard ───────────────────────────────────

async function renderAdmin() {
  if (!requireAuth()) return;
  if (!state.user || state.user.role !== 'ADMIN') {
    showError('Admin access required.');
    navigate('#/');
    return;
  }

  const signal = createPageController();

  $app.innerHTML = `
    <div class="page">
      <h1 style="font-size:1.25rem; font-weight:700; margin-bottom:20px;">⚙️ Admin Dashboard</h1>

      <div id="admin-stats" style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:28px;"></div>

      <h2 style="font-size:1.1rem; font-weight:600; margin-bottom:12px;">Pending Reports</h2>
      <div id="admin-reports"></div>
    </div>
    ${footerHtml()}
  `;

  const $stats = document.getElementById('admin-stats');
  const $reports = document.getElementById('admin-reports');

  showLoading();
  try {
    const stats = await api.getAdminStats();
    $stats.innerHTML = `
      <div class="stat-card" style="flex:1;min-width:140px;padding:16px;border-radius:12px;background:var(--color-surface);border:1px solid var(--color-border);">
        <div class="stat-number">${stats.users}</div>
        <div class="stat-label">Verified Users</div>
      </div>
      <div class="stat-card" style="flex:1;min-width:140px;padding:16px;border-radius:12px;background:var(--color-surface);border:1px solid var(--color-border);">
        <div class="stat-number">${stats.items}</div>
        <div class="stat-label">Active Items</div>
      </div>
      <div class="stat-card" style="flex:1;min-width:140px;padding:16px;border-radius:12px;background:var(--color-surface);border:1px solid var(--color-border);">
        <div class="stat-number" style="color:var(--color-danger)">${stats.pendingReports}</div>
        <div class="stat-label">Pending Reports</div>
      </div>
    `;

    const reports = await api.getAdminReports();

    if (!reports || reports.length === 0) {
      $reports.innerHTML = '<div class="empty-state" style="padding:32px;"><p>🎉 No pending reports! Everything looks clean.</p></div>';
    } else {
      $reports.innerHTML = reports.map(r => {
        const isItem = r.type === 'ITEM';
        const targetName = isItem
          ? (r.item ? escapeHtml(r.item.title) : 'Deleted Item')
          : (r.reportedUser ? escapeHtml(r.reportedUser.name) : 'Unknown User');
        const targetExtra = isItem && r.item
          ? '<span style="color:var(--color-text-muted);font-size:0.8rem;"> · ' + escapeHtml(r.item.category || '') + ' · Listed by ' + escapeHtml(r.item.owner?.name || '?') + '</span>'
          : '';
        const imgSrc = isItem && r.item && r.item.images && r.item.images.length
          ? r.item.images[0]
          : itemImage([], false);
        const alreadyRemoved = isItem && r.item && !r.item.isActive;

        return '<div class="card" id="report-' + r.id + '" style="margin-bottom:16px; padding:16px; display:flex; gap:16px; align-items:flex-start;">'
          + (isItem ? '<img src="' + imgSrc + '" alt="" style="width:80px;height:80px;object-fit:cover;border-radius:8px;flex-shrink:0;" loading="lazy" />' : '')
          + '<div style="flex:1; min-width:0;">'
          + '<div style="font-weight:600; margin-bottom:4px;">'
          + (r.type === 'ITEM' ? '📦 ' : '👤 ') + targetName + targetExtra
          + '</div>'
          + '<div style="font-size:0.85rem; color:var(--color-text-muted); margin-bottom:6px;">'
          + 'Reported by <strong>' + escapeHtml(r.reporter?.name || '?') + '</strong> · ' + new Date(r.createdAt).toLocaleDateString()
          + '</div>'
          + '<div style="font-size:0.9rem; padding:8px 12px; background:var(--color-bg); border-radius:8px; margin-bottom:10px;">'
          + '"' + escapeHtml(r.reason) + '"'
          + '</div>'
          + '<div style="display:flex; gap:8px; flex-wrap:wrap;">'
          + (isItem && !alreadyRemoved ? '<button class="btn btn-sm btn-danger" data-action="remove" data-item-id="' + (r.item?.id || '') + '" data-report-id="' + r.id + '">🗑 Remove Item</button>' : '')
          + (alreadyRemoved ? '<span class="badge badge-returned" style="font-size:0.8rem;">Already removed</span>' : '')
          + '<button class="btn btn-sm btn-secondary" data-action="dismiss" data-report-id="' + r.id + '">Dismiss</button>'
          + '</div>'
          + '</div>'
          + '</div>';
      }).join('');
    }

    listen($reports, 'click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      const reportId = btn.dataset.reportId;

      btn.disabled = true;
      btn.textContent = '...';

      try {
        if (action === 'remove') {
          const itemId = btn.dataset.itemId;
          if (!confirm('Are you sure you want to remove this item? This cannot be undone.')) {
            btn.disabled = false;
            btn.textContent = '🗑 Remove Item';
            return;
          }
          const result = await api.removeAdminItem(itemId);
          showError(result.message || 'Item removed.');
          const card = document.getElementById('report-' + reportId);
          if (card) card.remove();
        } else if (action === 'dismiss') {
          await api.dismissReport(reportId);
          const card = document.getElementById('report-' + reportId);
          if (card) card.remove();
        }

        const remaining = $reports.querySelectorAll('.card').length;
        if (remaining === 0) {
          $reports.innerHTML = '<div class="empty-state" style="padding:32px;"><p>🎉 No pending reports! Everything looks clean.</p></div>';
        }
      } catch (err) {
        showError(err.message || 'Action failed');
        btn.disabled = false;
      }
    }, signal);

  } catch (err) {
    showError(err.message || 'Failed to load admin data');
    $reports.innerHTML = '<div class="empty-state"><p>Failed to load</p></div>';
  } finally {
    hideLoading();
  }
}

// ─── Page: Landing (Marketplace Homepage) ────────────────────

function renderLanding() {
  const signal = createPageController();

  const categoryChips = [
    { emoji: '\u{1F4DA}', label: 'Books', value: 'BOOKS' },
    { emoji: '\u{1F9EE}', label: 'Stationery', value: 'STATIONERY' },
    { emoji: '\u{1F3AE}', label: 'Electronics', value: 'ELECTRONICS' },
    { emoji: '\u{1F3F8}', label: 'Sports', value: 'SPORTS' },
    { emoji: '\u{1F9E5}', label: 'Clothing', value: 'CLOTHING' },
    { emoji: '\u{1F527}', label: 'Tools', value: 'TOOLS' },
    { emoji: '\u{1F373}', label: 'Kitchen', value: 'KITCHEN' },
  ];

  $app.innerHTML = `
    <div class="landing-v2">
      <section class="lv2-hero">
        <h1 class="lv2-headline">Hire what you need<br/>at <span class="lv2-brand">Woxsen</span>.</h1>
        <p class="lv2-sub">Calculators, controllers, lab coats, cameras, and more.</p>
        <div class="lv2-search-wrap">
          <span class="lv2-search-icon">\u{1F50D}</span>
          <input type="text" id="home-search" class="lv2-search" placeholder="Search items..." autocomplete="off" />
        </div>
        <div class="lv2-chips" id="home-chips">
          ${categoryChips.map(c => `<button class="lv2-chip" data-cat="${c.value}">${c.emoji} ${c.label}</button>`).join('')}
        </div>
        <p class="lv2-trust">\u{1F3EB} Campus-only \u00B7 \u{1F512} Secure escrow \u00B7 \u{1F4B8} Transparent fees</p>
      </section>

      <section class="lv2-section">
        <div class="lv2-section-head">
          <h2 class="lv2-section-title">\u{1F525} Trending on campus</h2>
          <a href="#/browse" class="lv2-see-all">See all \u2192</a>
        </div>
        <div class="item-grid" id="home-trending">${shimmerCards(6)}</div>
      </section>

      <section class="lv2-section">
        <div class="lv2-section-head">
          <h2 class="lv2-section-title">\u{1F195} Just listed</h2>
          <a href="#/browse" class="lv2-see-all">See all \u2192</a>
        </div>
        <div class="item-grid" id="home-recent">${shimmerCards(4)}</div>
      </section>

      <section class="lv2-cta-strip">
        <div class="lv2-cta-inner">
          <div>
            <div class="lv2-cta-title">\u{1F4B8} Earn from unused items</div>
            <div class="lv2-cta-sub">Your lab coat sitting in a drawer? Someone needs it tomorrow.</div>
          </div>
          <a href="#/${state.user ? 'list-item' : 'auth'}" class="btn btn-primary">List an Item</a>
        </div>
      </section>
    </div>
    ${footerHtml()}
  `;

  (async () => {
    try {
      const result = await api.getItems({ limit: 6 });
      const items = Array.isArray(result) ? result : (result.items || []);
      renderItemGrid('home-trending', items, signal);
    } catch { document.getElementById('home-trending').innerHTML = '<div class="empty-state"><p>Could not load items</p></div>'; }
  })();

  (async () => {
    try {
      const result = await api.getItems({ limit: 4, sort: 'newest' });
      const items = Array.isArray(result) ? result : (result.items || []);
      renderItemGrid('home-recent', items, signal);
    } catch { document.getElementById('home-recent').innerHTML = ''; }
  })();

  const $search = document.getElementById('home-search');
  listen($search, 'keydown', (e) => {
    if (e.key === 'Enter') {
      const q = $search.value.trim();
      window.location.hash = q ? `#/browse?search=${encodeURIComponent(q)}` : '#/browse';
    }
  }, signal);

  document.getElementById('home-chips').querySelectorAll('.lv2-chip').forEach(chip => {
    listen(chip, 'click', () => { window.location.hash = `#/browse?category=${chip.dataset.cat}`; }, signal);
  });
}

function renderItemGrid(containerId, items, signal) {
  const $el = document.getElementById(containerId);
  if (!$el) return;
  if (items.length === 0) { $el.innerHTML = '<div class="empty-state"><p>No items yet</p></div>'; return; }
  $el.innerHTML = items.map(item => `
    <div class="card" data-id="${item.id}">
      <div class="card-img-wrap">
        <img class="card-img" src="${itemImage(item.images, item.hasImage) || itemImage([], false)}" alt="${escapeHtml(item.title)}" loading="lazy" />
        <span class="card-avail-badge ${item.isAvailable ? 'avail' : 'taken'}">${item.isAvailable ? 'Available' : 'Taken'}</span>
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(item.title)}</div>
        <div class="card-meta">
          <span class="card-category">${escapeHtml(item.category ? item.category.charAt(0) + item.category.slice(1).toLowerCase() : '')}</span>
          ${item.owner?.name ? `<span class="card-owner">by ${escapeHtml(item.owner.name.split(' ')[0])}</span>` : ''}
        </div>
        <div class="card-price">
          ${item.pricePerHour != null ? formatPrice(item.pricePerHour) + ' <span>/hr</span>' : ''}
          ${item.pricePerHour != null && item.pricePerDay != null ? ' \u00B7 ' : ''}
          ${item.pricePerDay != null ? formatPrice(item.pricePerDay) + ' <span>/day</span>' : ''}
        </div>
      </div>
    </div>
  `).join('');
  $el.querySelectorAll('.card[data-id]').forEach(card => {
    listen(card, 'click', () => navigate(`#/item/${card.dataset.id}`), signal);
  });
}

function shimmerCards(count) {
  return Array.from({ length: count }, () => `
    <div class="card shimmer-card">
      <div class="shimmer-img"></div>
      <div class="shimmer-body">
        <div class="shimmer-line w60"></div>
        <div class="shimmer-line w40"></div>
        <div class="shimmer-line w50"></div>
      </div>
    </div>
  `).join('');
}


// ─── Page: Browse Items ──────────────────────────────────────

function renderBrowse() {
  const signal = createPageController();

  // Parse query params from hash (e.g. #/browse?search=camera&category=ELECTRONICS)
  const hashQuery = window.location.hash.split('?')[1] || '';
  const params = new URLSearchParams(hashQuery);

  let currentCategory = params.get('category') || '';
  let currentSearch = params.get('search') || '';
  let currentPage = 1;

  $app.innerHTML = `
    <div class="page">
      <h1 style="font-size:1.25rem; font-weight:700; margin-bottom:20px;">Browse Items</h1>
      <div class="browse-filters">
        <input type="text" class="form-input" id="browse-search" placeholder="Search items..." />
      </div>
      <div id="items-container" style="margin-top:20px;"></div>
      <div class="pagination" id="browse-pagination"></div>
    </div>
    ${footerHtml()}
  `;


  const $search = document.getElementById('browse-search');
  if (currentSearch) $search.value = currentSearch;
  const $container = document.getElementById('items-container');
  const $pagination = document.getElementById('browse-pagination');

  async function loadItems() {
    showLoading();
    try {
      const filters = { page: currentPage, limit: 12 };
      if (currentCategory) filters.category = currentCategory;
      if (currentSearch) filters.search = currentSearch;

      const result = await api.getItems(filters);
      const items = Array.isArray(result) ? result : (result.items || []);

      if (items.length === 0) {
        $container.innerHTML = `<div class="empty-state"><p>No items found</p></div>`;
        $pagination.innerHTML = '';
        return;
      }

      $container.innerHTML = `
        <div class="item-grid">
          ${items.map(item => `
            <div class="card" data-id="${item.id}">
              <img class="card-img" src="${itemImage(item.images, item.hasImage) || itemImage([], false)}" alt="${item.title}" loading="lazy" />
              <div class="card-body">
                <div class="card-title">${escapeHtml(item.title)}</div>
                <div class="card-subtitle">${escapeHtml(item.category || '')}</div>
                <div class="card-footer">
                  <div class="card-price">
                    ${item.pricePerHour != null ? formatPrice(item.pricePerHour) + ' <span>/hr</span>' : ''}
                    ${item.pricePerHour != null && item.pricePerDay != null ? ' · ' : ''}
                    ${item.pricePerDay != null ? formatPrice(item.pricePerDay) + ' <span>/day</span>' : ''}
                  </div>
                  <span>
                    <span class="avail-dot ${item.isAvailable ? 'available' : 'unavailable'}"></span>
                    ${item.isAvailable ? 'Available' : 'Taken'}
                  </span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `;

      // Pagination
      const total = result.total || items.length;
      const totalPages = Math.ceil(total / 12) || 1;
      $pagination.innerHTML = `
        <button class="btn btn-sm btn-secondary" id="prev-page" ${currentPage <= 1 ? 'disabled' : ''}>← Prev</button>
        <span class="page-info">Page ${currentPage} of ${totalPages}</span>
        <button class="btn btn-sm btn-secondary" id="next-page" ${items.length < 12 ? 'disabled' : ''}>Next →</button>
      `;

      listen(document.getElementById('prev-page'), 'click', () => {
        if (currentPage > 1) { currentPage--; loadItems(); }
      }, signal);

      listen(document.getElementById('next-page'), 'click', () => {
        if (items.length >= 12) { currentPage++; loadItems(); }
      }, signal);

      // Card clicks → item detail
      $container.querySelectorAll('.card[data-id]').forEach(card => {
        listen(card, 'click', () => navigate(`#/item/${card.dataset.id}`), signal);
      });

    } catch (err) {
      showError(err.message || 'Failed to load items');
      $container.innerHTML = `<div class="empty-state"><p>Failed to load items</p></div>`;
    } finally {
      hideLoading();
    }
  }

  // Search with debounce
  let searchTimeout;
  listen($search, 'input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      currentSearch = $search.value.trim();
      currentPage = 1;
      loadItems();
    }, 400);
  }, signal);

  loadItems();
}

// ─── Page: Item Detail ───────────────────────────────────────

async function renderItemDetail(id) {
  if (!id) { navigate('#/browse'); return; }

  const signal = createPageController();
  $app.innerHTML = `<div class="page"><div class="empty-state"><p>Loading item...</p></div></div>`;

  showLoading();
  let item;
  try {
    item = await api.getItem(id);
  } catch (err) {
    hideLoading();
    showError(err.message || 'Item not found');
    $app.innerHTML = `<div class="page empty-state"><p>Item not found</p><a href="#/browse" class="btn btn-secondary">Back to Browse</a></div>`;
    return;
  }
  hideLoading();

  const hasHourly = item.pricePerHour != null;
  const hasDaily = item.pricePerDay != null;
  const isExamItem = item.title.toLowerCase().includes('calculator');

  $app.innerHTML = `
    <div class="page">
      <a href="#/browse" style="font-size:0.875rem; color:var(--color-text-muted); margin-bottom:16px; display:inline-block;">← Back to Browse</a>
      <div class="item-detail">
        <div class="item-images">
          <img src="${itemImage(item.images)}" alt="${escapeHtml(item.title)}" loading="lazy" />
        </div>
        <div class="item-info">
          <h1>${escapeHtml(item.title)}</h1>
          <div class="item-owner">Listed by ${escapeHtml(item.owner?.name || 'Unknown')} · ${escapeHtml(item.category || '')}</div>
          <div class="item-desc">${escapeHtml(item.description || '')}</div>

          <!-- NEW: Upfront information to reduce chat spam (Collapsible) -->
          <details style="margin-top:24px; padding:6px; background:var(--color-surface); border-radius:14px; border:1px solid var(--color-border); cursor:pointer;">
            <summary style="font-weight:800; padding:12px; color:var(--color-primary); font-size:1.05rem; list-style:none; display:flex; align-items:center; justify-content:space-between;">
               <span>📋 Lender Quick Info</span>
               <span style="font-size:0.8rem; opacity:0.6;">▼</span>
            </summary>
            <div style="padding:0 12px 12px; font-size:0.95rem; line-height:1.6; text-align:left;">
              <div style="margin-bottom:8px; display:flex; gap:8px;">
                <span style="color:var(--color-text-muted); min-width:90px;">📍 Pickup:</span>
                <span style="font-weight:600;">${escapeHtml(item.pickupLocation || "Not specified")}</span>
              </div>
              <div style="margin-bottom:8px; display:flex; gap:8px;">
                <span style="color:var(--color-text-muted); min-width:90px;">🕒 Availability:</span>
                <span style="font-weight:600;">${escapeHtml(item.availabilityNote || "Flexible")}</span>
              </div>
              <div style="display:flex; gap:8px;">
                <span style="color:var(--color-text-muted); min-width:90px;">📦 Condition:</span>
                <span style="font-weight:600;">${escapeHtml(item.conditionNote || "As listed")}</span>
              </div>
            </div>
          </details>

          <!-- CTA section BELOW item details -->
          <div style="margin-top:32px; padding-top:24px; border-top:1px solid var(--color-border); text-align:center;">
             ${isExamItem ? `
               <!-- EXAM MODE CTA -->
               <div style="margin-bottom:28px;">
                 <div style="font-size:1.1rem; font-weight:700; color:var(--color-warning); letter-spacing:0.03em; margin-bottom:10px;">⚡ Exams ongoing</div>
                 <h2 style="font-size:1.75rem; font-weight:800; line-height:1.2; margin:0;">Need a calculator<br>RIGHT NOW?</h2>
               </div>
               
               ${item.isAvailable ? `
                 <div id="turnover-warning-container" style="min-height:48px; transition:min-height 0.2s ease; overflow:hidden;"></div>
                 <div style="font-size:0.85rem; font-weight:500; color:var(--color-primary); margin-bottom:12px;">✔ Most bookings confirmed within minutes</div>
                 <button
                   id="btn-quick"
                   style="
                     display:block; width:100%; min-height:60px;
                     background:#16a34a; color:#fff;
                     font-size:1.2rem; font-weight:700;
                     border:none; border-radius:14px;
                     padding:18px 24px; cursor:pointer;
                     box-shadow:0 4px 18px rgba(22,163,74,0.35);
                     transition:transform 0.1s, box-shadow 0.1s;
                   "
                   onmousedown="this.style.transform='scale(0.97)'"
                   onmouseup="this.style.transform='scale(1)'"
                 >⚡ Get a calculator now</button>
   
                 <!-- Trust signals -->
                 <div style="margin-top:20px; display:flex; flex-direction:column; gap:10px; color:var(--color-text-muted); font-size:0.95rem;">
                   <span>Booking available</span>
                   <span>✔ Pickup after confirmation</span>
                   <span>✔ Takes less than 2 minutes</span>
                 </div>
               ` : `
                 <div style="padding:24px; background:var(--color-surface); border-radius:12px; color:var(--color-text-muted);">
                   😔 This item is currently unavailable. <a href="#/browse" style="color:var(--color-primary);">Browse others →</a>
                 </div>
               `}
             ` : `
               <!-- STANDARD BOOKING CTA -->
               ${item.isAvailable ? `
                 <form id="booking-form" style="display:flex; flex-direction:column; gap:20px; text-align:left; background:var(--color-surface); padding:24px; border-radius:16px;">
                   <div style="font-size:1.3rem; font-weight:800; color:var(--color-text-main);">📦 Book this item</div>
                   
                   <div style="font-size:1.1rem; font-weight:600; color:var(--color-primary); background:rgba(22, 163, 74, 0.1); padding:10px 14px; border-radius:10px; display:inline-block; text-align:center;">
                       💰 ₹${item.pricePerHour || item.pricePerDay}${item.pricePerHour ? '/hour' : '/day'}
                   </div>
                   
                   <div id="booking-interactive-ui"></div>
  
                   <button type="submit" id="btn-standard" class="btn btn-primary" disabled style="margin-top:8px; min-height:60px; font-weight:800; font-size:1.2rem; background:#16a34a; border-radius:14px; box-shadow:0 4px 18px rgba(22,163,74,0.35); opacity:0.5;">Select time to continue</button>

                   <!-- Trust signals -->
                   <div style="margin-top:12px; display:flex; flex-direction:column; gap:8px; color:var(--color-text-muted); font-size:0.9rem; text-align:center;">
                     <span>✔ Booking confirmed after approval</span>
                     <span>✔ Takes less than 2 minutes</span>
                   </div>
                 </form>
               ` : `
                 <div style="padding:24px; background:var(--color-surface); border-radius:12px; color:var(--color-text-muted);">
                   😔 This item is currently unavailable. <a href="#/browse" style="color:var(--color-primary);">Browse others →</a>
                 </div>
               `}
             `}

             <!-- Report link (subtle) -->
             <div style="margin-top:32px;">
               <button style="background:none; border:none; font-size:0.8rem; color:var(--color-text-muted); cursor:pointer; text-decoration:underline;" onclick="reportItem('${item.id}')">Report this item</button>
             </div>
          </div>
        </div>
      </div>
    </div>
    ${footerHtml()}
  `;

  if (state.user && item.isAvailable && isExamItem) {
    api.checkTurnover({ itemId: item.id, rentalType: 'QUICK' })
      .then(res => {
        const container = document.getElementById('turnover-warning-container');
        if (res.warning && res.warning.showUIBox) {
          if (container) {
            container.innerHTML = `<div style="color:${res.warning.color}; padding:10px 14px; border:1px solid ${res.warning.border}; background:${res.warning.bg}; border-radius:10px; margin-bottom:12px; font-weight:500; text-align:left; font-size:0.85rem; line-height:1.4;">${escapeHtml(res.warning.message)}</div>`;
          }
        } else {
          if (container) {
            container.style.minHeight = '0';
          }
          if (res.warning && !res.warning.showUIBox) {
            const ctaBtn = document.getElementById('btn-quick');
            if (ctaBtn && ctaBtn.parentNode) {
              const note = document.createElement('div');
              note.style = "font-size:0.8rem; color:var(--color-warning); text-align:center; margin-top:8px; font-weight:500;";
              note.textContent = "⚠️ " + res.warning.shortText;
              ctaBtn.parentNode.insertBefore(note, ctaBtn.nextSibling);
            }
          }
        }
      })
      .catch(err => {
         console.error('Turnover check failed:', err);
         const container = document.getElementById('turnover-warning-container');
         if (container) container.style.minHeight = '0';
      });
  }

  // ─── Exam Mode button handlers ───────────────────────────────
  const handlePresetReq = async (type) => {
    if (!requireAuth()) return;
    const btn = type === 'QUICK'
      ? document.getElementById('btn-quick')
      : document.getElementById('btn-exam');

    if (btn) { 
      if (btn.dataset.loading === '1') return;
      btn.dataset.loading = '1';
      btn.disabled = true; 
      btn.style.cursor = 'not-allowed';
      btn.innerHTML = '⏳ Sending request...'; 
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    showLoading();
    try {
      await api.requestBorrow({ itemId: item.id, rentalType: type }, { signal: controller.signal });
      clearTimeout(timeoutId);
      hideLoading();
      
      // ✅ Add a tiny moment of success feedback
      if (btn) {
        btn.innerHTML = '✅ Request sent — waiting for confirmation';
        btn.style.background = '#10b981'; // Softer green so CTA remains dominant
      }

      // Briefly pause before proceeding to the next step
      setTimeout(() => {
        $app.innerHTML = `
          <div class="page empty-state">
            <p>✓ Request sent! The lender will review it shortly.</p>
            <a href="#/rentals" class="btn btn-secondary" style="margin-top:12px;">View My Rentals</a>
          </div>
        `;
      }, 1000);

    } catch (err) {
      clearTimeout(timeoutId);
      hideLoading();
      // ✅ Restore original CTA state on failure so they can try again
      if (btn) { 
          btn.disabled = false; 
          btn.style.cursor = 'pointer';
          btn.textContent = type === 'QUICK' ? '⚡ Get a calculator now' : '📚 Exam Pass — ₹150'; 
      }

      if (err.name === 'AbortError') {
          showError('Network slow. Please try again.');
      } else {
          showError(err.message || 'Something went wrong. Try again.');
      }
    } finally {
      if (btn) btn.dataset.loading = '0';
    }
  };

  if (isExamItem) {
    listen(document.getElementById('btn-quick'), 'click', () => handlePresetReq('QUICK'), signal);
  } else {
    const $bookingForm = document.getElementById('booking-form');
    if ($bookingForm) {
      const $interactiveUI = document.getElementById('booking-interactive-ui');
      const $btnStandard = document.getElementById('btn-standard');
      
      const sessionPayload = JSON.parse(sessionStorage.getItem('lendit_rebook_payload') || 'null');
      let stateDate = null;
      let stateStartHr = null;
      let stateEndHr = null;

      // Friction Reduction: Restore last selection on recovery flow (Rebook)
      if (sessionPayload) {
          const sDate = new Date(sessionPayload.pickupDate);
          const eDate = new Date(sessionPayload.returnDate);
          const yyyy = sDate.getFullYear();
          const mm = String(sDate.getMonth() + 1).padStart(2, '0');
          const dd = String(sDate.getDate()).padStart(2, '0');
          stateDate = `${yyyy}-${mm}-${dd}`;
          stateStartHr = sDate.getHours();
          stateEndHr = eDate.getHours();
          sessionStorage.removeItem('lendit_rebook_payload'); // Single-use restoration
      }
      
      const dates = [];
      const now = new Date();
      for (let i = 0; i < 7; i++) {
          const d = new Date(now);
          d.setDate(d.getDate() + i);
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          const val = `${yyyy}-${mm}-${dd}`;
          let label = (i === 0) ? 'Today' : (i === 1) ? 'Tomorrow' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          dates.push({ label, val, isToday: i === 0 });
      }

      const times = [];
      for (let i = 8; i <= 22; i++) {
          const ampm = i >= 12 ? 'PM' : 'AM';
          const h = i > 12 ? i - 12 : (i === 0 ? 12 : i);
          times.push({ label: `${h}:00 ${ampm}`, val: i });
      }

      function updateUI() {
          let html = `
            <style>
              .date-row::-webkit-scrollbar { display: none; }
              .date-row-wrapper::after {
                content: "";
                position: absolute;
                right: 0;
                top: 0;
                height: 100%;
                width: 32px;
                pointer-events: none;
                background: linear-gradient(to right, transparent, var(--color-surface));
              }
            </style>
          `;
          html += `<div style="margin-top:8px;">
            <div style="font-weight:700; margin-bottom:12px; display:block; font-size:1rem;">📅 Pickup Date</div>
            <div class="date-row-wrapper" style="position:relative; margin-right:-24px; padding-right:24px;">
              <div class="date-row" style="display:flex; gap:8px; overflow-x:auto; padding-bottom:12px; scroll-snap-type:x mandatory; -webkit-overflow-scrolling:touch; scrollbar-width:none;">`;
          dates.forEach(d => {
              const bg = stateDate === d.val ? '#16a34a' : 'var(--color-surface-hover)';
              const color = stateDate === d.val ? '#fff' : 'var(--color-text-main)';
              html += `<button type="button" class="date-pill" data-val="${d.val}" style="flex:0 0 auto; scroll-snap-align:start; white-space:nowrap; background:${bg}; color:${color}; border:1px solid ${stateDate === d.val ? '#16a34a' : 'var(--color-border)'}; padding:10px 16px; border-radius:999px; font-weight:600; cursor:pointer;">${d.label}</button>`;
          });
          html += `</div></div></div>`;

          if (stateDate) {
              const isToday = dates[0].val === stateDate;
              const currentHour = now.getHours();

              html += `<div style="margin-top:16px;">
                <div style="font-weight:700; margin-bottom:12px; display:block; font-size:1rem;">⏰ Pickup Time</div>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">`;
              
              times.forEach(t => {
                  const past = isToday && t.val <= currentHour;
                  if (past) return;
                  const bg = stateStartHr === t.val ? '#16a34a' : 'var(--color-surface-hover)';
                  const color = stateStartHr === t.val ? '#fff' : 'var(--color-text-main)';
                  html += `<button type="button" class="start-pill" data-val="${t.val}" style="background:${bg}; color:${color}; border:1px solid ${stateStartHr === t.val ? '#16a34a' : 'var(--color-border)'}; padding:10px 18px; border-radius:999px; font-weight:600; cursor:pointer;">${t.label}</button>`;
              });
              html += `</div></div>`;

              if (stateStartHr !== null) {
                  html += `<div style="margin-top:16px;">
                    <div style="font-weight:700; margin-bottom:12px; display:block; font-size:1rem;">⏰ Return Time</div>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">`;
                  
                  times.forEach(t => {
                      if (t.val <= stateStartHr) return;
                      const bg = stateEndHr === t.val ? '#16a34a' : 'var(--color-surface-hover)';
                      const color = stateEndHr === t.val ? '#fff' : 'var(--color-text-main)';
                      html += `<button type="button" class="end-pill" data-val="${t.val}" style="background:${bg}; color:${color}; border:1px solid ${stateEndHr === t.val ? '#16a34a' : 'var(--color-border)'}; padding:10px 18px; border-radius:999px; font-weight:600; cursor:pointer;">${t.label}</button>`;
                  });
                  html += `</div></div>`;
              }
          }

          if (stateStartHr !== null && stateEndHr !== null) {
              const hours = stateEndHr - stateStartHr;
              let baseRent = 0;
              if (item.pricePerDay && item.pricePerHour) {
                  const days = Math.floor(hours / 24);
                  const remHours = hours % 24;
                  baseRent = Math.min((days * item.pricePerDay) + (remHours * item.pricePerHour), (days + 1) * item.pricePerDay);
              } else if (item.pricePerDay) {
                  baseRent = Math.ceil(hours / 24) * item.pricePerDay;
              } else if (item.pricePerHour) {
                  baseRent = hours * item.pricePerHour;
              }

              html += `<div style="margin-top:24px; padding:16px; border-radius:12px; background:rgba(22, 163, 74, 0.05); text-align:center; border:1px solid rgba(22, 163, 74, 0.1);">
                  <div style="font-size:0.95rem; color:var(--color-text-muted); margin-bottom:4px;">🕒 Duration: ${hours} hour${hours > 1 ? 's' : ''}</div>
                  <div style="font-size:1.25rem; font-weight:800; color:var(--color-primary);">💸 Estimated Total: ₹${baseRent}</div>
              </div>`;

              $btnStandard.disabled = false;
              $btnStandard.textContent = '⚡ Rent now';
              $btnStandard.style.opacity = '1';
          } else {
              $btnStandard.disabled = true;
              $btnStandard.textContent = 'Select time to continue';
              $btnStandard.style.opacity = '0.5';
          }
          
          if ($interactiveUI) $interactiveUI.innerHTML = html;

          $interactiveUI?.querySelectorAll('.date-pill').forEach(btn => {
              btn.addEventListener('click', (e) => {
                  stateDate = e.target.dataset.val;
                  stateStartHr = null;
                  stateEndHr = null;
                  updateUI();
                  setTimeout(() => {
                      const selectedElement = $interactiveUI.querySelector('.date-pill[data-val="' + stateDate + '"]');
                      if (selectedElement) selectedElement.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                  }, 10);
              });
          });
          $interactiveUI?.querySelectorAll('.start-pill').forEach(btn => {
              btn.addEventListener('click', (e) => {
                  stateStartHr = parseInt(e.target.dataset.val, 10);
                  stateEndHr = stateStartHr + 1;
                  if (stateEndHr > 22) stateEndHr = 22;
                  updateUI();
              });
          });
          $interactiveUI?.querySelectorAll('.end-pill').forEach(btn => {
              btn.addEventListener('click', (e) => {
                  stateEndHr = parseInt(e.target.dataset.val, 10);
                  updateUI();
              });
          });
      }

      updateUI();

      listen($bookingForm, 'submit', async (e) => {
        e.preventDefault();
        if (!requireAuth()) return;
        
        const btn = document.getElementById('btn-standard');
        if (btn) {
          if (btn.dataset.loading === '1') return;
          btn.dataset.loading = '1';
          btn.disabled = true;
          btn.style.cursor = 'not-allowed';
          btn.innerHTML = '⏳ Processing...';
        }
        
        const [yyyy, mm, dd] = stateDate.split('-').map(Number);
        const reqStart = new Date(yyyy, mm - 1, dd, stateStartHr, 0, 0).toISOString();
        const reqEnd = new Date(yyyy, mm - 1, dd, stateEndHr, 0, 0).toISOString();

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        showLoading();
        try {
          const res = await api.requestBorrow({
            itemId: item.id,
            requestedStartTime: reqStart,
            requestedEndTime: reqEnd
          }, { signal: controller.signal });
          
          clearTimeout(timeoutId);
          hideLoading();
          
          if (btn) {
            btn.innerHTML = '✅ Request sent — Redirecting...';
            btn.style.background = '#10b981';
          }

          setTimeout(() => {
            window.location.hash = `#/checkout/${res.id}`;
          }, 800);
        } catch (err) {
          clearTimeout(timeoutId);
          hideLoading();
          if (btn) {
            btn.disabled = false;
            btn.style.cursor = 'pointer';
            btn.textContent = '⚡ Rent now';
            btn.style.background = '#16a34a';
          }
          if (err.name === 'AbortError') {
            showError('Network slow. Please try again.');
          } else {
            showError(err.message || 'Something went wrong. Try again.');
          }
        } finally {
          if (btn) btn.dataset.loading = '0';
        }
      }, signal);
    }
  }
}

// ─── Page: Auth ──────────────────────────────────────────────

function renderAuth() {
  if (state.user) { navigate('#/'); return; }

  const signal = createPageController();
  let mode = 'login'; // 'login' | 'signup' | 'otp'
  let otpEmail = '';

  function render() {
    if (mode === 'otp') {
      $app.innerHTML = `
        <div class="page">
          <div class="form-box">
            <h2>Verify your email</h2>
            <p style="text-align:center; font-size:0.875rem; color:var(--color-text-secondary); margin-bottom:20px;">
              We sent a 6-digit code to <strong>${escapeHtml(otpEmail)}</strong>
            </p>
            <form id="otp-form">
              <div class="form-group">
                <label for="otp-code">OTP Code</label>
                <input type="text" class="form-input" id="otp-code" placeholder="123456" maxlength="6" pattern="\\d{6}" required />
              </div>
              <button type="submit" class="btn btn-primary btn-block">Verify</button>
            </form>
            <div style="text-align:center; margin-top:12px;">
              <button class="btn btn-sm btn-secondary" id="resend-otp">Resend OTP</button>
            </div>
            <div id="auth-msg" style="margin-top:12px; text-align:center; font-size:0.875rem;"></div>
          </div>
        </div>
      `;

      const $form = document.getElementById('otp-form');
      listen($form, 'submit', async (e) => {
        e.preventDefault();
        const otp = document.getElementById('otp-code').value.trim();
        if (!/^\d{6}$/.test(otp)) {
          showError('Please enter a valid 6-digit OTP');
          return;
        }
        showLoading();
        try {
          await api.verifyOtp({ email: otpEmail, otp });
          await checkAuth();
          hideLoading();
          navigate('#/');
        } catch (err) {
          hideLoading();
          document.getElementById('auth-msg').textContent = err.message || 'Verification failed';
          document.getElementById('auth-msg').style.color = 'var(--color-danger)';
        }
      }, signal);

      listen(document.getElementById('resend-otp'), 'click', async () => {
        try {
          await api.resendOtp(otpEmail);
          document.getElementById('auth-msg').textContent = 'OTP resent!';
          document.getElementById('auth-msg').style.color = 'var(--color-success)';
        } catch (err) {
          document.getElementById('auth-msg').textContent = err.message || 'Failed to resend';
          document.getElementById('auth-msg').style.color = 'var(--color-danger)';
        }
      }, signal);

      return;
    }

    $app.innerHTML = `
      <div class="page">
        <div class="form-box">
          <div class="auth-tabs">
            <button class="${mode === 'login' ? 'active' : ''}" data-mode="login">Login</button>
            <button class="${mode === 'signup' ? 'active' : ''}" data-mode="signup">Sign Up</button>
          </div>

          ${mode === 'login' ? `
          <form id="auth-form">
            <div class="form-group">
              <label for="login-email">Email</label>
              <input type="email" class="form-input" id="login-email" placeholder="you@university.edu" required />
            </div>
            <div class="form-group">
              <label for="login-password">Password</label>
              <input type="password" class="form-input" id="login-password" placeholder="Your password" required />
            </div>
            <button type="submit" class="btn btn-primary btn-block">Login</button>
            <p class="auth-passive-notice">By continuing, you agree to LendIT's <a href="#/terms">Terms &amp; Conditions</a> and <a href="#/privacy">Privacy Policy</a>.</p>
            <div id="auth-msg" style="margin-top:12px; text-align:center; font-size:0.875rem;"></div>
          </form>
          ` : `
          <form id="auth-form">
            <div class="form-group">
              <label for="signup-name">Full Name</label>
              <input type="text" class="form-input" id="signup-name" placeholder="Your name" required minlength="2" />
            </div>
            <div class="form-group">
              <label for="signup-email">Student Email</label>
              <input type="email" class="form-input" id="signup-email" placeholder="you@university.edu.in" required />
              <div class="form-hint">Must be an institutional email (.edu.in or .ac.in)</div>
            </div>
            <div class="form-group">
              <label for="signup-college">College</label>
              <input type="text" class="form-input" id="signup-college" placeholder="Your college name" required />
            </div>
            <div class="form-group">
              <label for="signup-password">Password</label>
              <input type="password" class="form-input" id="signup-password" placeholder="Min 8 chars, uppercase, lowercase, number" required minlength="8" />
              <div class="form-hint">Must include uppercase, lowercase, and a number or special character</div>
            </div>
            <div class="consent-group">
              <label class="consent-label">
                <input type="checkbox" id="signup-consent" />
                <span>I agree to the <a href="#/terms">Terms &amp; Conditions</a> and <a href="#/privacy">Privacy Policy</a></span>
              </label>
              <div class="form-error" id="consent-error" style="display:none;">You must agree to the Terms & Conditions and Privacy Policy</div>
            </div>
            <button type="submit" class="btn btn-primary btn-block" id="signup-submit" disabled>Create Account</button>
            <div id="auth-msg" style="margin-top:12px; text-align:center; font-size:0.875rem;"></div>
          </form>
          `}
        </div>
      </div>
      ${footerHtml()}
    `;

    // Tab switching
    $app.querySelectorAll('.auth-tabs button').forEach(btn => {
      listen(btn, 'click', () => {
        mode = btn.dataset.mode;
        render();
      }, signal);
    });

    // Signup consent checkbox → enable/disable submit
    if (mode === 'signup') {
      const $consent = document.getElementById('signup-consent');
      const $submitBtn = document.getElementById('signup-submit');
      const $consentError = document.getElementById('consent-error');
      if ($consent && $submitBtn) {
        listen($consent, 'change', () => {
          $submitBtn.disabled = !$consent.checked;
          if ($consent.checked) $consentError.style.display = 'none';
        }, signal);
      }
    }

    // Form submission
    const $form = document.getElementById('auth-form');
    const $msg = document.getElementById('auth-msg');

    listen($form, 'submit', async (e) => {
      e.preventDefault();
      $msg.textContent = '';

      if (mode === 'login') {
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;

        showLoading();
        try {
          await api.login({ email, password });
          await checkAuth();
          hideLoading();
          navigate('#/');
        } catch (err) {
          hideLoading();
          $msg.textContent = err.message || 'Login failed';
          $msg.style.color = 'var(--color-danger)';
        }
      } else {
        // Signup — validate consent checkbox
        const $consent = document.getElementById('signup-consent');
        const $consentError = document.getElementById('consent-error');
        if (!$consent || !$consent.checked) {
          if ($consentError) $consentError.style.display = 'block';
          return;
        }

        const name = document.getElementById('signup-name').value.trim();
        const email = document.getElementById('signup-email').value.trim();
        const college = document.getElementById('signup-college').value.trim();
        const password = document.getElementById('signup-password').value;

        showLoading();
        try {
          const res = await api.signup({ name, email, college, password });
          hideLoading();
          
          if (res.requiresVerification === false || res.message?.toLowerCase().includes('successfully')) {
            // Beta bypass: user is already verified and cookies are set
            await checkAuth(); // Refresh global user state
            navigate('#/');
          } else {
            // Production: transition to OTP screen
            otpEmail = email;
            mode = 'otp';
            render();
          }
        } catch (err) {
          hideLoading();
          $msg.textContent = err.message || 'Signup failed';
          $msg.style.color = 'var(--color-danger)';
        }
      }
    }, signal);
  }

  render();
}

// ─── Page: Wallet ────────────────────────────────────────────

async function renderWallet() {
  if (!requireAuth()) return;

  const signal = createPageController();

  $app.innerHTML = `
    <div class="page">
      <h1 style="font-size:1.25rem; font-weight:700; margin-bottom:24px;">Wallet</h1>
      <div id="wallet-content"><div class="empty-state"><p>Loading...</p></div></div>
    </div>
  `;

  const $content = document.getElementById('wallet-content');

  async function load() {
    showLoading();
    try {
      const wallet = await api.getWallet();

      $content.innerHTML = `
        <div class="wallet-header">
          <div class="wallet-balance">
            <span>Available Balance</span>
            ${formatPrice(wallet.balance)}
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-primary" id="btn-deposit">+ Add Funds</button>
            <button class="btn btn-secondary" id="btn-withdraw">Withdraw</button>
          </div>
        </div>

        <!-- Deposit form (hidden by default) -->
        <div id="deposit-form-area" style="display:none; margin-bottom:24px;">
          <div class="form-box" style="max-width:320px;">
            <h2 style="font-size:1rem;">Add Funds to Wallet</h2>
            <p style="font-size:0.8rem;color:var(--color-text-muted);margin-bottom:12px;">This is a demo top-up — no real payment is processed.</p>
            <form id="deposit-form">
              <div class="form-group">
                <label for="deposit-amount">Amount (₹10 – ₹10,000)</label>
                <input type="number" class="form-input" id="deposit-amount" min="10" max="10000" placeholder="500" required />
              </div>
              <button type="submit" class="btn btn-primary btn-block btn-sm">Add Funds</button>
            </form>
          </div>
        </div>

        <!-- Withdrawal form (hidden by default) -->
        <div id="withdraw-form-area" style="display:none; margin-bottom:24px;">
          <div class="form-box" style="max-width:320px;">
            <h2 style="font-size:1rem;">Request Withdrawal</h2>
            <form id="withdraw-form">
              <div class="form-group">
                <label for="withdraw-amount">Amount (₹100 – ₹10,000)</label>
                <input type="number" class="form-input" id="withdraw-amount" min="100" max="10000" placeholder="500" required />
              </div>
              <button type="submit" class="btn btn-primary btn-block btn-sm">Submit Request</button>
            </form>
          </div>
        </div>

      `;

      // Deposit toggle
      listen(document.getElementById('btn-deposit'), 'click', () => {
        const area = document.getElementById('deposit-form-area');
        area.style.display = area.style.display === 'none' ? 'block' : 'none';
        document.getElementById('withdraw-form-area').style.display = 'none';
      }, signal);

      // Deposit form
      const $dForm = document.getElementById('deposit-form');
      if ($dForm) {
        listen($dForm, 'submit', async (e) => {
          e.preventDefault();
          const amount = parseInt(document.getElementById('deposit-amount').value, 10);
          if (amount < 10 || amount > 10000) {
            showError('Amount must be between ₹10 and ₹10,000');
            return;
          }
          showLoading();
          try {
            await api.depositWallet(amount);
            hideLoading();
            load(); // Reload wallet to show new balance
          } catch (err) {
            hideLoading();
            showError(err.message || 'Deposit failed');
          }
        }, signal);
      }

      // Withdraw toggle
      listen(document.getElementById('btn-withdraw'), 'click', () => {
        const area = document.getElementById('withdraw-form-area');
        area.style.display = area.style.display === 'none' ? 'block' : 'none';
        document.getElementById('deposit-form-area').style.display = 'none';
      }, signal);

      // Withdraw form
      const $wForm = document.getElementById('withdraw-form');
      if ($wForm) {
        listen($wForm, 'submit', async (e) => {
          e.preventDefault();
          const amount = parseInt(document.getElementById('withdraw-amount').value, 10);
          if (amount < 100 || amount > 10000) {
            showError('Amount must be between ₹100 and ₹10,000');
            return;
          }
          showLoading();
          try {
            await api.requestWithdrawal(amount);
            hideLoading();
            load(); // Reload wallet
          } catch (err) {
            hideLoading();
            showError(err.message || 'Withdrawal failed');
          }
        }, signal);
      }

    } catch (err) {
      hideLoading();
      showError(err.message || 'Failed to load wallet');
      $content.innerHTML = `<div class="empty-state"><p>Failed to load wallet data</p></div>`;
    } finally {
      hideLoading();
    }
  }

  load();
}

// ─── Page: My Rentals ────────────────────────────────────────

async function renderRentals() {
  if (!requireAuth()) return;

  const signal = createPageController();
  let activeTab = 'borrowed';

  $app.innerHTML = `
    <div class="page">
      <h1 style="font-size:1.25rem; font-weight:700; margin-bottom:20px;">My Rentals</h1>
      <div class="tabs" id="rental-tabs">
        <button class="tab-btn active" data-tab="borrowed">Borrowed</button>
        <button class="tab-btn" data-tab="lent">Lent</button>
      </div>
      <div id="rental-list"><div class="empty-state"><p>Loading...</p></div></div>
    </div>
  `;

  const $tabs = document.getElementById('rental-tabs');
  const $list = document.getElementById('rental-list');

  async function loadTab() {
    showLoading();
    try {
      const transactions = activeTab === 'borrowed'
        ? await api.myRentals()
        : await api.myLendings();

      const items = Array.isArray(transactions) ? transactions : (transactions.data || []);

      if (items.length === 0) {
        $list.innerHTML = `<div class="empty-state"><p>No ${activeTab === 'borrowed' ? 'borrowed' : 'lent'} items yet</p></div>`;
        return;
      }

      const CHAT_STATUSES = ['ACCEPTED', 'ACTIVE', 'GRACE', 'LATE'];
      const isLender = activeTab === 'lent';

      $list.innerHTML = items.map(tx => {
        const itemData = tx.item || {};
        const showChat = CHAT_STATUSES.includes(tx.status);
        const hasPaid = tx.escrowHeld;

        // Lender controls
        let lenderOtpHtml = '';
        if (isLender) {
          if (tx.status === 'REQUESTED') {
            lenderOtpHtml = `
              <button class="btn btn-sm btn-primary" data-action="Accept" data-txid="${tx.id}">Accept</button>
              <button class="btn btn-sm btn-danger" data-action="Reject" data-txid="${tx.id}">Reject</button>
            `;
          } else if (tx.status === 'ACCEPTED' && !hasPaid) {
            lenderOtpHtml = `<button class="btn btn-sm btn-danger" data-action="Cancel" data-txid="${tx.id}">Cancel</button>`;
          } else if (tx.status === 'PAID') { // Now PAID means escrow held
            lenderOtpHtml = `
              <button class="btn btn-sm btn-secondary" data-showotp="pickup" data-txid="${tx.id}">🔑 Show Pickup OTP</button>
              <button class="btn btn-sm btn-danger" data-action="Cancel" data-txid="${tx.id}">Cancel</button>
            `;
          } else if (['ACTIVE', 'GRACE', 'LATE'].includes(tx.status)) {
            lenderOtpHtml = `<button class="btn btn-sm btn-secondary" data-showotp="return" data-txid="${tx.id}">🔑 Show Return OTP</button>`;
          }
        }

        // Renter controls
        let renterOtpHtml = '';
        if (!isLender) {
          if (tx.status === 'REQUESTED') {
            renterOtpHtml = `
              <span style="font-size:0.8rem;color:var(--color-text-muted);">Waiting for lender to accept…</span>
              <button class="btn btn-sm btn-danger" data-action="Cancel" data-txid="${tx.id}" style="margin-left:8px;">Cancel</button>
            `;
          } else if (tx.status === 'ACCEPTED') {
            renterOtpHtml = `
              <button class="btn btn-sm btn-primary" data-action="Pay" data-txid="${tx.id}">Pay</button>
              <button class="btn btn-sm btn-danger" data-action="Cancel" data-txid="${tx.id}">Cancel</button>
            `;
          } else if (tx.status === 'PAID') {
            renterOtpHtml = `
              <div class="otp-input-row" style="margin-bottom:8px;">
                <input type="text" class="form-input otp-field" inputmode="numeric" maxlength="6" placeholder="Enter Pickup OTP" data-otpfield="pickup-${tx.id}" />
                <button class="btn btn-sm btn-primary" data-verifyotp="pickup" data-txid="${tx.id}">Confirm Pickup</button>
              </div>
              <button class="btn btn-sm btn-danger" data-action="Cancel" data-txid="${tx.id}">Cancel Request</button>
            `;
          } else if (['ACTIVE', 'GRACE', 'LATE'].includes(tx.status)) {
            renterOtpHtml = `
              <div class="otp-input-row">
                <input type="text" class="form-input otp-field" inputmode="numeric" maxlength="6" placeholder="Enter Return OTP" data-otpfield="return-${tx.id}" />
                <button class="btn btn-sm btn-secondary" data-verifyotp="return" data-txid="${tx.id}">Confirm Return</button>
              </div>
            `;
          }
        }

        return `
          <div class="rental-card">
            <img class="rental-card-img" src="${itemImage(itemData.images)}" alt="${escapeHtml(itemData.title || '')}" loading="lazy" />
            <div class="rental-card-body">
              <div class="rental-card-title">${escapeHtml(itemData.title || 'Unknown Item')}</div>
              <div class="rental-card-meta">
                ${tx.durationValue} ${tx.durationType === 'HOURS' ? 'hour(s)' : 'day(s)'}
                · Total: ${formatPrice(tx.totalPaid)}
                · ${statusBadge(tx.status)}
              </div>
              ${(tx.pickupLocation || tx.returnLocation) ? `
              <div class="rental-locations">
                <span>📍 Pickup: <strong>${locationLabel(tx.pickupLocation)}</strong></span>
                <span>📦 Return: <strong>${locationLabel(tx.returnLocation)}</strong></span>
              </div>` : ''}
              <div class="rental-card-actions" id="card-actions-${tx.id}">
                ${isLender ? lenderOtpHtml : renterOtpHtml}
                ${showChat ? `<button class="btn btn-sm btn-secondary" data-chat="${tx.id}">💬 Chat</button>` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('');

      // Accept / Reject (lender)
      $list.querySelectorAll('[data-action]').forEach(btn => {
        listen(btn, 'click', async () => {
          const action = btn.dataset.action;
          const txId = btn.dataset.txid;
          const handler = ACTION_HANDLERS[action];
          if (!handler) return;
          btn.disabled = true; btn.textContent = 'Processing...';
          showLoading();
          try { await handler(txId); hideLoading(); loadTab(); }
          catch (err) { hideLoading(); showError(err.message || `Failed`); btn.disabled = false; btn.textContent = action; }
        }, signal);
      });

      // Lender: Show OTP
      $list.querySelectorAll('[data-showotp]').forEach(btn => {
        listen(btn, 'click', async () => {
          const type = btn.dataset.showotp; // 'pickup' or 'return'
          const txId = btn.dataset.txid;
          btn.disabled = true; btn.textContent = 'Loading...';
          try {
            const otpData = await api.getTransactionOtp(txId);
            const code = type === 'pickup' ? otpData.pickupOTP : otpData.returnOTP;
            const area = document.getElementById(`card-actions-${txId}`);
            const existing = area.querySelector('.otp-display');
            if (existing) existing.remove();
            const div = document.createElement('div');
            div.className = 'otp-display';
            div.innerHTML = `<span>🔑 ${type === 'pickup' ? 'Pickup' : 'Return'} OTP:</span><strong class="otp-code">${code}</strong><span style="font-size:0.75rem;opacity:0.6;">(share with renter)</span>`;
            area.insertBefore(div, area.firstChild);
            btn.disabled = false; btn.textContent = btn.textContent.includes('Pickup') ? '🔑 Show Pickup OTP' : '🔑 Show Return OTP';
          } catch (err) { hideLoading(); showError(err.message || 'Failed to get OTP'); btn.disabled = false; btn.textContent = '🔑 Show OTP'; }
        }, signal);
      });

      // Renter: Verify OTP
      $list.querySelectorAll('[data-verifyotp]').forEach(btn => {
        listen(btn, 'click', async () => {
          const type = btn.dataset.verifyotp; // 'pickup' or 'return'
          const txId = btn.dataset.txid;
          const fieldKey = `${type}-${txId}`;
          const $field = $list.querySelector(`[data-otpfield="${fieldKey}"]`);
          const otp = $field?.value?.trim();
          if (!otp || otp.length !== 6) { showError('Enter the 6-digit OTP from the lender'); return; }
          btn.disabled = true; btn.textContent = 'Verifying...';
          showLoading();
          try {
            if (type === 'pickup') { await api.collectBorrow(txId, { otp }); }
            else { await api.returnBorrow(txId, { otp }); }
            hideLoading(); loadTab();
          } catch (err) {
            hideLoading(); showError(err.message || 'Invalid OTP');
            btn.disabled = false; btn.textContent = type === 'pickup' ? 'Confirm Pickup' : 'Confirm Return';
          }
        }, signal);
      });

      // Chat buttons
      $list.querySelectorAll('[data-chat]').forEach(btn => {
        listen(btn, 'click', () => navigate(`#/chat/${btn.dataset.chat}`), signal);
      });

    } catch (err) {
      showError(err.message || 'Failed to load rentals');
      $list.innerHTML = `<div class="empty-state"><p>Failed to load data</p></div>`;
    } finally {
      hideLoading();
    }
  }

  // Tab switching
  listen($tabs, 'click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    activeTab = btn.dataset.tab;
    $tabs.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadTab();
  }, signal);

  loadTab();
}

// ─── Page: List an Item ──────────────────────────────────────

function renderListItem() {
  if (!requireAuth()) return;

  const signal = createPageController();

  $app.innerHTML = `
    <div class="page">
      <div class="list-form">
        <h1>List an Item</h1>
        <form id="list-form">
          <div class="form-group">
            <label for="item-title">Title</label>
            <input type="text" class="form-input" id="item-title" placeholder="e.g. Scientific Calculator" required />
          </div>

          <div class="form-group">
            <label for="item-desc">Description</label>
            <textarea class="form-input" id="item-desc" rows="3" placeholder="Condition, model, any notes..." required></textarea>
          </div>

          <div class="form-group">
            <label for="item-category">Category</label>
            <select class="form-input" id="item-category" required>
              ${CATEGORIES.map(c => `<option value="${c}">${c.charAt(0) + c.slice(1).toLowerCase()}</option>`).join('')}
            </select>
          </div>

          <div class="price-inputs">
            <div class="form-group">
              <label for="item-price-hour">Price / hour (₹)</label>
              <input type="number" class="form-input" id="item-price-hour" min="1" placeholder="Optional" />
            </div>
            <div class="form-group">
              <label for="item-price-day">Price / day (₹)</label>
              <input type="number" class="form-input" id="item-price-day" min="1" placeholder="Optional" />
            </div>
          </div>

          <div class="form-group" id="max-hours-group" style="display:none;">
            <label for="item-max-hours">Max hours (1–12)</label>
            <input type="number" class="form-input" id="item-max-hours" min="1" max="12" value="12" />
          </div>

          <div class="form-group">
            <label for="item-images-upload" style="display:flex; justify-content:space-between;">
              <span>Upload Image(s) <span style="opacity:0.6">(optional, max 2)</span></span>
            </label>
            <input type="file" class="form-input" id="item-images-upload" accept="image/*" multiple />
            <!-- Store loaded base64 images here -->
            <input type="hidden" id="item-images-base64" />
            <div id="item-images-preview" style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;"></div>
          </div>

          <div class="form-group" style="margin-top:16px;">
            <label class="consent-label" style="display:flex; gap:8px;">
              <input type="checkbox" id="item-legal-consent" required />
              <span style="font-size:0.85rem;line-height:1.2;">I confirm this is allowed under campus rules and not prohibited items (e.g., weapons, drugs, fake IDs, keys).</span>
            </label>
          </div>

          <button type="submit" class="btn btn-primary btn-block">List Item</button>
          <div id="list-msg" style="margin-top:12px; text-align:center; font-size:0.875rem;"></div>
        </form>
      </div>
    </div>
  `;

  const $priceHour = document.getElementById('item-price-hour');
  const $maxHoursGroup = document.getElementById('max-hours-group');

  // Show maxHours field when hourly price is entered
  listen($priceHour, 'input', () => {
    $maxHoursGroup.style.display = $priceHour.value ? 'block' : 'none';
  }, signal);

  // Handle image file selection → convert to base64 previews
  const $fileInput = document.getElementById('item-images-upload');
  const $preview = document.getElementById('item-images-preview');
  const $base64 = document.getElementById('item-images-base64');

  listen($fileInput, 'change', async () => {
    const files = Array.from($fileInput.files).slice(0, 2);
    $preview.innerHTML = '';
    
    if ($fileInput.files.length > 2) {
      showError('Only the first 2 images will be uploaded');
    }

    // Compress image via canvas (max 600px, WebP 60%)
    const compressImage = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          try {
            const MAX = 600;
            let w = img.width, h = img.height;
            if (w > MAX || h > MAX) {
              if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
              else { w = Math.round(w * MAX / h); h = MAX; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            
            // WebP 0.6 for extreme efficiency
            const dataUrl = canvas.toDataURL('image/webp', 0.6);
            
            // Size Guard: Reject if > 300KB (Base64 is ~1.33x original, so ~400k chars)
            if (dataUrl.length > 400000) {
              throw new Error(`Image "${file.name}" is too large even after compression. Try a smaller photo.`);
            }

            // Cleanup
            img.src = '';
            canvas.width = 0; canvas.height = 0;
            
            resolve(dataUrl);
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });

    try {
      showLoading();
      const base64s = await Promise.all(files.map(compressImage));
      $base64.value = JSON.stringify(base64s);

      // Show thumbnails
      base64s.forEach(src => {
        const thumb = document.createElement('img');
        thumb.src = src;
        thumb.loading = 'lazy';
        thumb.style.cssText = 'width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid #eee;';
        $preview.appendChild(thumb);
      });
    } catch (err) {
      showError(err.message || 'Image processing failed');
      $fileInput.value = ''; // Reset
      $base64.value = '';
      $preview.innerHTML = '';
    } finally {
      hideLoading();
    }
  }, signal);

  const $form = document.getElementById('list-form');
  listen($form, 'submit', async (e) => {
    e.preventDefault();
    const $msg = document.getElementById('list-msg');
    $msg.textContent = '';

    const title = document.getElementById('item-title').value.trim();
    const description = document.getElementById('item-desc').value.trim();
    const category = document.getElementById('item-category').value;
    const pricePerHour = parseFloat($priceHour.value) || undefined;
    const pricePerDay = parseFloat(document.getElementById('item-price-day').value) || undefined;
    const maxHours = pricePerHour ? (parseInt(document.getElementById('item-max-hours').value, 10) || 12) : undefined;
    const base64Raw = document.getElementById('item-images-base64').value;
    const images = base64Raw ? JSON.parse(base64Raw) : undefined;

    if (!pricePerHour && !pricePerDay) {
      showError('Please set at least one price (hourly or daily)');
      return;
    }

    const data = { title, description, category };
    if (pricePerHour) data.pricePerHour = pricePerHour;
    if (pricePerDay) data.pricePerDay = pricePerDay;
    if (maxHours) data.maxHours = maxHours;
    if (images && images.length > 0) data.images = images;

    showLoading();
    try {
      await api.createItem(data);
      hideLoading();
      $app.innerHTML = `
        <div class="page empty-state">
          <p>✓ Your item has been listed!</p>
          <a href="#/browse" class="btn btn-secondary" style="margin-top:12px;">Browse Items</a>
        </div>
      `;
    } catch (err) {
      hideLoading();
      $msg.textContent = err.message || 'Failed to list item';
      $msg.style.color = 'var(--color-danger)';
    }
  }, signal);
}

// ─── Page: Terms & Conditions ────────────────────────────────

function renderTerms() {
  $app.innerHTML = `
    <div class="page legal-page">
      <h1>Terms & Conditions</h1>

      <p>LendIT is a platform that enables students to lend and borrow items within their campus community.</p>

      <p>LendIT does not own, inspect, or guarantee the quality, safety, or legality of listed items. All rentals are agreements solely between the lender and the renter.</p>

      <p>Renters are charged a 10% platform service fee. Lenders are charged a 5% platform service fee, deducted from their payout.</p>

      <p>Wallet balances represent digital credits usable only within LendIT. A minimum wallet balance of ₹100 may be required. Withdrawals and payouts are subject to processing times.</p>

      <p>LendIT is not responsible for item damage, loss, or disputes. Users agree to resolve such issues directly.</p>

      <p>LendIT reserves the right to suspend or terminate accounts for misuse, abuse, or policy violations.</p>
    </div>
    ${footerHtml()}
  `;
}

// ─── Page: Privacy Policy ────────────────────────────────────

function renderPrivacy() {
  $app.innerHTML = `
    <div class="page legal-page">
      <h1>Privacy Policy</h1>

      <p>LendIT collects basic account information such as name, email, college, and transaction history to operate the platform.</p>

      <p>Authentication uses secure, HTTP-only cookies.</p>

      <p>LendIT does not sell or share personal data with third parties.</p>

      <p>Cookies are used strictly for authentication and session management.</p>
    </div>
    ${footerHtml()}
  `;
}

// ─── Page: Conversations List ────────────────────────────────

async function renderChatList() {
  if (!requireAuth()) return;
  const signal = createPageController();

  // Clear unread when visiting chats page
  state.unreadChats = 0;
  updateChatBadges();

  $app.innerHTML = `
    <div class="page">
      <h1 style="font-size:1.25rem; font-weight:700; margin-bottom:20px;">💬 Chats</h1>
      <div id="chat-list-container">
        <div class="empty-state"><p>Loading conversations...</p></div>
      </div>
    </div>
    ${footerHtml()}
  `;

  const $container = document.getElementById('chat-list-container');
  const CHAT_STATUSES = ['ACCEPTED', 'PAID', 'ACTIVE', 'GRACE', 'LATE'];

  try {
    showLoading();
    const [rentals, lendings] = await Promise.all([
      api.myRentals(),
      api.myLendings(),
    ]);

    const rentalItems = (Array.isArray(rentals) ? rentals : rentals.data || [])
      .filter(tx => CHAT_STATUSES.includes(tx.status))
      .map(tx => ({ ...tx, _role: 'renter' }));

    const lendingItems = (Array.isArray(lendings) ? lendings : lendings.data || [])
      .filter(tx => CHAT_STATUSES.includes(tx.status))
      .map(tx => ({ ...tx, _role: 'lender' }));

    // Sort by urgency: ACTIVE > PAID > ACCEPTED > GRACE/LATE
    const STATUS_PRIORITY = { ACTIVE: 0, PAID: 1, ACCEPTED: 2, GRACE: 3, LATE: 4 };
    const conversations = [...rentalItems, ...lendingItems]
      .sort((a, b) => {
        const pa = STATUS_PRIORITY[a.status] ?? 99;
        const pb = STATUS_PRIORITY[b.status] ?? 99;
        if (pa !== pb) return pa - pb;
        return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
      });

    if (conversations.length === 0) {
      $container.innerHTML = `
        <div class="empty-state">
          <p>No active conversations</p>
          <p style="font-size:0.85rem; color:var(--color-text-muted); margin-top:8px;">
            Chats appear when you have an active rental.
            <a href="#/browse" style="color:var(--color-purple);">Browse items →</a>
          </p>
        </div>
      `;
      return;
    }

    $container.innerHTML = `
      <div class="chat-list">
        ${conversations.map(tx => {
          const item = tx.item || {};
          const otherName = tx._role === 'renter'
            ? (item.owner?.name || tx.lender?.name || 'Lender')
            : (tx.renter?.name || 'Renter');
          const initial = (otherName.charAt(0) || '?').toUpperCase();
          const timeAgo = formatTimeAgo(tx.updatedAt || tx.createdAt);

          return `
            <div class="chat-list-item" data-txid="${tx.id}">
              <div class="chat-list-avatar">${initial}</div>
              <div class="chat-list-content">
                <div class="chat-list-name">${escapeHtml(otherName)}</div>
                <div class="chat-list-sub">${escapeHtml(item.title || 'Item')} · ${statusBadge(tx.status)}</div>
              </div>
              <div class="chat-list-meta">
                <div class="chat-list-time">${timeAgo}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Click handlers
    $container.querySelectorAll('.chat-list-item[data-txid]').forEach(el => {
      listen(el, 'click', () => navigate(`#/chat/${el.dataset.txid}`), signal);
    });

  } catch (err) {
    showError(err.message || 'Failed to load conversations');
    $container.innerHTML = `<div class="empty-state"><p>Failed to load conversations</p></div>`;
  } finally {
    hideLoading();
  }
}

/** Format a date into a relative time string */
function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ─── Page: Checkout (Standard Flow) ──────────────────────────

async function renderCheckout(transactionId) {
  if (!requireAuth()) return;
  const signal = createPageController();

  $app.innerHTML = `
    <div class="page">
      <div id="checkout-container" style="min-height:400px;">
        <div class="checkout-shimmer-wrapper" style="text-align:left; max-width:500px; margin:0 auto; padding:20px;">
           <div style="height:32px; width:60%; background:var(--color-surface); border-radius:8px; margin-bottom:32px; animation: pulse 1.5s infinite ease-in-out;"></div>
           <div style="height:44px; width:140px; background:var(--color-surface); border-radius:8px; margin-bottom:20px; animation: pulse 1.5s infinite ease-in-out;"></div>
           <div style="height:124px; background:var(--color-surface); border-radius:16px; margin-bottom:24px; animation: pulse 1.5s infinite ease-in-out;"></div>
           <div style="height:254px; background:var(--color-surface); border-radius:16px; margin-bottom:32px; animation: pulse 1.5s infinite ease-in-out;"></div>
           <div style="height:60px; background:var(--color-surface); border-radius:16px; animation: pulse 1.5s infinite ease-in-out;"></div>
           <p style="text-align:center; margin-top:24px; color:var(--color-text-muted); font-weight:500;">Loading order summary...</p>
        </div>
      </div>
    </div>
    <style>
      @keyframes pulse { 0% { opacity: 0.6; } 50% { opacity: 1; } 100% { opacity: 0.6; } }
    </style>
    ${footerHtml()}
  `;

  const $container = document.getElementById('checkout-container');

  try {
    // 1. Fetch & Lock Intent
    let tx;
    try {
      tx = await api.initiateCheckout(transactionId);
    } catch (err) {
      console.error('Checkout initiation failed:', err);
      // Recovery Flow: If stale/not initiated, redirect with a clear message
      if (err.message?.includes('Checkout not initiated') || err.message?.includes('expired')) {
        showError('Payment session expired or invalid. Please try again.');
      } else {
        showError(err.message || 'Failed to initiate checkout');
      }
      navigate('#/rentals');
      return;
    }

    if (tx.status !== 'PAYMENT_PENDING' && tx.status !== 'PAID') {
      window.location.hash = `#/chat/${tx.id}`;
      return;
    }

    const item = tx.item || {};
    const startTime = new Date(tx.requestedStartTime).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const endTime = new Date(tx.requestedEndTime).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    // Activity Signal
    const lender = tx.lender || {};
    const lastSeen = lender.lastSeenAt ? new Date(lender.lastSeenAt) : null;
    const isRecent = lastSeen && (new Date() - lastSeen < 10 * 60 * 1000);
    const activityHtml = isRecent 
      ? `<div style="color:#16a34a; font-size:0.85rem; font-weight:600; display:flex; align-items:center; gap:6px; margin-bottom:20px; background:#f0fdf4; padding:8px 12px; border-radius:8px; width:fit-content;">
           <span style="height:8px; width:8px; background:#16a34a; border-radius:50%; display:inline-block; animation: pulse 1s infinite alternate;"></span>
           🟢 Active recently
         </div>`
      : `<div style="color:var(--color-text-muted); font-size:0.85rem; font-weight:500; display:flex; align-items:center; gap:6px; margin-bottom:20px; background:var(--color-surface); padding:8px 12px; border-radius:8px; width:fit-content;">
           <span style="height:8px; width:8px; background:#94a3b8; border-radius:50%; display:inline-block;"></span>
           ⏱ Response time may vary
         </div>`;

    $container.innerHTML = `
      <div class="checkout-page" style="text-align:left; max-width:500px; margin:0 auto; padding:20px;">
        <h1 style="font-size:1.5rem; font-weight:800; margin-bottom:24px;">📦 Order Summary</h1>
        
        ${activityHtml}

        <div id="checkout-urgency" style="font-size:0.85rem; color:var(--color-warning); font-weight:700; text-align:center; margin-bottom:24px; background:#fffbeb; padding:12px; border-radius:12px; border:1px solid #fef3c7;">
          <div style="margin-bottom:4px; opacity:0.8; font-size:0.75rem; text-transform:uppercase; letter-spacing:0.04em;">⚡ Booking reserved</div>
          <div id="countdown-timer" style="font-size:1.25rem; font-weight:900; font-variant-numeric: tabular-nums;">10:00</div>
        </div>

        <div style="background:var(--color-surface); padding:20px; border-radius:16px; margin-bottom:24px; border:1px solid var(--color-border);">
          <div style="font-weight:700; font-size:1.1rem; margin-bottom:12px;">${escapeHtml(item.title)}</div>
          <div style="font-size:0.9rem; color:var(--color-text-muted); display:flex; flex-direction:column; gap:6px;">
            <span>📅 Pickup: <strong>${startTime}</strong></span>
            <span>📦 Return: <strong>${endTime}</strong></span>
            <span>📍 Location: <strong>${locationLabel(tx.pickupLocation)}</strong></span>
          </div>
        </div>

        <div style="background:#fff; padding:20px; border-radius:16px; border:1.5px solid var(--color-border); margin-bottom:24px;">
           <div style="font-size:1.15rem; font-weight:800; margin-bottom:16px;">💰 Price Breakdown</div>

            <div style="display:flex; justify-content:space-between; padding:8px 0; font-size:0.95rem;">
              <span style="color:var(--color-text-muted);">Item Price</span>
              <span style="font-weight:600;">${formatPrice(tx.rentAmount)}</span>
            </div>

            <div style="display:flex; justify-content:space-between; padding:8px 0; font-size:0.95rem;">
              <span style="color:var(--color-text-muted);">Platform Fee</span>
              <span style="font-weight:600;">${formatPrice(tx.platformFee || tx.renterFee || 0)}</span>
            </div>

            <div style="font-size:0.75rem; color:var(--color-text-muted); margin:4px 0 12px; font-style:italic;">
               * Platform fee helps with safety, support, and dispute handling.
            </div>

            <div style="border-top:1.5px dashed var(--color-border); margin:12px 0;"></div>

            <div style="display:flex; justify-content:space-between; padding:10px 0; font-size:1.25rem; font-weight:900; color:var(--color-primary);">
              <span>Total amount</span>
              <span>${formatPrice(tx.totalPaid)}</span>
            </div>
        </div>

        <div class="checkout-footer" style="padding-top:20px;">
          <div style="font-size:0.8rem; color:var(--color-primary); font-weight:700; margin-bottom:16px; background:#f5f3ff; padding:10px; border-radius:10px; display:inline-block;">
             🛡️ Transparent pricing — total shown is what you pay
          </div>
          <button id="confirm-pay" class="btn btn-primary" style="width:100%; min-height:60px; font-size:1.2rem; font-weight:800; border-radius:16px; box-shadow:0 6px 20px rgba(109,40,217,0.3); transition: background 0.3s ease;">💳 Confirm & Pay</button>
          <div style="font-size:0.75rem; color:var(--color-text-muted); margin-top:12px; display:flex; align-items:center; justify-content:center; gap:4px;">
            <span style="font-size:1rem;">🔒</span> ₹${tx.totalPaid} reserved until payment completes
          </div>
        </div>
        
        <script>
          // Note: This script block is a conceptual aid, actual logic is handled by the render function below
        </script>
    `;

    const $btnPay = document.getElementById('confirm-pay');
    const $timerDisplay = document.getElementById('countdown-timer');

    function updateTimer() {
      const remainingMs = new Date(tx.expiresAt) - Date.now();
      
      if (remainingMs <= 0) {
        $btnPay.disabled = false;
        $btnPay.style.opacity = '1';
        $btnPay.style.background = 'var(--color-text-main)';
        $btnPay.innerHTML = '🔄 Session expired — Rebook';
        $btnPay.onclick = () => {
          // Persist selection for Rebook friction reduction
          sessionStorage.setItem('lendit_rebook_payload', JSON.stringify({
            pickupDate: tx.requestedStartTime,
            returnDate: tx.requestedEndTime,
            originalTxId: tx.id
          }));
          window.location.hash = `#/item/${tx.itemId || tx.item?.id}`;
        };
        if ($timerDisplay) $timerDisplay.textContent = '00:00';
        clearInterval(timerInterval);
        return;
      }

      // Lockout at 5 seconds to prevent "I clicked but it failed" race conditions
      if (remainingMs < 5000) {
        $btnPay.disabled = true;
        $btnPay.style.opacity = '0.7';
        $btnPay.innerHTML = '⏳ Expiring... please rebook';
      }

      const mins = Math.floor(remainingMs / 60000);
      const secs = Math.floor((remainingMs % 60000) / 1000);
      const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      
      // Update timer display with color logic
      if ($timerDisplay) {
        $timerDisplay.textContent = timeStr;
        const urgencyBox = document.getElementById('checkout-urgency');
        if (remainingMs < 10000) {
            $timerDisplay.style.color = '#ef4444'; // red
            if (urgencyBox) urgencyBox.style.borderColor = '#fecaca';
        } else if (remainingMs < 60000) {
            $timerDisplay.style.color = '#f59e0b'; // amber
            if (urgencyBox) urgencyBox.style.borderColor = '#fde68a';
        } else {
            $timerDisplay.style.color = 'inherit';
        }
      }
      
      // Update button with inline timer
      if (!$btnPay.disabled && !$btnPay.innerHTML.includes('Processing')) {
        $btnPay.innerHTML = `💳 Confirm & Pay (${timeStr})`;
      }
    }

    const timerInterval = setInterval(updateTimer, 1000);
    updateTimer();
    
    // Recovery Logic: Handle mobile suspension / background tabs
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        updateTimer(); // Force resync immediately on resume
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    signal.addEventListener('abort', () => {
      clearInterval(timerInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
    });

    // ── Status poll: detect external state changes (expiry worker, lender cancel) ──
    const statusPoll = setInterval(async () => {
      try {
        const fresh = await api.getTransaction(tx.id);
        if (fresh.status === 'CANCELLED') {
          clearInterval(statusPoll);
          clearInterval(timerInterval);
          $btnPay.disabled = false;
          $btnPay.dataset.loading = '0';
          $btnPay.style.opacity = '1';
          $btnPay.style.background = 'var(--color-text-main)';
          $btnPay.innerHTML = '🔄 Session expired — Rebook';
          $btnPay.onclick = () => {
            window.location.hash = `#/item/${tx.itemId || tx.item?.id}`;
          };
          if ($timerDisplay) $timerDisplay.textContent = '00:00';
          showError('This checkout was cancelled. Please rebook.');
        } else if (fresh.paymentStatus === 'PAID') {
          clearInterval(statusPoll);
          clearInterval(timerInterval);
          showToast('Payment Successful! 🎉', 'Redirecting to chat...', 'success');
          window.location.hash = `#/chat/${tx.id}`;
        }
      } catch { /* network hiccup — retry next tick */ }
    }, 5000);
    signal.addEventListener('abort', () => clearInterval(statusPoll));

    $container.innerHTML += `
        <p style="text-align:center; font-size:0.85rem; color:var(--color-text-muted); margin:24px 0 32px;">
          Money remains in secure escrow until you collect the item.
        </p>
      </div>
    `;

    // Handle Sticky Footer for mobile
    if (window.innerWidth < 640) {
      const $footer = document.querySelector('.checkout-footer');
      if ($footer) {
        $footer.style.position = 'fixed';
        $footer.style.bottom = '0';
        $footer.style.left = '0';
        $footer.style.right = '0';
        $footer.style.background = '#fff';
        $footer.style.padding = '16px 20px calc(16px + env(safe-area-inset-bottom))';
        $footer.style.borderTop = '1px solid var(--color-border)';
        $footer.style.boxShadow = '0 -4px 20px rgba(0,0,0,0.08)';
        $footer.style.zIndex = '100';
        document.body.style.paddingBottom = '120px';
        signal.addEventListener('abort', () => { document.body.style.paddingBottom = '0'; });
      }
    }

    listen($btnPay, 'click', async () => {
        if ($btnPay.innerHTML.includes('Rebook')) return; // handled by onclick
        if ($btnPay.dataset.loading === '1') return; // double-click guard
        $btnPay.dataset.loading = '1';
        try {
            $btnPay.disabled = true;
            $btnPay.innerHTML = '⏳ Processing...';
            await api.processPayment(tx.id);
            showToast('Payment Successful! 🎉', 'Your rental is now active. You can chat with the lender.', 'success');
            window.location.hash = `#/chat/${tx.id}`;
        } catch (e) {
            $btnPay.dataset.loading = '0';
            $btnPay.disabled = false;
            updateTimer(); // Restore timer state
            showError(e.message || 'Payment failed. Please try again or rebook.');
        }
    }, signal);

  } catch (err) {
    hideLoading();
    $container.innerHTML = `<div class="empty-state"><p>Error loading checkout. Please try again.</p><a href="#/rentals" class="btn btn-secondary">My Rentals</a></div>`;
  }
}

// ─── Page: Chat ──────────────────────────────────────────────

function renderChat(transactionId) {
  if (!requireAuth()) return;
  if (!transactionId) { navigate('#/rentals'); return; }

  const signal = createPageController();
  let socket = null;
  let txData = null; // cached transaction

  $app.innerHTML = `
    <div class="page" style="display:flex;flex-direction:column;height:calc(100vh - 80px);">
      <div class="chat-header-improved" id="chat-header">
        <a href="#/chats" class="chat-back">←</a>
        <div class="chat-header-avatar" id="chat-avatar">?</div>
        <div class="chat-header-info">
          <div class="chat-header-name" id="chat-peer-name">Loading...</div>
          <div class="chat-header-item" id="chat-item-name"></div>
        </div>
      </div>
      <div id="chat-action-bar"></div>
      <div class="chat-window" id="chat-window" style="flex:1;">
        <div class="chat-loading">Connecting...</div>
      </div>
      <div id="quick-replies"></div>
      <div class="chat-input-bar">
        <input type="text" id="chat-input" class="form-input" placeholder="Type a message..." maxlength="2000" />
        <button class="btn btn-primary" id="chat-send">Send</button>
      </div>
    </div>
  `;

  const $window = document.getElementById('chat-window');
  const $input = document.getElementById('chat-input');
  const $send = document.getElementById('chat-send');
  const $actionBar = document.getElementById('chat-action-bar');

  // ─── Transaction action bar ──────────────────────────────────
  function renderActionBar(tx) {
    const isRenter = tx.renterId === state.user?.id;
    const isLender = tx.lenderId === state.user?.id;
    const { status, escrowHeld, totalPaid, pickupLocation, returnLocation } = tx;

    let actionHtml = '';

    if (isRenter && status === 'ACCEPTED') {
      actionHtml = `
        <div class="chat-action-row" style="flex-direction:column; padding:20px 16px;">
          <!-- Checkout card -->
          <div style="background:#fff; border-radius:16px; padding:20px; box-shadow:0 1px 4px rgba(0,0,0,0.06); width:100%;">
            <div style="font-size:1.15rem; font-weight:800; margin-bottom:20px;">💰 Price Breakdown</div>

            <!-- Surfaced Info -->
            <div style="margin-bottom:16px; padding:12px; background:var(--color-surface); border-radius:10px; font-size:0.85rem; border:1px solid var(--color-border);">
               <div style="margin-bottom:8px; display:flex; align-items:center; gap:6px;">
                  <span style="height:6px; width:6px; background:${(tx.lender?.lastSeenAt && (new Date() - new Date(tx.lender.lastSeenAt) < 600000)) ? '#16a34a' : '#94a3b8'}; border-radius:50%;"></span>
                  <span style="font-weight:600;">${(tx.lender?.lastSeenAt && (new Date() - new Date(tx.lender.lastSeenAt) < 600000)) ? 'Active recently' : 'Response time may vary'}</span>
               </div>
               <div style="margin-bottom:4px;">📍 Pickup: <strong>${locationLabel(pickupLocation)}</strong></div>
               <div>⏱ Status: <strong style="color:var(--color-primary);">${status}</strong></div>
            </div>

            <!-- Row: Item Price -->
            <div style="display:flex; justify-content:space-between; padding:10px 0; font-size:0.95rem;">
              <span style="color:var(--color-text-muted);">Item Price</span>
              <span style="font-weight:600;">${formatPrice(tx.rentAmount)}</span>
            </div>

            <!-- Row: Platform fee -->
            <div style="display:flex; justify-content:space-between; padding:10px 0; font-size:0.95rem;">
              <span style="color:var(--color-text-muted);">Platform Fee</span>
              <span style="font-weight:600;">${formatPrice(tx.platformFee || tx.renterFee || 0)}</span>
            </div>

            <div style="font-size:0.75rem; color:var(--color-text-muted); margin:4px 0 8px; font-style:italic;">
               * Platform fee helps with safety, support, and dispute handling.
            </div>

            <!-- Divider -->
            <div style="border-top:1.5px dashed var(--color-border); margin:12px 0;"></div>

            <!-- Row: Total -->
            <div style="display:flex; justify-content:space-between; padding:10px 0; font-size:1.2rem; font-weight:900; color:var(--color-text-main);">
              <span>Total amount</span>
              <span>${formatPrice(totalPaid)}</span>
            </div>

            <div style="font-size:0.8rem; color:var(--color-text-muted); text-align:center; margin-top:10px;">⏳ Safe checkout with escrow</div>
          </div>

          <!-- Green Pay CTA -->
          <button
            id="btn-pay-chat"
            style="
              display:block; width:100%; min-height:52px;
              background:var(--color-cta); color:#fff;
              font-size:1.1rem; font-weight:700;
              border:none; border-radius:14px;
              padding:16px 24px; cursor:pointer;
              box-shadow:0 4px 16px rgba(34,197,94,0.3);
              margin-top:16px;
              transition:background 0.15s;
            "
            onmouseover="this.style.background='var(--color-cta-hover)'"
            onmouseout="this.style.background='var(--color-cta)'"
          >Pay</button>
        </div>`;

    } else if (isRenter && status === 'PAID') {
      actionHtml = `
        <div class="chat-action-row">
          <div class="chat-action-label">✅ Payment done! Get the 6-digit Pickup OTP from the Lender.</div>
          <button class="btn btn-secondary" id="btn-collect-chat">📦 Enter Pickup OTP</button>
        </div>`;
    } else if (isRenter && (status === 'ACTIVE' || status === 'GRACE')) {
      actionHtml = `
        <div class="chat-action-row">
          <div class="chat-action-label">⏱ Item is with you. Get the 6-digit Return OTP from the Lender when returning.</div>
          <button class="btn btn-secondary" id="btn-return-chat">✅ Enter Return OTP</button>
        </div>`;
    } else if (isLender && status === 'PAID') {
      actionHtml = `
        <div class="chat-action-row">
          <div>
            <div class="chat-action-label">✅ Paid! Share this Pickup OTP with the renter:</div>
            <div style="font-size:24px; font-weight:bold; letter-spacing:4px; margin-top:8px;">${tx.otp?.pickupOTP || '------'}</div>
          </div>
        </div>`;
    } else if (isLender && (status === 'ACTIVE' || status === 'GRACE')) {
      actionHtml = `
        <div class="chat-action-row">
          <div>
            <div class="chat-action-label">⏱ Item is rented out. Share this Return OTP when they give it back:</div>
            <div style="font-size:24px; font-weight:bold; letter-spacing:4px; margin-top:8px;">${tx.otp?.returnOTP || '------'}</div>
          </div>
        </div>`;
    } else if (status === 'RETURNED') {
      actionHtml = `<div class="chat-action-row"><div class="chat-action-label">✅ Rental complete. Lender has been paid.</div></div>`;
    } else if (status === 'ACTIVE') {
      actionHtml = `<div class="chat-action-row"><div class="chat-action-label">⏱ Item is out on rental.</div></div>`;
    }

    const locHtml = (pickupLocation || returnLocation) ? `
      <div class="chat-locations">
        📍 Pickup: <strong>${locationLabel(pickupLocation)}</strong>
        &nbsp;·&nbsp;
        📦 Return: <strong>${locationLabel(returnLocation)}</strong>
      </div>` : '';

    $actionBar.innerHTML = `<div class="chat-action-bar">${locHtml}${actionHtml}</div>`;

    // Input Locking and Banners based on Status
    const isLocked = status === 'REQUESTED' || status === 'ACCEPTED';
    if (isLocked) {
      $input.disabled = true;
      $input.style.display = 'none';
      $send.style.display = 'none';

      // Show predefined quick-ask buttons ONLY to the renter
      if (isRenter) {
        const predefinedHtml = `
          <div style="padding:12px 8px 4px; display:flex; flex-direction:column; gap:10px; width:100%;">
            <button
              class="btn predefined-btn"
              data-msg="Is this available?"
              style="width:100%; padding:14px; font-size:0.95rem; font-weight:500; border-radius:24px; border:1.5px solid var(--color-purple-light); background:#fff; color:var(--color-text); cursor:pointer; transition:border-color 0.15s;"
            >Is this available?</button>
            <button
              class="btn predefined-btn"
              data-msg="Where is pickup?"
              style="width:100%; padding:14px; font-size:0.95rem; font-weight:500; border-radius:24px; border:1.5px solid var(--color-purple-light); background:#fff; color:var(--color-text); cursor:pointer; transition:border-color 0.15s;"
            >Where is pickup?</button>
            <div style="text-align:center; font-size:0.85rem; color:var(--color-text-muted); padding-top:4px;">
              🔒 Pay to unlock chat and get details instantly
            </div>
          </div>
        `;
        const inputBar = document.querySelector('.chat-input-bar');
        if (inputBar) {
          inputBar.innerHTML = predefinedHtml;
          inputBar.style.flexDirection = 'column';
          inputBar.querySelectorAll('.predefined-btn').forEach(btn => {
            listen(btn, 'click', () => {
              const tempMsg = {
                id: 'temp-' + Date.now(),
                content: btn.dataset.msg,
                sender: { id: state.user.id, name: state.user.name },
                senderId: state.user.id,
                createdAt: new Date().toISOString()
              };
              appendMessage(tempMsg, true);
              socket.emit('send-message', { transactionId, content: btn.dataset.msg }, (response) => {
                if (response && response.error) showError(response.error);
              });
            }, signal);
          });
        }
      } else {
        // Lender sees a waiting message instead of quick-ask buttons
        const inputBar = document.querySelector('.chat-input-bar');
        if (inputBar) {
          inputBar.innerHTML = `
            <div style="padding:16px; text-align:center; color:var(--color-text-muted); font-size:0.9rem; font-weight:500;">
              ⏳ Waiting for renter to complete payment
            </div>
          `;
          inputBar.style.flexDirection = 'column';
        }
      }
    } else {
      $input.disabled = false;
      $input.placeholder = "Type a message...";
      $send.disabled = false;

      if (!document.getElementById('chat-warning-banner')) {
        const banner = document.createElement('div');
        banner.id = 'chat-warning-banner';
        banner.style = "background:#fef3c7; color:#92400e; text-align:center; padding:10px 12px; font-size:0.8rem; font-weight:600; border-bottom:1px solid #fde68a;";
        banner.textContent = "⚠️ Outside payments = NO support";

        // Insert right above the chat window
        $window.parentNode.insertBefore(banner, $window);
      }
    }

    // Bind action buttons
    const $pay = document.getElementById('btn-pay-chat');
    if ($pay) {
      listen($pay, 'click', () => {
        // Always redirect to the proper checkout flow — never call payBorrow directly from chat
        window.location.hash = `#/checkout/${transactionId}`;
      }, signal);
    }

    const $collect = document.getElementById('btn-collect-chat');
    if ($collect) {
      listen($collect, 'click', async () => {
        const otp = prompt("Enter the 6-digit Pickup OTP from the Lender:");
        if (!otp) return;
        $collect.disabled = true; $collect.textContent = 'Processing...';
        showLoading();
        try {
          await api.collectBorrow(transactionId, { otp });
          hideLoading();
          txData = await api.getTransaction(transactionId);
          renderActionBar(txData);
        } catch (err) {
          hideLoading();
          $collect.disabled = false; $collect.textContent = '📦 Enter Pickup OTP';
          showError(err.message || 'Failed');
        }
      }, signal);
    }

    const $return = document.getElementById('btn-return-chat');
    if ($return) {
      listen($return, 'click', async () => {
        const otp = prompt("Enter the 6-digit Return OTP from the Lender:");
        if (!otp) return;
        $return.disabled = true; $return.textContent = 'Processing...';
        showLoading();
        try {
          await api.returnBorrow(transactionId, { otp });
          hideLoading();
          txData = await api.getTransaction(transactionId);
          renderActionBar(txData);
        } catch (err) {
          hideLoading();
          $return.disabled = false; $return.textContent = '✅ Enter Return OTP';
          showError(err.message || 'Failed');
        }
      }, signal);
    }
  }

  // ─── Messages ────────────────────────────────────────────────
  function isMyMessage(msg) {
    // Use txData ids for reliable own-message detection (works on mobile via ngrok)
    const myId = state.user?.id;
    if (!myId) return false;
    const senderId = msg.sender?.id || msg.senderId;
    return senderId === myId;
  }

  function appendMessage(msg, optimistic = false) {
    const isMine = isMyMessage(msg);
    const name = escapeHtml(msg.sender?.name || 'You');
    const content = escapeHtml(msg.content);
    const time = new Date(msg.sentAt || msg.createdAt || Date.now()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const div = document.createElement('div');
    div.className = `chat-bubble ${isMine ? 'mine' : 'theirs'}${optimistic ? ' optimistic-bubble' : ''}`;
    div.innerHTML = `
      <div class="bubble-name">${isMine ? 'You' : name}</div>
      <div class="bubble-text">${content}</div>
      <div class="bubble-time">${time}${optimistic ? ' ⏳' : (isMine ? ' ✓' : '')}</div>
    `;
    $window.appendChild(div);
    $window.scrollTop = $window.scrollHeight;

    // Browser notification for incoming messages when tab is hidden
    if (!isMine && document.hidden && Notification.permission === 'granted') {
      new Notification('LendIT — New message', {
        body: `${name}: ${msg.content.slice(0, 80)}`,
        icon: '/assets/LendIT-trans.png',
      });
    }
  }

  // ─── Socket ──────────────────────────────────────────────────
  function connect() {
    // Use relative path — works on localhost, LAN, and ngrok.
    // Force websocket because ngrok intercepts polling requests with a warning screen on Apple devices.
    socket = io(`${BACKEND_URL}/chat`, {
      withCredentials: true,
      transports: ['polling', 'websocket'],
      extraHeaders: {
        'ngrok-skip-browser-warning': 'true'
      }
    });

    socket.on('connect', () => {
      $window.innerHTML = '';
      socket.emit('join-chat', { transactionId });
    });

    socket.on('chat-history', ({ messages }) => {
      $window.innerHTML = '';
      if (messages.length === 0) {
        $window.innerHTML = '<div class="chat-empty">No messages yet. Say hello!</div>';
      } else {
        messages.forEach(msg => appendMessage(msg));
      }
    });

    socket.on('new-message', (msg) => {
      // Remove optimistic bubble(s) for this message if it came from us (dedup)
      if (isMyMessage(msg)) {
        const optimistics = $window.querySelectorAll('.optimistic-bubble');
        optimistics.forEach(opt => opt.remove());
      }
      const empty = $window.querySelector('.chat-empty');
      if (empty) empty.remove();
      appendMessage(msg);
    });

    socket.on('exception', (err) => { showError(err.message || 'Chat error'); });
    socket.on('disconnect', () => {
      $window.innerHTML += '<div class="chat-disconnected">Disconnected. Refresh to reconnect.</div>';
    });
    socket.on('connect_error', (err) => {
      $window.innerHTML = `<div class="chat-empty">Could not connect to chat. ${err.message || 'Please check your connection.'}</div>`;
    });
  }

  function sendMessage() {
    const content = $input.value.trim();
    if (!content || !socket?.connected) return;

    // Build optimistic message for immediate feedback
    const tempMsg = {
      id: 'temp-' + Date.now(),
      content: content,
      sender: { id: state.user.id, name: state.user.name },
      senderId: state.user.id,
      createdAt: new Date().toISOString()
    };

    // Remove empty state if present
    const empty = $window.querySelector('.chat-empty');
    if (empty) empty.remove();

    appendMessage(tempMsg, true); // Pass true for optimistic rendering
    $input.value = '';

    socket.emit('send-message', { transactionId, content }, (response) => {
      if (response && response.error) {
        showError(response.error);
      }
    });
  }

  listen($send, 'click', sendMessage, signal);
  listen($input, 'keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }, signal);

  signal.addEventListener('abort', () => socket?.disconnect());

  // ─── Boot: load transaction then connect ─────────────────────
  (async () => {
    // Request notification permission (silently)
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }

    try {
      txData = await api.getTransaction(transactionId);
      renderActionBar(txData);

      // Populate improved chat header
      const isRenter = txData.renterId === state.user?.id;
      const peerName = isRenter
        ? (txData.item?.owner?.name || txData.lender?.name || 'Lender')
        : (txData.renter?.name || 'Renter');
      const itemTitle = txData.item?.title || 'Item';
      const initial = (peerName.charAt(0) || '?').toUpperCase();

      const $avatar = document.getElementById('chat-avatar');
      const $peerName = document.getElementById('chat-peer-name');
      const $itemName = document.getElementById('chat-item-name');
      if ($avatar) $avatar.textContent = initial;
      if ($peerName) $peerName.textContent = peerName;
      if ($itemName) $itemName.textContent = itemTitle + ' · ' + txData.status;

      // Quick reply chips — ONLY BEFORE payment (ACCEPTED status)
      // Goal: reduce friction before user pays, not after
      const $quickReplies = document.getElementById('quick-replies');
      if ($quickReplies && txData.status === 'ACCEPTED' && isRenter) {
        const chips = ['Is this still available?', 'Where is pickup?', 'When can I collect?'];
        $quickReplies.innerHTML = `
          <div style="font-size:0.75rem; color:var(--color-text-muted); padding:6px 0 2px; font-weight:500; letter-spacing:0.01em;">Ask before paying:</div>
          <div class="quick-reply-bar">
            ${chips.map(text => `<button class="quick-reply-chip" data-msg="${text}">${text}</button>`).join('')}
          </div>
        `;
        $quickReplies.querySelectorAll('.quick-reply-chip').forEach(chip => {
          listen(chip, 'click', () => {
            $input.value = chip.dataset.msg;
            sendMessage();
          }, signal);
        });
      }
    } catch {
      $actionBar.innerHTML = ''; // Can't load tx — maybe not a party
    }
    connect();

    // ── Status poll: sync UI with external state changes ──
    const TERMINAL = ['RETURNED', 'CANCELLED', 'REJECTED'];
    const chatStatusPoll = setInterval(async () => {
      try {
        const fresh = await api.getTransaction(transactionId);
        if (!txData || fresh.status !== txData.status || fresh.paymentStatus !== txData.paymentStatus) {
          txData = fresh;
          renderActionBar(txData);
          const $itemName = document.getElementById('chat-item-name');
          if ($itemName) $itemName.textContent = (txData.item?.title || 'Item') + ' · ' + txData.status;
        }
        if (TERMINAL.includes(fresh.status)) {
          clearInterval(chatStatusPoll);
        }
      } catch { /* retry next tick */ }
    }, 5000);
    signal.addEventListener('abort', () => clearInterval(chatStatusPoll));
  })();
}

// ─── Background: Poll for Accepted Requests ──────────────────
// Shows a browser notification when a REQUESTED borrow becomes ACCEPTED

let _pollStatuses = null;
async function startAcceptedPoll() {
  if (!state.user) return;
  try {
    const rentals = await api.myRentals();
    const items = Array.isArray(rentals) ? rentals : (rentals.data || []);
    const statuses = {};
    items.forEach(tx => { statuses[tx.id] = tx.status; });

    if (_pollStatuses) {
      // Check for REQUESTED → ACCEPTED transitions
      items.forEach(tx => {
        if (_pollStatuses[tx.id] === 'REQUESTED' && tx.status === 'ACCEPTED') {
          if (Notification.permission === 'granted') {
            new Notification('LendIT — Request Accepted! 🎉', {
              body: `Your request for "${tx.item?.title || 'an item'}" was accepted. Open the app to pay.`,
              icon: '/assets/LendIT-trans.png',
            });
          }
        }
      });
    }
    _pollStatuses = statuses;
  } catch { /* ignore */ }
}

// ─── Utilities ───────────────────────────────────────────────

/** Escape HTML to prevent XSS */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Reporting Handlers (Global) ─────────────────────────────

window.reportItem = async function (itemId) {
  const reason = prompt('Please describe why you are reporting this item:');
  if (!reason) return;
  try {
    showLoading();
    await api.createReport({ reportedId: itemId, type: 'ITEM', reason });
    hideLoading();
    showToast('Report Submitted', 'Your report has been received and will be reviewed by admin.', '');
  } catch (e) {
    hideLoading();
    showError('Failed to report item');
  }
};

window.reportUser = async function (userId) {
  const reason = prompt('Please describe why you are reporting this user:');
  if (!reason) return;
  try {
    showLoading();
    await api.createReport({ reportedId: userId, type: 'USER', reason });
    hideLoading();
    showToast('Report Submitted', 'Your report has been received and will be reviewed by admin.', '');
  } catch (e) {
    hideLoading();
    showError('Failed to report user');
  }
};

// ─── Boot ────────────────────────────────────────────────────

(async function boot() {
  await checkAuth();
  router();
  // Start background polling for accepted requests (every 30s)
  if (state.user) {
    startAcceptedPoll();
    setInterval(() => { if (state.user) startAcceptedPoll(); }, 30_000);
  }
})();