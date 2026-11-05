/* =====================================================================
   Barangay Abang · Admin Dashboard (pages/dashboard/index.html)
   ---------------------------------------------------------------------
   Sections in this file:
     1. Config & state
     2. Helpers
     3. Data loading (Supabase) and preview storage
     4. Navigation (URL hash → page)
     5. Shared templates (table, status badge, page heading, actions)
     6. Page templates (Dashboard, Residents, Households, Documents,
        Complaints, Announcements, Reports, Settings)
     7. Layout (sidebar, top bar) and render()
     8. Modals
     9. Actions (save, update status, delete, export, print, profile)
    10. Event wiring (delegated listeners, attached once)
    11. Boot
   Buttons use data-action="..." and are handled in clickActions.
   ===================================================================== */

(() => {
  'use strict';

  /* -------------------------------------------------------------------
     1. Config & state
     ------------------------------------------------------------------- */

  const root = document.querySelector('#adminApp');
  const modalRoot = document.querySelector('#modalRoot');
  const toastRoot = document.querySelector('#toastRoot');
  const sb = window.adminSupabase;

  const THEME_KEY = 'barangay-admin-ui-settings-v1';
  const PREVIEW_KEY = 'barangay-admin-preview-records-v1';
  const PHOTO_KEY = 'barangay-admin-profile-photo-v1';
  const SEAL = '../../assets/barangay-seal.jpg';

  const SITIOS = [
    'BYPASS', 'RACELIS COMPOUND', 'MARILAND', 'TABING-HIGHWAY', 'PULANG LUPA',
    'CASA MILAGROSA', "NINO'S MOTOR", 'ASTORIA', 'SUMMERVILLE HOMES 2', 'SITIO GITNA',
    'SITIO GITNA LOOBAN', 'SAKA ROAD', 'ISAKAR', 'CORINTHIAN', 'ST. FRANCIS',
    'ST. TIMOTHY', "DAYA'S COMPOUND", 'PAG-ASA 1', 'PAG-ASA 2', 'SITIO IBABA'
  ];

  /* slug → { label, icon }. The slug is the URL hash (#residents, …). */
  const PAGES = {
    dashboard: { label: 'Dashboard', icon: '⌂' },
    residents: { label: 'Residents', icon: '☷' },
    households: { label: 'Households', icon: '⌂' },
    documents: { label: 'Documents', icon: '▤' },
    complaints: { label: 'Complaints & Blotter', icon: '⚠' },
    announcements: { label: 'Announcements', icon: '◀' },
    reports: { label: 'Reports', icon: '▥' },
    settings: { label: 'Settings', icon: '⚙' }
  };
  const SEARCHABLE_PAGES = ['residents', 'households', 'documents', 'complaints', 'announcements'];
  const LIVE_PAGES = ['dashboard', 'residents', 'households', 'documents', 'complaints', 'announcements'];

  const DOCUMENT_STATUSES = ['Pending', 'Processing', 'Approved', 'Completed', 'Rejected'];
  const COMPLAINT_STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];

  const data = {
    residents: [],
    households: [],
    documents: [],
    complaints: [],
    announcements: [],
    activities: [],
    profile: { id: '', name: 'Admin Preview', email: '', username: '', photo: localStorage.getItem(PHOTO_KEY) || '' },
    dark: localStorage.getItem(THEME_KEY) === 'dark'
  };

  const state = {
    page: 'dashboard',
    filter: 'All',
    householdSitioFilter: 'All',
    search: '',
    sidebarOpen: false,
    profileMenuOpen: false,
    notifOpen: false,
    isAdmin: false,
    preview: false,
    lastFocus: null
  };

  /* -------------------------------------------------------------------
     2. Helpers
     ------------------------------------------------------------------- */

  const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));

  const shortDate = value => new Date(value).toLocaleDateString('en', { month: 'short', day: '2-digit', year: 'numeric' });
  const stamp = () => new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const dash = value => esc(value || '—');

  let toastTimer = null;
  function toast(message) {
    toastRoot.innerHTML = `<p class="toast">${esc(message)}</p>`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastRoot.replaceChildren(), 3200);
  }

  const saveTheme = () => localStorage.setItem(THEME_KEY, data.dark ? 'dark' : 'light');

  function matchesSearch(item, keys) {
    if (!state.search) return true;
    const term = state.search.toLowerCase();
    return keys.some(key => String(item[key] ?? '').toLowerCase().includes(term));
  }

  /* Keep each item's original index so row buttons point at the right record. */
  function filtered(items, keys, useStatusFilter = true) {
    return items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) =>
        (!useStatusFilter || state.filter === 'All' || item.status === state.filter) &&
        matchesSearch(item, keys));
  }

  /* -------------------------------------------------------------------
     3. Data loading (Supabase) and preview storage
     ------------------------------------------------------------------- */

  function savePreviewRecords() {
    localStorage.setItem(PREVIEW_KEY, JSON.stringify({
      residents: data.residents,
      households: data.households,
      announcements: data.announcements
    }));
  }

  function loadPreviewRecords() {
    try {
      const saved = JSON.parse(localStorage.getItem(PREVIEW_KEY) || '{}');
      data.residents = saved.residents || [];
      data.households = saved.households || [];
      data.announcements = saved.announcements || [];
    } catch {
      data.residents = [];
      data.households = [];
      data.announcements = [];
    }
    rebuildActivities();
  }

  function rebuildActivities() {
    data.activities = [
      ...data.complaints.map(c => ({ icon: '⚠️', title: `Complaint filed: ${c.subject}`, date: c.date, created_at: c.created_at })),
      ...data.documents.map(d => ({ icon: '📄', title: `Document request: ${d.type}`, date: d.date, created_at: d.created_at })),
      ...data.announcements.map(a => ({ icon: '📢', title: `Announcement: ${a.title}`, date: a.date, created_at: a.created_at })),
      ...data.residents.filter(r => r.source === 'resident').map(r => ({ icon: '👤', title: `Resident saved: ${r.name}`, date: r.date ? shortDate(r.date) : '', created_at: r.date }))
    ]
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(0, 8);
  }

  async function notifyUsers(type, recordId) {
    const { data: result, error } = await sb.functions.invoke('notify-users', { body: { type, recordId } });
    if (error) return { error: error.message || 'Email service is unavailable.' };
    if (result?.failed) return { error: `${result.sent} sent; ${result.failed} failed.` };
    if (!result?.sent) return { error: result?.message || 'No emails were delivered.' };
    return { sent: result.sent };
  }

  async function refreshLiveData() {
    if (!state.isAdmin) return;

    const queries = await Promise.all([
      sb.from('profiles').select('id,email,full_name,username,created_at').order('created_at', { ascending: false }),
      sb.from('complaints').select('id,user_id,subject,details,status,admin_notes,created_at,profiles!complaints_user_id_fkey(full_name,email)').order('created_at', { ascending: false }),
      sb.from('document_requests').select('id,user_id,document_type,purpose,details,status,admin_notes,created_at,profiles!document_requests_user_id_fkey(full_name,email)').order('created_at', { ascending: false }),
      sb.from('announcements').select('id,title,body,kind,published,published_at,created_at').order('created_at', { ascending: false }),
      sb.from('residents').select('id,full_name,birthday,contact_number,email,household_id,created_at,households!residents_household_id_fkey(household_number,sitio)').order('created_at', { ascending: false }),
      sb.from('households').select('id,household_number,sitio,residents(id,full_name,birthday,contact_number,email)').order('household_number')
    ]);
    const [profiles, complaintsResult, documentsResult, announcementsResult, residentsResult, householdsResult] = queries;

    const savedResidents = (residentsResult.data || []).map(r => ({
      id: r.id,
      name: r.full_name,
      email: r.email,
      birthday: r.birthday,
      contact: r.contact_number,
      household_number: r.households?.household_number || '',
      sitio: r.households?.sitio || '',
      source: 'resident',
      date: r.created_at
    }));

    // Signed-up users who are not yet saved as residents are listed too.
    const savedEmails = new Set(savedResidents.map(r => r.email?.toLowerCase()).filter(Boolean));
    const signupProfiles = (profiles.data || [])
      .filter(p => p.id !== data.profile.id && !savedEmails.has(p.email?.toLowerCase()))
      .map(p => ({ id: p.id, name: p.full_name, email: p.email, username: p.username, household_number: '', source: 'profile', date: p.created_at }));
    data.residents = [...savedResidents, ...signupProfiles];

    data.households = (householdsResult.data || []).map(h => ({
      id: h.id, household_number: h.household_number, sitio: h.sitio || '', residents: h.residents || []
    }));

    const profileOf = p => (Array.isArray(p) ? p[0] : p);
    const residentName = p => profileOf(p)?.full_name || profileOf(p)?.email || 'Resident';

    data.complaints = (complaintsResult.data || []).map(c => ({
      id: c.id, user_id: c.user_id, resident: residentName(c.profiles), subject: c.subject, details: c.details,
      status: c.status, notes: c.admin_notes, date: shortDate(c.created_at), created_at: c.created_at
    }));

    data.documents = (documentsResult.data || []).map(d => ({
      id: d.id, user_id: d.user_id, resident: residentName(d.profiles), type: d.document_type, purpose: d.purpose,
      details: d.details, status: d.status, notes: d.admin_notes, date: shortDate(d.created_at), created_at: d.created_at
    }));

    data.announcements = (announcementsResult.data || []).map(a => ({
      id: a.id, title: a.title, body: a.body, type: a.kind, published: a.published,
      published_at: a.published_at, created_at: a.created_at,
      date: shortDate(a.published_at || a.created_at)
    }));

    rebuildActivities();

    const setupFailure = residentsResult.error || householdsResult.error;
    const failure = queries.slice(0, 4).find(result => result.error)?.error;
    if (setupFailure) toast(`Resident/household tables are not set up in Supabase yet. Run residents-households-migration.sql, then refresh. (${setupFailure.message})`);
    else if (failure) toast(`Supabase data could not fully load: ${failure.message}`);
  }

  function rebuildPreviewHouseholds() {
    const groups = new Map();
    data.residents.filter(r => r.source === 'resident').forEach(r => {
      const number = String(r.household_number || '').trim();
      if (!number) return;
      if (!groups.has(number)) groups.set(number, { id: `local-${number}`, household_number: number, sitio: r.sitio || '', residents: [] });
      groups.get(number).residents.push({ id: r.id, full_name: r.name, birthday: r.birthday, contact_number: r.contact, email: r.email });
    });
    data.households = [...groups.values()];
  }

  /* -------------------------------------------------------------------
     4. Navigation (URL hash → page)
     ------------------------------------------------------------------- */

  const pageFromHash = () => {
    const slug = location.hash.slice(1);
    return PAGES[slug] ? slug : 'dashboard';
  };

  function closePopups() {
    state.profileMenuOpen = false;
    state.notifOpen = false;
    state.sidebarOpen = false;
  }

  async function showPage(slug, { keepFilter = false } = {}) {
    const changed = slug !== state.page;
    state.page = slug;
    if (changed && !keepFilter) {
      state.filter = 'All';
      state.search = '';
    }
    closePopups();
    render();
    if (changed) window.scrollTo({ top: 0 });
    if (state.isAdmin && LIVE_PAGES.includes(slug)) {
      await refreshLiveData();
      render();
    }
  }

  function goTo(slug, options) {
    if (location.hash === '#' + slug) showPage(slug, options);
    else {
      pendingNavOptions = options;
      location.hash = slug; // → hashchange → showPage
    }
  }
  let pendingNavOptions = null;

  /* -------------------------------------------------------------------
     5. Shared templates
     ------------------------------------------------------------------- */

  function statusBadge(value) {
    return `<span class="status ${esc(String(value).toLowerCase().replaceAll(' ', '-'))}">${esc(value)}</span>`;
  }

  function table(caption, headers, rows) {
    const empty = state.search
      ? `No records match “${esc(state.search)}”.`
      : 'No records found.';
    return `
      <div class="table-wrap">
        <table class="data-table">
          <caption class="visually-hidden">${esc(caption)}</caption>
          <thead><tr>${headers.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${headers.length}" class="empty-state">${empty}</td></tr>`}</tbody>
        </table>
      </div>`;
  }

  function rowActions(type, index) {
    const isCase = type === 'document' || type === 'complaint';
    const editLabel = isCase ? 'Update status and send email' : 'Edit';
    return `
      <div class="action-row">
        <button class="action-btn" type="button" data-action="view" data-type="${type}" data-index="${index}" title="View" aria-label="View">👁️</button>
        <button class="action-btn" type="button" data-action="edit" data-type="${type}" data-index="${index}" title="${editLabel}" aria-label="${editLabel}">${isCase ? '✉️' : '✎'}</button>
      </div>`;
  }

  function pageHeading(title, sub, action = '') {
    return `
      <header class="page-heading">
        <div>
          <h1>${esc(title)}</h1>
          <p>${esc(sub)}</p>
        </div>
        ${action}
      </header>`;
  }

  function statusFilters(options, labels = {}) {
    return `
      <div class="filters" role="group" aria-label="Filter by status">
        ${['All', ...options].map(f => `
          <button class="filter-btn ${state.filter === f ? 'active' : ''}" type="button"
            data-action="filter" data-filter="${esc(f)}" aria-pressed="${state.filter === f}">${esc(labels[f] || f)}</button>`).join('')}
      </div>`;
  }

  function statCards(cards) {
    return `
      <ul class="stat-grid">
        ${cards.map(([icon, value, label]) => `
          <li class="stat-card">
            ${icon ? `<span class="stat-icon" aria-hidden="true">${icon}</span>` : ''}
            <strong class="stat-value">${esc(value)}</strong>
            <span class="stat-label">${esc(label)}</span>
          </li>`).join('')}
      </ul>`;
  }

  /* -------------------------------------------------------------------
     6. Page templates
     ------------------------------------------------------------------- */

  function dashboardPage() {
    const pending = data.documents.filter(d => d.status === 'Pending').length;
    const activities = data.activities.length
      ? `<ol class="activity-list">
           ${data.activities.slice(0, 5).map(a => `
             <li class="activity-row">
               <span class="activity-symbol" aria-hidden="true">${esc(a.icon)}</span>
               <div><strong>${esc(a.title)}</strong><small>${esc(a.date)}</small></div>
             </li>`).join('')}
         </ol>`
      : '<p class="empty-state">No recent activity yet.</p>';

    const quick = [
      ['residents', '♟', 'View Residents'],
      ['documents', '▤', 'Review Documents'],
      ['complaints', '⚠', 'View Complaints'],
      ['reports', '▥', 'Generate Report']
    ];

    return `
      ${pageHeading('Welcome, Admin!', 'Barangay Abang Information Management System')}
      ${statCards([
        ['♟', data.residents.length.toLocaleString(), 'Registered Residents'],
        ['⌂', data.households.length, 'Households'],
        ['▤', SITIOS.length, 'Sitios'],
        ['▣', pending, 'Pending Requests']
      ])}
      <div class="dashboard-grid">
        <section class="panel" aria-labelledby="activityTitle">
          <h2 id="activityTitle">Recent Activities</h2>
          ${activities}
        </section>
        <section class="panel" aria-labelledby="quickTitle">
          <h2 id="quickTitle">Quick Actions</h2>
          <nav class="quick-grid" aria-label="Quick actions">
            ${quick.map(([slug, icon, label]) => `<a class="quick-action" href="#${slug}"><span aria-hidden="true">${icon}</span>${label}</a>`).join('')}
          </nav>
        </section>
      </div>`;
  }

  function residentsPage() {
    const rows = filtered(data.residents, ['id', 'name', 'email', 'household_number', 'contact', 'sitio'], false)
      .map(({ item: r, index }) => `
        <tr>
          <td>${esc(String(r.id).slice(0, 8))}</td>
          <th scope="row">${dash(r.name)}</th>
          <td>${dash(r.household_number)}</td>
          <td>${dash(r.birthday)}</td>
          <td>${dash(r.contact)}</td>
          <td>${dash(r.email)}</td>
          <td>${statusBadge(r.source === 'resident' ? 'Registered' : 'Signed up')}</td>
          <td>${rowActions('resident', index)}</td>
        </tr>`).join('');

    return `
      ${pageHeading('Residents', 'Resident profiles and household assignments.',
        '<button class="btn btn-primary" type="button" data-action="add-resident">＋ Add a Resident</button>')}
      <div class="toolbar"><span>${plural(data.residents.length, 'registered resident')}</span></div>
      ${table('Residents', ['ID', 'Name', 'Household No.', 'Birthday', 'Contact Number', 'Email', 'Status', 'Actions'], rows)}`;
  }

  function householdsPage() {
    const visible = data.residents
      .map((item, index) => ({ item, index }))
      .filter(({ item: r }) => r.source === 'resident' &&
        (state.householdSitioFilter === 'All' || r.sitio === state.householdSitioFilter) &&
        matchesSearch(r, ['name', 'household_number', 'sitio', 'contact', 'email']));

    const rows = visible.map(({ item: r, index }) => `
      <tr>
        <th scope="row">${dash(r.name)}</th>
        <td>${dash(r.household_number)}</td>
        <td>${dash(r.sitio)}</td>
        <td>${dash(r.birthday)}</td>
        <td>${dash(r.contact)}</td>
        <td>${dash(r.email)}</td>
        <td>${rowActions('resident', index)}</td>
      </tr>`).join('');

    return `
      ${pageHeading('Households', 'Each saved resident is listed separately under their household and sitio.',
        '<button class="btn btn-primary" type="button" data-action="add-resident">＋ Add a Resident</button>')}
      <div class="toolbar">
        <label class="filter-control">
          <span>Filter by sitio</span>
          <select class="filter-select" id="householdSitioFilter">
            ${['All', ...SITIOS].map(s => `<option value="${esc(s)}" ${state.householdSitioFilter === s ? 'selected' : ''}>${s === 'All' ? 'All sitios' : esc(s)}</option>`).join('')}
          </select>
        </label>
        <span>${plural(visible.length, 'saved resident')}</span>
      </div>
      ${table('Residents by household', ['Resident Name', 'Household Number', 'Sitio', 'Birthday', 'Contact Number', 'Email', 'Actions'], rows)}`;
  }

  function documentsPage() {
    const rows = filtered(data.documents, ['id', 'resident', 'type', 'status', 'purpose'])
      .map(({ item: d, index }) => `
        <tr>
          <td>${esc(String(d.id).slice(0, 8))}</td>
          <th scope="row">${dash(d.resident)}</th>
          <td>${esc(d.type)}</td>
          <td>${esc(d.date)}</td>
          <td>${statusBadge(d.status)}</td>
          <td>${rowActions('document', index)}</td>
        </tr>`).join('');

    return `
      ${pageHeading('Document Requests', 'Review and update requests submitted by residents.',
        '<button class="btn" type="button" data-action="refresh">↻ Refresh</button>')}
      <div class="toolbar">
        ${statusFilters(DOCUMENT_STATUSES, { Pending: 'For Processing' })}
        <span>${plural(data.documents.length, 'request')}</span>
      </div>
      ${table('Document requests', ['ID', 'Resident Name', 'Document Type', 'Date Requested', 'Status', 'Actions'], rows)}`;
  }

  function complaintsPage() {
    const rows = filtered(data.complaints, ['id', 'resident', 'subject', 'status', 'details'])
      .map(({ item: c, index }) => `
        <tr>
          <td>${esc(String(c.id).slice(0, 8))}</td>
          <th scope="row">${dash(c.resident)}</th>
          <td>${esc(c.subject)}</td>
          <td>${esc(c.date)}</td>
          <td>${statusBadge(c.status)}</td>
          <td>${rowActions('complaint', index)}</td>
        </tr>`).join('');

    return `
      ${pageHeading('Complaints & Blotter', 'Complaints submitted by users through the connected portal.',
        '<button class="btn" type="button" data-action="refresh">↻ Refresh</button>')}
      <div class="toolbar">
        ${statusFilters(COMPLAINT_STATUSES)}
        <span>${plural(data.complaints.length, 'complaint')}</span>
      </div>
      ${table('Complaints', ['ID', 'Complainant', 'Subject', 'Date Filed', 'Status', 'Actions'], rows)}`;
  }

  function announcementsPage() {
    const items = filtered(data.announcements, ['title', 'body', 'type'], false);
    const list = items.length
      ? `<ul class="announcement-list">
           ${items.map(({ item: a, index }) => `
             <li>
               <article class="announcement-card">
                 <span class="announcement-icon" aria-hidden="true">${a.type === 'Event' ? '▦' : '◀'}</span>
                 <div>
                   <h2>${esc(a.title)}</h2>
                   <p>${esc(a.body)}</p>
                   <small><time datetime="${esc(a.published_at || a.created_at || '')}">${esc(a.date)}</time></small>
                 </div>
                 <span class="announcement-type">${esc(a.type)}</span>
                 <div class="action-row">
                   <button class="action-btn" type="button" data-action="edit" data-type="announcement" data-index="${index}" aria-label="Edit ${esc(a.title)}" title="Edit">✎</button>
                 </div>
               </article>
             </li>`).join('')}
         </ul>`
      : `<p class="panel empty-state">${state.search ? `No announcements match “${esc(state.search)}”.` : 'No announcements yet.'}</p>`;

    return `
      ${pageHeading('Announcements & Events', 'Published announcements from Supabase.',
        '<button class="btn btn-primary" type="button" data-action="add-announcement">＋ Add Announcement</button>')}
      ${list}`;
  }

  function reportsPage() {
    const counts = COMPLAINT_STATUSES.map(s => data.complaints.filter(c => c.status === s).length);
    const max = Math.max(1, ...counts);
    const generated = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

    return `
      ${pageHeading('Reports', 'Live summary from connected Supabase records.')}
      <p class="print-only">Generated ${esc(generated)}</p>
      ${statCards([
        ['', data.residents.length, 'Registered Residents'],
        ['', data.documents.length, 'Document Requests'],
        ['', data.complaints.length, 'Complaints'],
        ['', data.announcements.length, 'Announcements']
      ])}
      <section class="panel report-section" aria-labelledby="chartTitle">
        <h2 id="chartTitle">Complaints by Status</h2>
        <figure class="bar-chart" aria-label="Bar chart of complaints by status">
          ${COMPLAINT_STATUSES.map((label, i) => `
            <div class="bar-column">
              <strong>${counts[i]}</strong>
              <div class="bar" style="height:${Math.max(10, (counts[i] / max) * 75)}%"></div>
              <small>${label}</small>
            </div>`).join('')}
        </figure>
      </section>
      <section class="panel report-section no-print" aria-labelledby="exportTitle">
        <h2 id="exportTitle">Export</h2>
        <div class="report-actions">
          <button class="btn btn-primary" type="button" data-action="print-report">▣ Generate Report (Print / PDF)</button>
          <button class="btn" type="button" data-action="export" data-export="documents">⇩ Documents CSV</button>
          <button class="btn" type="button" data-action="export" data-export="complaints">⇩ Complaints CSV</button>
          <button class="btn" type="button" data-action="export" data-export="residents">⇩ Residents CSV</button>
        </div>
      </section>`;
  }

  function settingsPage() {
    const { profile } = data;
    return `
      ${pageHeading('Settings', 'Manage your admin profile and preferences.')}
      <div class="settings-grid">
        <section class="panel profile-photo-box" aria-labelledby="photoTitle">
          <img class="profile-photo-large" src="${esc(profile.photo || SEAL)}" alt="Profile photo">
          <h2 id="photoTitle">${esc(profile.name)}</h2>
          <p>${esc(profile.email)}</p>
          <label class="btn" for="profilePhoto">Upload profile picture</label>
          <input class="visually-hidden" id="profilePhoto" name="profilePhoto" type="file" accept="image/png,image/jpeg,image/webp">
          ${profile.photo ? '<button class="btn" type="button" data-action="remove-photo">Remove picture</button>' : ''}
        </section>
        <form class="panel" id="settingsForm" aria-labelledby="customizeTitle">
          <h2 id="customizeTitle">Customize profile</h2>
          <label class="field" for="profileName"><span>Full name</span>
            <input id="profileName" name="name" type="text" autocomplete="name" value="${esc(profile.name)}" required></label>
          <label class="field" for="profileEmail"><span>Email</span>
            <input id="profileEmail" name="email" type="email" autocomplete="email" value="${esc(profile.email)}" disabled></label>
          <label class="field" for="profileUsername"><span>Username</span>
            <input id="profileUsername" name="username" type="text" autocomplete="username" value="${esc(profile.username || '')}"></label>
          <button class="btn btn-primary" type="submit">Save profile</button>
        </form>
        <section class="panel" aria-labelledby="appearanceTitle">
          <h2 id="appearanceTitle">Appearance</h2>
          <button class="btn" type="button" data-action="toggle-dark" aria-pressed="${data.dark}">🌓 ${data.dark ? 'Switch to light mode' : 'Switch to dark mode'}</button>
        </section>
      </div>`;
  }

  const PAGE_RENDERERS = {
    dashboard: dashboardPage,
    residents: residentsPage,
    households: householdsPage,
    documents: documentsPage,
    complaints: complaintsPage,
    announcements: announcementsPage,
    reports: reportsPage,
    settings: settingsPage
  };

  /* -------------------------------------------------------------------
     7. Layout and render()
     ------------------------------------------------------------------- */

  function sidebar() {
    return `
      <aside class="sidebar ${state.sidebarOpen ? 'open' : ''}" id="sidebar" aria-label="Admin navigation">
        <header class="side-brand">
          <img src="${SEAL}" alt="Barangay Abang seal">
          <div><strong>Barangay Abang</strong><small>Admin Panel</small></div>
        </header>
        <nav class="side-nav" aria-label="Main navigation">
          <ul>
            ${Object.entries(PAGES).map(([slug, { label, icon }]) => `
              <li>
                <a class="nav-item ${state.page === slug ? 'active' : ''}" href="#${slug}" ${state.page === slug ? 'aria-current="page"' : ''}>
                  <span class="nav-icon" aria-hidden="true">${icon}</span><span>${esc(label)}</span>
                </a>
              </li>`).join('')}
          </ul>
        </nav>
        <div class="sidebar-bottom">
          <button class="nav-item" type="button" data-action="logout">
            <span class="nav-icon" aria-hidden="true">⇥</span><span>Logout</span>
          </button>
        </div>
      </aside>
      ${state.sidebarOpen ? '<div class="sidebar-backdrop" data-action="close-sidebar" aria-hidden="true"></div>' : ''}`;
  }

  function topbar() {
    const pendingDocs = data.documents.filter(d => d.status === 'Pending');
    const avatar = data.profile.photo
      ? `<img class="avatar" src="${esc(data.profile.photo)}" alt="">`
      : '<span class="avatar" aria-hidden="true">👤</span>';

    const notifBody = pendingDocs.length
      ? `<ul class="notif-list">
           ${pendingDocs.slice(0, 5).map(d => `
             <li>
               <button class="notif-item" type="button" data-action="open-pending">
                 <strong>${esc(d.type)}</strong>
                 <span>${esc(d.resident)} • ${esc(d.date)}</span>
               </button>
             </li>`).join('')}
         </ul>
         <button class="notif-all" type="button" data-action="open-pending">View all pending requests</button>`
      : '<p class="notif-empty">No pending document requests.</p>';

    return `
      <header class="topbar">
        <button class="mobile-menu" type="button" data-action="toggle-sidebar" aria-controls="sidebar"
          aria-label="${state.sidebarOpen ? 'Close menu' : 'Open menu'}" aria-expanded="${state.sidebarOpen}">☰</button>

        <form class="search-box" role="search" id="searchForm">
          <label for="globalSearch"><span aria-hidden="true">🔍</span><span class="visually-hidden">Search records</span></label>
          <input id="globalSearch" name="search" type="search" value="${esc(state.search)}" placeholder="Search..." autocomplete="off">
        </form>

        <span class="topbar-spacer"></span>

        <div class="notif-wrap">
          <button class="icon-btn" id="notifications" type="button" data-action="toggle-notifications"
            aria-controls="notifMenu" aria-expanded="${state.notifOpen}"
            aria-label="Notifications${pendingDocs.length ? `, ${pendingDocs.length} pending` : ''}">
            <span aria-hidden="true">🔔</span>
            ${pendingDocs.length ? `<span class="notif-badge" aria-hidden="true">${pendingDocs.length}</span>` : ''}
          </button>
          <section class="notif-menu ${state.notifOpen ? 'open' : ''}" id="notifMenu" aria-label="Pending requests" ${state.notifOpen ? '' : 'hidden'}>
            <h2 class="notif-title">Pending requests</h2>
            ${notifBody}
          </section>
        </div>

        <div class="profile-wrap">
          <button class="profile-trigger" id="profileTrigger" type="button" data-action="toggle-profile-menu"
            aria-controls="profileMenu" aria-expanded="${state.profileMenuOpen}">
            ${avatar}
            <span class="profile-name">${esc(data.profile.name)}</span>
            <span class="caret" aria-hidden="true">▼</span>
          </button>
          <div class="profile-menu ${state.profileMenuOpen ? 'open' : ''}" id="profileMenu">
            <p class="menu-user">${esc(data.profile.name)}</p>
            <button type="button" data-action="go" data-page="settings">👤 Customize profile</button>
            <button type="button" data-action="toggle-dark" aria-pressed="${data.dark}">🌓 ${data.dark ? 'Light' : 'Dark'} mode</button>
            <button type="button" data-action="logout">🚪 Log out</button>
          </div>
        </div>
      </header>`;
  }

  function render() {
    // Remember whether the search box had focus so typing is not interrupted.
    const searchFocused = document.activeElement?.id === 'globalSearch';
    const caret = searchFocused ? document.activeElement.selectionStart : null;

    document.body.classList.toggle('theme-dark', data.dark);
    const content = (PAGE_RENDERERS[state.page] || dashboardPage)();
    const previewNote = state.preview
      ? '<p class="panel preview-note" role="note">Preview mode: sign in with the allowlisted admin account to load live Supabase records. Changes here are saved in this browser only.</p>'
      : '';

    root.innerHTML = `
      ${sidebar()}
      <div class="app-main">
        ${topbar()}
        <main class="page-content" id="main" tabindex="-1">
          ${previewNote}
          ${content}
        </main>
      </div>`;

    if (searchFocused) {
      const search = root.querySelector('#globalSearch');
      search.focus();
      if (caret !== null) search.setSelectionRange(caret, caret);
    }
  }

  /* -------------------------------------------------------------------
     8. Modals
     ------------------------------------------------------------------- */

  function closeModal() {
    if (!modalRoot.hasChildNodes()) return;
    modalRoot.replaceChildren();
    if (state.lastFocus?.isConnected) state.lastFocus.focus();
    state.lastFocus = null;
  }

  function showModal(html) {
    state.lastFocus = document.activeElement;
    modalRoot.innerHTML = `<div class="modal-backdrop" data-action="modal-backdrop">${html}</div>`;
    const firstField = modalRoot.querySelector('.modal input:not([type=hidden]), .modal select, .modal textarea');
    (firstField || modalRoot.querySelector('.modal-actions button:last-child'))?.focus();
  }

  /* A form modal. onSave returns false to keep it open, a string for a custom toast. */
  function openFormModal(title, fields, onSave) {
    showModal(`
      <form class="modal" id="editForm" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <header class="modal-head">
          <h2 id="modalTitle">${esc(title)}</h2>
          <button class="modal-close" type="button" data-action="close-modal" aria-label="Close">×</button>
        </header>
        ${fields}
        <div class="modal-actions">
          <button class="btn" type="button" data-action="close-modal">Cancel</button>
          <button class="primary-btn" type="submit">Save</button>
        </div>
      </form>`);

    const form = modalRoot.querySelector('#editForm');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = form.querySelector('[type=submit]');
      submit.disabled = true;
      submit.textContent = 'Saving…';
      try {
        const values = Object.fromEntries(new FormData(form).entries());
        const result = await onSave(values);
        if (result === false) return;
        modalRoot.replaceChildren();
        render();
        toast(typeof result === 'string' ? result : 'Changes saved.');
      } catch (error) {
        console.error(error);
        toast(error.message || 'Something went wrong.');
      } finally {
        if (submit.isConnected) {
          submit.disabled = false;
          submit.textContent = 'Save';
        }
      }
    });
  }

  const textField = (name, label, value = '', type = 'text', required = true) => {
    const autocomplete = { name: 'name', birthday: 'bday', contact: 'tel', email: 'email' }[name];
    return `
      <label class="field" for="${esc(name)}Input"><span>${label}</span>
        <input id="${esc(name)}Input" name="${esc(name)}" type="${type}" value="${esc(value)}"${autocomplete ? ` autocomplete="${autocomplete}"` : ''}${required ? ' required' : ''}>
      </label>`;
  };

  const sitioSelect = selected => `
    <label class="field" for="sitioInput"><span>Sitio</span>
      <select id="sitioInput" name="sitio" required>
        <option value="">Select a sitio</option>
        ${SITIOS.map(s => `<option value="${esc(s)}" ${selected === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
      </select>
    </label>`;

  function openResidentModal(index = null) {
    const isEdit = index !== null;
    const record = isEdit ? data.residents[index] : {};
    openFormModal(isEdit ? 'Edit resident' : 'Add a Resident',
      textField('name', 'Full name', record.name || '') +
      textField('birthday', 'Birthday', record.birthday || '', 'date') +
      textField('contact', 'Contact number', record.contact || '', 'tel') +
      textField('household_number', 'Household number', record.household_number || '') +
      sitioSelect(record.sitio) +
      textField('email', 'Email (optional)', record.email || '', 'email', false),
      values => saveResident(values, isEdit, record, index));
  }

  function openAnnouncementModal(index = null) {
    const isEdit = index !== null;
    const a = isEdit ? data.announcements[index] : {};
    openFormModal(isEdit ? 'Edit announcement' : 'Add announcement',
      textField('title', 'Title', a.title || '') +
      `<label class="field" for="bodyInput"><span>Message</span>
         <textarea id="bodyInput" name="body" rows="4" required>${esc(a.body || '')}</textarea></label>
       <label class="field" for="typeInput"><span>Type</span>
         <select id="typeInput" name="type">
           <option ${a.type !== 'Event' ? 'selected' : ''}>Announcement</option>
           <option ${a.type === 'Event' ? 'selected' : ''}>Event</option>
         </select></label>`,
      values => saveAnnouncement(values, isEdit, a, index));
  }

  function openStatusModal(type, index) {
    const collection = type === 'document' ? data.documents : data.complaints;
    const current = collection[index];
    const options = type === 'document' ? DOCUMENT_STATUSES : COMPLAINT_STATUSES;
    openFormModal('Update status',
      `<p>${esc(String(current.id).slice(0, 8))} — ${esc(current.resident)}</p>
       <label class="field" for="statusInput"><span>Status</span>
         <select id="statusInput" name="status">${options.map(s => `<option ${s === current.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
       <label class="field" for="notesInput"><span>Admin notes (sent to the resident)</span>
         <textarea id="notesInput" name="notes" rows="3">${esc(current.notes || '')}</textarea></label>`,
      values => saveStatus(type, current, values));
  }

  function openRecordModal(type, index) {
    const collection = { resident: data.residents, document: data.documents, complaint: data.complaints }[type];
    const record = collection?.[index];
    if (!record) return;

    const label = key => key.replace(/_/g, ' ').replace(/[A-Z]/g, ' $&').replace(/^./, c => c.toUpperCase());
    const details = Object.entries(record)
      .filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
      .map(([k, v]) => `<div><dt>${esc(label(k))}</dt><dd>${esc(v ?? '—')}</dd></div>`)
      .join('');
    const canDelete = type === 'resident' && record.source === 'resident';
    const canEdit = type !== 'resident' || record.source === 'resident';

    showModal(`
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <header class="modal-head">
          <h2 id="modalTitle">Record details</h2>
          <button class="modal-close" type="button" data-action="close-modal" aria-label="Close">×</button>
        </header>
        <dl class="record-details">${details}</dl>
        <div class="modal-actions">
          ${canDelete ? `<button class="btn btn-danger" type="button" data-action="delete-resident" data-index="${index}">Delete resident</button>` : ''}
          ${canEdit ? `<button class="btn" type="button" data-action="edit" data-type="${type}" data-index="${index}">${type === 'resident' ? 'Edit' : 'Update status'}</button>` : ''}
          <button class="btn" type="button" data-action="close-modal">Close</button>
        </div>
      </section>`);
  }

  /* -------------------------------------------------------------------
     9. Actions
     ------------------------------------------------------------------- */

  async function saveResident(values, isEdit, record, index) {
    let birthday = values.birthday || '';
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(birthday)) {
      const [mm, dd, yyyy] = birthday.split('/');
      birthday = `${yyyy}-${mm}-${dd}`;
    }
    const payload = {
      name: values.name.trim(),
      birthday,
      contact: values.contact.trim(),
      email: values.email.trim().toLowerCase(),
      household_number: values.household_number.trim(),
      sitio: values.sitio.trim()
    };

    if (state.isAdmin) {
      const { error } = await sb.rpc('admin_save_resident', {
        p_resident_id: isEdit && record.source === 'resident' ? record.id : null,
        p_full_name: payload.name,
        p_birthday: payload.birthday,
        p_contact_number: payload.contact,
        p_email: payload.email || null,
        p_household_number: payload.household_number,
        p_sitio: payload.sitio || null
      });
      if (error) {
        toast(`Could not save resident: ${error.message}`);
        return false;
      }
      if (payload.email) {
        const { error: profileError } = await sb.from('profiles').update({ full_name: payload.name }).eq('email', payload.email);
        if (profileError) toast(`Resident saved, but profile name could not be synced: ${profileError.message}`);
      }
      await refreshLiveData();
    } else {
      const resident = {
        ...record,
        ...payload,
        id: isEdit ? record.id : `preview-${Date.now()}`,
        source: 'resident',
        date: record.date || new Date().toISOString()
      };
      if (isEdit) data.residents[index] = resident;
      else data.residents.unshift(resident);
      rebuildPreviewHouseholds();
      rebuildActivities();
      savePreviewRecords();
    }
    return isEdit ? 'Resident updated.' : `Resident saved: ${payload.name}`;
  }

  async function saveAnnouncement(values, isEdit, current, index) {
    const base = { title: values.title.trim(), body: values.body.trim(), kind: values.type };

    if (!state.isAdmin) {
      const now = new Date().toISOString();
      const record = { ...current, ...base, type: base.kind, id: current.id || `preview-${Date.now()}`, published: true, published_at: current.published_at || now, created_at: current.created_at || now, date: shortDate(current.published_at || now) };
      if (isEdit) data.announcements[index] = record;
      else data.announcements.unshift(record);
      rebuildActivities();
      savePreviewRecords();
      return isEdit ? 'Announcement updated (preview).' : 'Announcement added (preview).';
    }

    let result;
    if (isEdit) {
      // Editing keeps the original publish date and does not email everyone again.
      result = await sb.from('announcements').update({ ...base, published: true }).eq('id', current.id).select('id').single();
    } else {
      const { data: { user } } = await sb.auth.getUser();
      result = await sb.from('announcements')
        .insert({ ...base, published: true, published_at: new Date().toISOString(), created_by: user?.id })
        .select('id')
        .single();
    }
    if (result.error) {
      toast(`Could not save announcement: ${result.error.message}`);
      return false;
    }

    await refreshLiveData();
    if (isEdit) return 'Announcement updated.';
    const delivery = await notifyUsers('announcement', result.data.id);
    return delivery.error
      ? `Announcement saved, but email failed: ${delivery.error}`
      : `Announcement saved; sent ${plural(delivery.sent, 'email')}.`;
  }

  async function saveStatus(type, current, values) {
    const notes = values.notes || '';
    const changed = values.status !== current.status || notes !== (current.notes || '');
    if (!changed) return 'No changes to save.';

    if (!state.isAdmin) {
      current.status = values.status;
      current.notes = notes;
      return 'Status updated (preview, no email sent).';
    }

    const tableName = type === 'document' ? 'document_requests' : 'complaints';
    const { error } = await sb.from(tableName).update({ status: values.status, admin_notes: notes || null }).eq('id', current.id);
    if (error) {
      toast(`Could not save status: ${error.message}`);
      return false;
    }
    await refreshLiveData();
    const delivery = await notifyUsers(type === 'document' ? 'document_status' : 'complaint_status', current.id);
    return delivery.error
      ? `Saved, but email could not be sent: ${delivery.error}`
      : `Saved and sent ${plural(delivery.sent, 'email update')}.`;
  }

  async function deleteResident(index) {
    const record = data.residents[index];
    if (!record || record.source !== 'resident') {
      toast('Only a saved resident record can be deleted here.');
      return;
    }
    if (!window.confirm(`Delete the saved resident record for ${record.name || 'this resident'}?`)) return;

    if (state.isAdmin) {
      const { data: deleted, error } = await sb.rpc('admin_delete_resident', { p_resident_id: record.id });
      if (error) {
        const missing = error.code === 'PGRST202' || /admin_delete_resident|schema cache/i.test(error.message || '');
        toast(missing
          ? 'Resident deletion is not enabled in Supabase yet. Run supabase/admin-delete-resident.sql in the project SQL Editor, then refresh.'
          : `Could not delete resident: ${error.message}`);
        return;
      }
      if (!deleted) {
        toast('No saved resident record matched this ID.');
        return;
      }
      await refreshLiveData();
    } else {
      data.residents.splice(index, 1);
      rebuildPreviewHouseholds();
      rebuildActivities();
      savePreviewRecords();
    }
    closeModal();
    render();
    toast('Saved resident record deleted.');
  }

  const EXPORTS = {
    documents: () => [
      ['ID', 'Resident', 'Type', 'Purpose', 'Date', 'Status', 'Admin notes'],
      ...data.documents.map(d => [d.id, d.resident, d.type, d.purpose, d.date, d.status, d.notes])
    ],
    complaints: () => [
      ['ID', 'Complainant', 'Subject', 'Details', 'Date', 'Status', 'Admin notes'],
      ...data.complaints.map(c => [c.id, c.resident, c.subject, c.details, c.date, c.status, c.notes])
    ],
    residents: () => [
      ['ID', 'Name', 'Household No.', 'Sitio', 'Birthday', 'Contact', 'Email', 'Source'],
      ...data.residents.map(r => [r.id, r.name, r.household_number, r.sitio, r.birthday, r.contact, r.email, r.source])
    ]
  };

  function exportCsv(kind) {
    const rows = EXPORTS[kind]?.();
    if (!rows) return;
    if (rows.length === 1) {
      toast(`There are no ${kind} to export yet.`);
      return;
    }
    const csv = rows.map(row => row.map(cell => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `barangay-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Exported ${plural(rows.length - 1, 'row')}.`);
  }

  function printReport() {
    if (state.page !== 'reports') {
      goTo('reports');
      setTimeout(() => window.print(), 300);
      return;
    }
    window.print();
  }

  async function saveSettings(form) {
    const full_name = form.elements.name.value.trim();
    const username = form.elements.username.value.trim();
    if (!full_name) {
      toast('Please enter your full name.');
      return;
    }

    if (state.isAdmin) {
      const { error } = await sb.from('profiles').update({ full_name, username }).eq('id', data.profile.id);
      if (error) {
        toast(`Could not update profile: ${error.message}`);
        return;
      }
    }
    data.profile.name = full_name;
    data.profile.username = username;
    render();
    toast(state.isAdmin ? 'Profile updated.' : 'Profile updated (preview).');
  }

  function uploadPhoto(input) {
    const file = input.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast('Choose a PNG, JPG, or WebP image.');
      input.value = '';
      return;
    }
    if (file.size > 1.5 * 1024 * 1024) {
      toast('Choose an image smaller than 1.5 MB.');
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      data.profile.photo = reader.result;
      try {
        localStorage.setItem(PHOTO_KEY, reader.result);
        toast('Profile picture saved in this browser.');
      } catch {
        toast('Profile picture shown for now, but it is too large to remember after reload.');
      }
      render();
    };
    reader.readAsDataURL(file);
  }

  function removePhoto() {
    data.profile.photo = '';
    localStorage.removeItem(PHOTO_KEY);
    render();
    toast('Profile picture removed.');
  }

  async function logout(button) {
    if (button) button.disabled = true;
    try {
      if (sb) await sb.auth.signOut();
    } finally {
      window.location.href = '../login/index.html';
    }
  }

  async function refreshNow() {
    if (!state.isAdmin) {
      toast('Preview mode has no live records to refresh.');
      return;
    }
    await refreshLiveData();
    render();
    toast('Live records refreshed.');
  }

  function toggleMenu(key) {
    const next = !state[key];
    state.profileMenuOpen = false;
    state.notifOpen = false;
    state[key] = next;
    render();
    if (next) root.querySelector(key === 'notifOpen' ? '#notifMenu button, #notifMenu' : '#profileMenu button')?.focus();
  }

  /* -------------------------------------------------------------------
     10. Event wiring (attached once; elements are re-rendered freely)
     ------------------------------------------------------------------- */

  const clickActions = {
    'go': el => goTo(el.dataset.page),
    'filter': el => { state.filter = el.dataset.filter; render(); },
    'refresh': () => refreshNow(),
    'add-resident': () => openResidentModal(),
    'add-announcement': () => openAnnouncementModal(),
    'view': el => openRecordModal(el.dataset.type, Number(el.dataset.index)),
    'edit': el => {
      const { type } = el.dataset;
      const index = Number(el.dataset.index);
      if (type === 'document' || type === 'complaint') openStatusModal(type, index);
      else if (type === 'announcement') openAnnouncementModal(index);
      // Saving a signed-up profile here creates its resident record.
      else if (type === 'resident') openResidentModal(index);
    },
    'delete-resident': el => deleteResident(Number(el.dataset.index)),
    'close-modal': () => closeModal(),
    'modal-backdrop': (el, event) => { if (event.target === el) closeModal(); },
    'toggle-profile-menu': () => toggleMenu('profileMenuOpen'),
    'toggle-notifications': () => toggleMenu('notifOpen'),
    'open-pending': () => { state.filter = 'Pending'; goTo('documents', { keepFilter: true }); },
    'toggle-dark': () => { data.dark = !data.dark; saveTheme(); render(); },
    'toggle-sidebar': () => { state.sidebarOpen = !state.sidebarOpen; render(); },
    'close-sidebar': () => { state.sidebarOpen = false; render(); },
    'export': el => exportCsv(el.dataset.export),
    'print-report': () => printReport(),
    'remove-photo': () => removePhoto(),
    'logout': el => logout(el)
  };

  document.addEventListener('click', event => {
    const el = event.target.closest('[data-action]');

    // Clicking outside an open menu closes it.
    if ((state.profileMenuOpen || state.notifOpen) &&
        !event.target.closest('.profile-wrap, .notif-wrap')) {
      // Update the DOM directly so a link clicked at the same time still works.
      state.profileMenuOpen = false;
      state.notifOpen = false;
      root.querySelector('#profileMenu')?.classList.remove('open');
      root.querySelector('#notifMenu')?.classList.remove('open');
      root.querySelector('#notifMenu')?.setAttribute('hidden', '');
      root.querySelector('#profileTrigger')?.setAttribute('aria-expanded', 'false');
      root.querySelector('#notifications')?.setAttribute('aria-expanded', 'false');
    }

    if (!el) return;
    const action = clickActions[el.dataset.action];
    if (action) action(el, event);
  });

  document.addEventListener('submit', event => {
    if (event.target.id === 'searchForm') {
      event.preventDefault();
      return;
    }
    if (event.target.id === 'settingsForm') {
      event.preventDefault();
      saveSettings(event.target);
    }
  });

  document.addEventListener('input', event => {
    if (event.target.id !== 'globalSearch') return;
    state.search = event.target.value;
    // Searching from a page without a list jumps to Residents.
    if (!SEARCHABLE_PAGES.includes(state.page) && state.search) {
      state.page = 'residents';
      history.replaceState(null, '', '#residents');
    }
    render();
  });

  document.addEventListener('change', event => {
    if (event.target.id === 'householdSitioFilter') {
      state.householdSitioFilter = event.target.value;
      render();
    }
    if (event.target.id === 'profilePhoto') uploadPhoto(event.target);
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (modalRoot.hasChildNodes()) closeModal();
    else if (state.profileMenuOpen || state.notifOpen || state.sidebarOpen) {
      const reopen = state.profileMenuOpen ? '#profileTrigger' : state.notifOpen ? '#notifications' : '.mobile-menu';
      closePopups();
      render();
      root.querySelector(reopen)?.focus();
    }
  });

  window.addEventListener('hashchange', () => {
    const options = pendingNavOptions || {};
    pendingNavOptions = null;
    showPage(pageFromHash(), options);
  });

  /* -------------------------------------------------------------------
     11. Boot
     ------------------------------------------------------------------- */

  async function initialize() {
    const preview = new URLSearchParams(location.search).get('preview') === '1';
    state.page = pageFromHash();

    if (!sb) {
      if (!preview) {
        root.innerHTML = '<main class="page-content"><p class="panel">Online services are unavailable. Check your internet connection and reload, or <a href="?preview=1">open the preview</a>.</p></main>';
        return;
      }
    }

    const session = sb ? (await sb.auth.getSession()).data.session : null;
    if (!session && !preview) {
      window.location.replace('../login/index.html');
      return;
    }

    if (session) {
      const { data: isAdmin, error } = await sb.rpc('is_admin');
      if (error || isAdmin !== true) {
        await sb.auth.signOut();
        window.location.replace('../login/index.html?unauthorized=1');
        return;
      }
      state.isAdmin = true;
      data.profile.id = session.user.id;
      data.profile.email = session.user.email || '';
      data.profile.name = session.user.user_metadata?.full_name || session.user.email || 'Admin';

      const { data: profile } = await sb.from('profiles').select('full_name,username').eq('id', session.user.id).maybeSingle();
      if (profile) {
        data.profile.name = profile.full_name || data.profile.name;
        data.profile.username = profile.username || '';
      }
      await refreshLiveData();
    } else {
      state.preview = true;
      loadPreviewRecords();
    }

    render();
  }

  initialize();
})();
