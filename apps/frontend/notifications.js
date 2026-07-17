/**
 * LendIT Notification Service
 * Isolates toast notification log for future expansion into a notification center.
 */

const $toastContainer = document.createElement('div');
$toastContainer.id = 'toast-container';
document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild($toastContainer);
});

/**
 * Enhanced Toast Notification
 * @param {Object} options 
 * @param {string} options.type - "success" | "info" | "warning" | "error"
 * @param {string} [options.title]
 * @param {string} options.message
 * @param {string} [options.link]
 */
window.showToast = function ({ type = 'info', title, message, link }) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    // Default titles based on type if not provided
    const defaultTitles = {
        success: '✅ Success',
        info: 'ℹ️ Info',
        warning: '⚠️ Warning',
        error: '❌ Error'
    };
    const displayTitle = title || defaultTitles[type] || 'Notification';

    // Function to safely escape HTML to prevent XSS
    const escapeHtml = (unsafe) => {
        return (unsafe || '').toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    };

    toast.innerHTML = `
        <div class="toast-title">${escapeHtml(displayTitle)}</div>
        <div class="toast-body">${escapeHtml(message)}</div>
    `;

    if (link) {
        toast.style.cursor = 'pointer';
        toast.addEventListener('click', () => {
            window.location.hash = link;
            toast.remove();
        });
    }

    $toastContainer.appendChild(toast);

    // CSS transition
    requestAnimationFrame(() => toast.classList.add('show'));

    // Rely on global UI config if available, otherwise default to 4000
    const duration = (window.UI && window.UI.toastDuration) ? window.UI.toastDuration : 4000;
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
};
