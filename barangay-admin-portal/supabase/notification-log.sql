-- Run once in the Supabase SQL Editor for the Barangay Abang project.
-- Email delivery details are server-only; browser roles cannot read or write this table.
begin;

create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null,
  record_id text not null,
  recipient_email text not null,
  delivery_status text not null check (delivery_status in ('sent', 'failed')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notification_log_record_idx
  on public.notification_log (notification_type, record_id, created_at desc);
create index if not exists notification_log_status_idx
  on public.notification_log (delivery_status, created_at desc);

alter table public.notification_log enable row level security;
revoke all on public.notification_log from public, anon, authenticated;
grant all on public.notification_log to service_role;

commit;
