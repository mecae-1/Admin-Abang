import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

function readSupabaseKey(legacyName: string, modernSingleName: string, modernMapName: string): string {
  const legacy = Deno.env.get(legacyName);
  if (legacy) return legacy;
  const single = Deno.env.get(modernSingleName);
  if (single) return single;
  const mapValue = Deno.env.get(modernMapName);
  if (!mapValue) return "";
  try {
    const parsed = JSON.parse(mapValue);
    if (parsed && typeof parsed === "object") {
      const values = Object.values(parsed).filter((value): value is string => typeof value === "string" && value.length > 0);
      return (typeof parsed.default === "string" && parsed.default) || values[0] || "";
    }
  } catch {
    // Some older Supabase projects expose a single string rather than a JSON key map.
    return mapValue;
  }
  return "";
}

const SUPABASE_ANON_KEY = readSupabaseKey("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEYS");
const SUPABASE_SERVICE_KEY = readSupabaseKey("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_SECRET_KEYS");

const ALLOWED_ORIGINS = new Set([
  "https://mecae-1.github.io",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

function jsonResponse(body: Record<string, unknown>, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] ?? char).replace(/\r?\n/g, "<br>");
}

function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64Url(value: string): string {
  return utf8Base64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodedHeader(value: string): string {
  return `=?UTF-8?B?${utf8Base64(value.replace(/[\r\n]/g, " "))}?=`;
}

function pageUrl(section: string): string {
  const configured = Deno.env.get("PUBLIC_SITE_URL");
  if (!configured) throw new Error("Missing PUBLIC_SITE_URL Supabase secret.");
  const url = new URL(configured);
  url.hash = `#${section}`;
  return url.toString();
}

function emailHtml(title: string, intro: string, rows: Array<[string, unknown]>, section: string): string {
  const details = rows.map(([label, value]) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;color:#526174;font-weight:600;vertical-align:top;width:34%">${escapeHtml(label)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e8edf3;color:#172033;vertical-align:top">${escapeHtml(value) || "—"}</td>
    </tr>`).join("");
  const link = escapeHtml(pageUrl(section));
  return `<!doctype html><html><body style="margin:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#172033">
    <div style="max-width:620px;margin:28px auto;padding:0 14px">
      <div style="background:#123b70;color:#fff;padding:22px 24px;border-radius:12px 12px 0 0">
        <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:.85">Barangay Abang</div>
        <h1 style="font-size:22px;line-height:1.3;margin:8px 0 0">${escapeHtml(title)}</h1>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #e7ebf0;border-top:0;border-radius:0 0 12px 12px">
        <p style="font-size:15px;line-height:1.6;margin:0 0 18px">${escapeHtml(intro)}</p>
        <table role="presentation" style="border-collapse:collapse;width:100%;font-size:14px">${details}</table>
        <p style="margin:24px 0 10px"><a href="${link}" style="display:inline-block;background:#1769aa;color:#fff;text-decoration:none;padding:12px 18px;border-radius:7px;font-weight:600">Open Barangay Abang Portal</a></p>
        <p style="font-size:12px;color:#687589;line-height:1.5;margin:20px 0 0">This is an automated notification from the Barangay Abang system. Please do not reply to this email.</p>
      </div>
    </div>
  </body></html>`;
}

async function getGoogleAccessToken(): Promise<string> {
  const clientId = Deno.env.get("GMAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GMAIL_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing Gmail OAuth secrets. Check GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in Supabase.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    console.error("Gmail OAuth refresh failed:", payload.error ?? response.status);
    throw new Error("Gmail authorization failed. Check the OAuth credentials and refresh token in Supabase.");
  }
  return payload.access_token as string;
}

async function sendGmail(accessToken: string, sender: string, recipient: string, subject: string, html: string) {
  const safeSender = sender.replace(/[\r\n<>]/g, "");
  const safeRecipient = recipient.replace(/[\r\n<>]/g, "");
  const mime = [
    `From: Barangay Abang <${safeSender}>`,
    `To: ${safeRecipient}`,
    `Subject: ${encodedHeader(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    html,
  ].join("\r\n");

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: base64Url(mime) }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload?.error?.message || `Gmail API returned HTTP ${response.status}`;
    throw new Error(String(message).slice(0, 900));
  }
}

async function sendWithConcurrency<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      await task(items[index]);
    }
  });
  await Promise.all(workers);
}

