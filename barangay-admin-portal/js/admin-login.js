/* =====================================================================
   Admin Login page (pages/login/index.html)
   ===================================================================== */

'use strict';

(() => {
  const sb = window.adminSupabase;
  const { show, busy } = window.adminAuth;

  const form = document.querySelector('#adminLoginForm');
  const errorBox = document.querySelector('#loginError');
  const emailInput = document.querySelector('#adminEmail');
  const passwordInput = document.querySelector('#adminPassword');
  const submitButton = form.querySelector('[type="submit"]');

  const DASHBOARD = '../dashboard/index.html';

  // Message when the dashboard sent a non-admin account back here.
  if (new URLSearchParams(location.search).get('unauthorized') === '1') {
    show(errorBox, 'That account is not on the admin allowlist. Sign in with the approved admin email.');
  }
  if (!sb) {
    show(errorBox, 'Online services are unavailable. Check your internet connection and reload. You can still open the preview.');
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    show(errorBox, '');

    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    if (!email || !password) {
      show(errorBox, 'Enter your admin email and password.');
      (email ? passwordInput : emailInput).focus();
      return;
    }
    if (!emailInput.checkValidity()) {
      show(errorBox, 'Enter a valid email address.');
      emailInput.focus();
      return;
    }
    if (!sb) {
      show(errorBox, 'Online services are unavailable. Check your internet connection and reload.');
      return;
    }

    busy(submitButton, 'Signing in…', async () => {
      const { error: signInError } = await sb.auth.signInWithPassword({ email, password });
      if (signInError) {
        show(errorBox, 'Could not sign in. Check the admin email and password, and confirm the account exists in Supabase Auth.');
        return;
      }
      const { data: isAdmin, error: roleError } = await sb.rpc('is_admin');
      if (roleError || isAdmin !== true) {
        await sb.auth.signOut();
        show(errorBox, 'This Supabase account is not on the admin allowlist.');
        return;
      }
      window.location.href = DASHBOARD;
    });
  });

  document.querySelector('#previewButton').addEventListener('click', () => {
    window.location.href = `${DASHBOARD}?preview=1`;
  });

  // Already signed in as admin? Go straight to the dashboard.
  sb?.auth.getSession().then(async ({ data: { session } }) => {
    if (!session) return;
    const { data: isAdmin } = await sb.rpc('is_admin');
    if (isAdmin === true) window.location.href = DASHBOARD;
  });
})();
