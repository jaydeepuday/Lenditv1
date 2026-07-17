// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// api.js — LendIT API layer
// All backend communication isolated here.
// Uses fetch with credentials:'include' for cookie-based JWT.
// On 401, attempts one silent token refresh then retries.
// ─────────────────────────────────────────────────────────────

// Environment switching for API base URL
// Allows the frontend to seamlessly switch between local dev and production backend
export const BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001'
    : 'https://lendit-backend-tr3h.onrender.com'; // ⚠️ Replace this with your REAL Render URL!

const API_BASE = `${BACKEND_URL}/api/v1`;


// ─── Core fetch wrapper ────────────────────────────────────

let refreshPromise = null;

const REFRESH_EXCLUDED_PATHS = new Set([
    '/auth/login',
    '/auth/signup',
    '/auth/verify-otp',
    '/auth/resend-otp',
    '/auth/refresh',
]);

function shouldRefresh(path, status) {
    return status === 401 && !REFRESH_EXCLUDED_PATHS.has(path);
}

function refreshSession() {
    if (!refreshPromise) {
        refreshPromise = fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            credentials: 'include',
        }).finally(() => {
            refreshPromise = null;
        });
    }
    return refreshPromise;
}

/**
 * Wrapper around fetch that:
 * 1. Sets JSON headers + credentials
 * 2. On 401, attempts one silent token refresh, then retries
 * 3. Returns parsed JSON or throws { status, message }
 */
async function apiFetch(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const config = {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
    };

    // Don't JSON-stringify if body is already a string or absent
    if (config.body && typeof config.body !== 'string') {
        config.body = JSON.stringify(config.body);
    }

    let res = await fetch(url, config);

    // On 401, try a silent refresh (once) for session-backed endpoints.
    if (shouldRefresh(path, res.status)) {
        try {
            const refreshRes = await refreshSession();
            if (refreshRes.ok) {
                // Retry original request with fresh cookies
                res = await fetch(url, config);
            }
        } catch (_) {
            // Refresh failed — fall through to error handling
        }
    }

    // Parse response
    let data;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        data = await res.json();
    } else {
        data = await res.text();
    }

    if (!res.ok) {
        const message =
            (typeof data === 'object' && (data.message || data.data?.message)) ||
            (typeof data === 'string' && data) ||
            `Request failed (${res.status})`;
        throw { status: res.status, message };
    }

    // Unwrap TransformInterceptor envelope: { success: true, data: <payload>, timestamp }
    if (data && typeof data === 'object' && 'success' in data && 'data' in data) {
        return data.data;
    }

    return data;
}

// ─── Auth ──────────────────────────────────────────────────

/** Signup: email + password + name + college → { message } */
function signup(data) {
    return apiFetch('/auth/signup', { method: 'POST', body: data });
}

/** Verify OTP: email + otp → { message, accessToken?, refreshToken? } */
function verifyOtp(data) {
    return apiFetch('/auth/verify-otp', { method: 'POST', body: data });
}

/** Resend OTP: { email } */
function resendOtp(email) {
    return apiFetch('/auth/resend-otp', { method: 'POST', body: { email } });
}

/** Login: email + password → tokens set via cookies */
function login(data) {
    return apiFetch('/auth/login', { method: 'POST', body: data });
}

/** Logout → clears cookies */
function logout() {
    return apiFetch('/auth/logout', { method: 'POST' });
}

/** Get current user profile */
function getProfile() {
    return apiFetch('/auth/me');
}

// ─── Items ─────────────────────────────────────────────────

/** List items with optional filters (search, category, page, limit, etc.) */
function getItems(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params.set(k, v);
    });
    const qs = params.toString();
    return apiFetch(`/items${qs ? '?' + qs : ''}`);
}

/** Get single item by ID */
function getItem(id) {
    return apiFetch(`/items/${id}`);
}

/** Create a new item listing */
function createItem(data) {
    return apiFetch('/items', { method: 'POST', body: data });
}

/** Update an item */
function updateItem(id, data) {
    return apiFetch(`/items/${id}`, { method: 'PATCH', body: data });
}

/** Get items listed by current user */
function getMyItems() {
    return apiFetch('/items/my');
}

// ─── Borrow ────────────────────────────────────────────────

/** Request to borrow an item: { itemId, durationType, durationValue } */
function requestBorrow(data, options = {}) {
    return apiFetch('/borrow', { method: 'POST', body: data, ...options });
}