Deno.serve(async (req: Request) => {
  const requestOrigin = req.headers.get("origin") ?? "https://mecae-1.github.io";
  const originAllowed = ALLOWED_ORIGINS.has(requestOrigin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(originAllowed ? requestOrigin : "https://mecae-1.github.io") });
  }
  if (!originAllowed) return jsonResponse({ error: "Origin not allowed." }, 403, "https://mecae-1.github.io");
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405, requestOrigin);

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
      throw new Error("Supabase function environment is incomplete. Check the project secrets and built-in Supabase environment variables.");
    }

    const authorization = req.headers.get("Authorization") ?? "";
    const jwt = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!jwt) return jsonResponse({ error: "Sign in as an approved admin first." }, 401, requestOrigin);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return jsonResponse({ error: "Your session is invalid or expired. Sign in again." }, 401, requestOrigin);

    const { data: isAdmin, error: adminCheckError } = await userClient.rpc("is_admin");
    if (adminCheckError || isAdmin !== true) return jsonResponse({ error: "Only an approved admin can send these notifications." }, 403, requestOrigin);

    const body = await req.json().catch(() => ({}));
    const type = body?.type;
    const recordId = typeof body?.recordId === "string" ? body.recordId.trim() : "";
    if (!recordId || !["announcement", "complaint_status", "document_status"].includes(type)) {
      return jsonResponse({ error: "Invalid notification type or record ID." }, 400, requestOrigin);
    }

    const serviceDb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let recipients: Array<{ id: string; email: string; full_name: string | null }> = [];
    let subject = "";
    let html = "";
    let section = "";

    if (type === "complaint_status") {
      const { data: item, error } = await serviceDb.from("complaints")
        .select("id,user_id,subject,details,status,admin_notes")
        .eq("id", recordId).maybeSingle();
      if (error) throw new Error(`Could not load complaint: ${error.message}`);
      if (!item) return jsonResponse({ error: "Complaint not found." }, 404, requestOrigin);
      if (!item.user_id) return jsonResponse({ error: "Complaint has no submitting user." }, 422, requestOrigin);
      const { data: profile, error: profileError } = await serviceDb.from("profiles")
        .select("id,email,full_name").eq("id", item.user_id).maybeSingle();
      if (profileError) throw new Error(`Could not load complaint owner: ${profileError.message}`);
      if (profile?.email) recipients = [profile];
      subject = `Barangay Abang complaint update: ${item.subject || "Your complaint"}`;
      html = emailHtml("Complaint status update", "There is an update to the complaint you submitted.", [
        ["Subject", item.subject], ["Status", item.status], ["Details", item.details], ["Admin notes", item.admin_notes],
      ], "complaints");
      section = "complaints";
    } else if (type === "document_status") {
      const { data: item, error } = await serviceDb.from("document_requests")
        .select("id,user_id,document_type,purpose,details,status,admin_notes")
        .eq("id", recordId).maybeSingle();
      if (error) throw new Error(`Could not load document request: ${error.message}`);
      if (!item) return jsonResponse({ error: "Document request not found." }, 404, requestOrigin);
      if (!item.user_id) return jsonResponse({ error: "Document request has no submitting user." }, 422, requestOrigin);
      const { data: profile, error: profileError } = await serviceDb.from("profiles")
        .select("id,email,full_name").eq("id", item.user_id).maybeSingle();
      if (profileError) throw new Error(`Could not load document requester: ${profileError.message}`);
      if (profile?.email) recipients = [profile];
      subject = `Barangay Abang document request update: ${item.document_type || "Your request"}`;
      html = emailHtml("Document request update", "There is an update to the document request you submitted.", [
        ["Document type", item.document_type], ["Purpose", item.purpose], ["Status", item.status], ["Details", item.details], ["Admin notes", item.admin_notes],
      ], "documents");
      section = "documents";
    } else {
      const { data: item, error } = await serviceDb.from("announcements")
        .select("id,title,body,kind,published").eq("id", recordId).maybeSingle();
      if (error) throw new Error(`Could not load announcement: ${error.message}`);
      if (!item) return jsonResponse({ error: "Announcement not found." }, 404, requestOrigin);
      if (item.published !== true) return jsonResponse({ error: "Only published announcements can be emailed." }, 409, requestOrigin);
      const { data: profiles, error: profilesError } = await serviceDb.from("profiles")
        .select("id,email,full_name")
        .not("email", "is", null)
        .neq("id", authData.user.id)
        .order("created_at", { ascending: true })
        .limit(500);
      if (profilesError) throw new Error(`Could not load registered users: ${profilesError.message}`);
      recipients = (profiles ?? []).filter((p) => typeof p.email === "string" && p.email.trim());
      subject = `Barangay Abang announcement: ${item.title || "New announcement"}`;
      html = emailHtml("New barangay announcement", "A new announcement has been published by Barangay Abang.", [
        ["Title", item.title], ["Category", item.kind], ["Announcement", item.body],
      ], "announcements");
      section = "announcements";
    }

    const unique = new Map<string, { id: string; email: string; full_name: string | null }>();
    for (const recipient of recipients) {
      const email = recipient.email?.trim();
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) unique.set(email.toLowerCase(), { ...recipient, email });
    }
    recipients = [...unique.values()];
    if (!recipients.length) {
      return jsonResponse({ sent: 0, failed: 0, message: "No valid recipient email address was found." }, 200, requestOrigin);
    }

    const sender = Deno.env.get("GMAIL_SENDER_EMAIL")?.trim();
    if (!sender || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender)) {
      throw new Error("GMAIL_SENDER_EMAIL is missing or invalid in Supabase secrets.");
    }
    const accessToken = await getGoogleAccessToken();
    const logRows: Array<Record<string, unknown>> = [];
    let sent = 0;
    let failed = 0;

    await sendWithConcurrency(recipients, 4, async (recipient) => {
      try {
        await sendGmail(accessToken, sender, recipient.email, subject, html);
        sent++;
        logRows.push({ notification_type: type, record_id: recordId, recipient_email: recipient.email, delivery_status: "sent", error_message: null, sent_at: new Date().toISOString() });
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : "Unknown Gmail delivery error";
        console.error(`Email delivery failed for ${recipient.email}:`, message);
        logRows.push({ notification_type: type, record_id: recordId, recipient_email: recipient.email, delivery_status: "failed", error_message: message.slice(0, 1000), sent_at: null });
      }
    });

    const { error: logError } = await serviceDb.from("notification_log").insert(logRows);
    if (logError) console.error("Could not write notification_log:", logError.message);

    return jsonResponse({ sent, failed, type, section }, 200, requestOrigin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected notification error.";
    console.error("notify-users error:", message);
    return jsonResponse({ error: message }, 500, requestOrigin);
  }
});
