// Public frontend configuration. The publishable key is safe for browser use;
// database access is controlled by Supabase Auth and RLS policies.
// Never put an sb_secret_ / service_role key in browser code.
if (window.supabase?.createClient) {
  window.adminSupabase = window.supabase.createClient(
    'https://dwdiubwbjpyqvfvxdbat.supabase.co',
    'sb_publishable_hrQLrpvyDUdncxz2xsv0tg_6IAGkvwH',
    { auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true } }
  );
} else {
  console.error('Supabase JS SDK did not load. Check the internet connection.');
}

// This must match the single address in the database admin allowlist.
window.adminSignupEmail = 'mecaellacorcotchia15@gmail.com';
