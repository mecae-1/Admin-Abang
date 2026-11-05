/* =====================================================================
   Admin Sign-up page (pages/signup/index.html)
   ===================================================================== */

'use strict';

(() => {
  const sb = window.adminSupabase;
  const { show, busy } = window.adminAuth;

  const form = document.querySelector('#adminSignupForm');
  const message = document.querySelector('#signupMessage');
  const submitButton = form.querySelector('[type="submit"]');
  const field = id => document.getElementById(id);

  if (!sb) show(message, 'Online services are unavailable. Check your internet connection and reload.');

  form.addEventListener('submit', event => {
    event.preventDefault();
    show(message, '');

    const fullName = field('adminName').value.trim();
    const email = field('adminEmail').value.trim().toLowerCase();
    const password = field('adminPassword').value;
    const confirmPassword = field('adminConfirmPassword').value;

    if (!fullName) {
      show(message, 'Enter your full name.');
      field('adminName').focus();
      return;
    }
    if (email !== window.adminSignupEmail) {
      show(message, `For this development setup, use the approved admin email: ${window.adminSignupEmail}`);
      field('adminEmail').focus();
      return;
    }
    if (password.length < 8) {
      show(message, 'Choose a password with at least 8 characters.');
      field('adminPassword').focus();
      return;
    }
    if (password !== confirmPassword) {
      show(message, 'The passwords do not match.');
      field('adminConfirmPassword').focus();
      return;
    }
    if (!sb) return;

    busy(submitButton, 'Creating account…', async () => {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: new URL('../login/index.html', window.location.href).href
        }
      });

      if (error) {
        show(message, error.message);
        return;
      }
      if (!data.session) {
        form.reset();
        show(message, 'Account created. Check the admin email inbox to confirm it, then return to Admin Login.', true);
        return;
      }

      const { data: isAdmin, error: roleError } = await sb.rpc('is_admin');
      if (roleError || isAdmin !== true) {
        await sb.auth.signOut();
        show(message, 'The account was created, but Supabase does not recognize this email as an admin yet. Confirm that the allowlist SQL is set up.');
        return;
      }
      window.location.href = '../dashboard/index.html';
    });
  });
})();
