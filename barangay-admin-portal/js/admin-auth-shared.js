/* =====================================================================
   Shared helpers for the admin Login and Sign-up pages.
   ===================================================================== */

'use strict';

window.adminAuth = {
  /* Show a message in a .login-error box (red by default, green on success). */
  show(box, message, success = false) {
    box.textContent = message;
    box.style.display = message ? 'block' : 'none';
    box.classList.toggle('success', success);
  },

  /* Disable a button and change its label while an async task runs. */
  async busy(button, label, task) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = label;
    try {
      return await task();
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }
};

/* Every eye button with data-toggle="<input id>" shows / hides that password. */
document.querySelectorAll('[data-toggle]').forEach(button => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.toggle);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.textContent = show ? '◎' : '◉';
    button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    button.setAttribute('aria-pressed', String(show));
  });
});