/** Check turnover warning before requesting to borrow */
function checkTurnover(data) {
    return apiFetch('/borrow/check-turnover', { method: 'POST', body: data });
}

/** Lender responds: { action: 'ACCEPTED' | 'REJECTED' } */
function respondBorrow(id, data) {
    return apiFetch(`/borrow/${id}/respond`, { method: 'PATCH', body: data });
}

function initiateCheckout(id) {
    return apiFetch(`/borrow/${id}/initiate-checkout`, { method: 'POST' });
}

/** Renter pays for accepted borrow */
function payBorrow(id) {
    return apiFetch(`/borrow/${id}/pay`, { method: 'POST' });
}

/** Renter marks item as collected */
function collectBorrow(id, payload) {
    return apiFetch(`/borrow/${id}/collect`, { method: 'POST', body: payload });
}

/** Return item */
function returnBorrow(id, payload) {
    return apiFetch(`/borrow/${id}/return`, { method: 'POST', body: payload });
}

/** Get OTPs for a transaction (lender only) */
function getTransactionOtp(id) {
    return apiFetch(`/borrow/${id}/otp`);
}

/** Cancel transaction */
function cancelBorrow(id) {
    return apiFetch(`/borrow/${id}/cancel`, { method: 'POST' });
}

/** Get a single transaction */
function getTransaction(id) {
    return apiFetch(`/borrow/${id}`);
}

/** My rentals (as borrower/renter) */
function myRentals() {
    return apiFetch('/borrow/my/renting');
}

/** My lendings (as lender) */
function myLendings() {
    return apiFetch('/borrow/my/lending');
}

// ─── Chat ──────────────────────────────────────────────────

/** Create or Get a chat for an item */
function createChat(itemId) {
    return apiFetch('/chat', { method: 'POST', body: { itemId } });
}

/** Get all chats for the current user */
function myChats() {
    return apiFetch('/chat/my');
}

/** Get detailed chat information (messages, trust signals, transaction) */
function getChatDetails(id) {
    return apiFetch(`/chat/${id}`);
}

// ─── Wallet ────────────────────────────────────────────────

/** Get wallet balance */
function getWallet() {
    return apiFetch('/wallet');
}

/** Add funds to wallet (demo top-up) */
function depositWallet(amount) {
    return apiFetch('/wallet/deposit', { method: 'POST', body: { amount } });
}

/** Get wallet transaction history (paginated) */
function getWalletHistory(page = 1, limit = 20) {
    return apiFetch(`/wallet/history?page=${page}&limit=${limit}`);
}

/** Request withdrawal */
function requestWithdrawal(amount) {
    return apiFetch('/wallet/withdraw', { method: 'POST', body: { amount } });
}

// ─── Reports ───────────────────────────────────────────────

/** Create a report  */
function createReport(data) {
    return apiFetch('/reports', { method: 'POST', body: data });
}

// ─── Admin ─────────────────────────────────────────────────

/** Get admin stats */
function getAdminStats() {
    return apiFetch('/admin/stats');
}

/** Get pending reports */
function getAdminReports() {
    return apiFetch('/admin/reports');
}

/** Dismiss a report (mark resolved, no action) */
function dismissReport(id) {
    return apiFetch(`/admin/reports/${id}/dismiss`, { method: 'PATCH' });
}

/** Admin force-remove an item (soft-delete + resolve reports) */
function removeAdminItem(id) {
    return apiFetch(`/admin/items/${id}`, { method: 'DELETE' });
}

// ─── Export ────────────────────────────────────────────────

export const api = {
    // Auth
    signup,
    verifyOtp,
    resendOtp,
    login,
    logout,
    getProfile,
    // Items
    getItems,
    getItem,
    createItem,
    updateItem,
    getMyItems,
    // Borrow
    checkTurnover,
    requestBorrow,
    respondBorrow,
    initiateCheckout,
    payBorrow,
    processPayment: payBorrow, // Alias for consistency
    collectBorrow,
    returnBorrow,
    getTransaction,
    getTransactionOtp,
    myRentals,
    myLendings,
    cancelBorrow,
    // Chat
    createChat,
    myChats,
    getChatDetails,
    // Wallet
    getWallet,
    depositWallet,
    getWalletHistory,
    requestWithdrawal,
    // Reports
    createReport,
    // Admin
    getAdminStats,
    getAdminReports,
    dismissReport,
    removeAdminItem,
};

