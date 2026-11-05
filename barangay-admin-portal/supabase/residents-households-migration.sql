-- Adds persistent admin-managed resident records and household grouping.
-- Run once in the Supabase SQL Editor for the Barangay Abang project.
begin;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  household_number text not null unique,
  sitio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint households_number_not_blank check (length(trim(household_number)) > 0)
);

create table if not exists public.residents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete restrict,
  full_name text not null,
  birthday date not null,
  contact_number text not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint residents_name_not_blank check (length(trim(full_name)) > 0),
  constraint residents_contact_not_blank check (length(trim(contact_number)) > 0)
);

create index if not exists residents_household_idx on public.residents(household_id, full_name);
create index if not exists residents_email_idx on public.residents(lower(email)) where email is not null;

alter table public.households enable row level security;
alter table public.residents enable row level security;
revoke all on public.households, public.residents from anon, authenticated;
grant select on public.households, public.residents to authenticated;

drop policy if exists households_read_admin on public.households;
create policy households_read_admin on public.households for select to authenticated
using (public.is_admin());
drop policy if exists residents_read_admin on public.residents;
create policy residents_read_admin on public.residents for select to authenticated
using (public.is_admin());

create or replace function public.admin_save_resident(
  p_resident_id uuid,
  p_full_name text,
  p_birthday date,
  p_contact_number text,
  p_email text,
  p_household_number text,
  p_sitio text
)
returns table (
  id uuid,
  full_name text,
  birthday date,
  contact_number text,
  email text,
  household_id uuid,
  household_number text,
  sitio text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_resident_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an approved admin can manage resident records';
  end if;
  if nullif(trim(p_full_name), '') is null
     or nullif(trim(p_contact_number), '') is null
     or nullif(trim(p_household_number), '') is null
     or p_birthday is null then
    raise exception 'Full name, birthday, contact number, and household number are required';
  end if;

  insert into public.households as h (household_number, sitio)
  values (trim(p_household_number), nullif(trim(coalesce(p_sitio, '')), ''))
  on conflict on constraint households_household_number_key do update
    set sitio = coalesce(nullif(trim(excluded.sitio), ''), h.sitio), updated_at = now()
  returning h.id into v_household_id;

  if p_resident_id is null then
    insert into public.residents as r (household_id, full_name, birthday, contact_number, email)
    values (v_household_id, trim(p_full_name), p_birthday, trim(p_contact_number), nullif(lower(trim(coalesce(p_email, ''))), ''))
    returning r.id into v_resident_id;
  else
    update public.residents as r
       set household_id = v_household_id,
           full_name = trim(p_full_name),
           birthday = p_birthday,
           contact_number = trim(p_contact_number),
           email = nullif(lower(trim(coalesce(p_email, ''))), ''),
           updated_at = now()
     where r.id = p_resident_id
     returning r.id into v_resident_id;
    if v_resident_id is null then
      raise exception 'Resident record not found';
    end if;
  end if;

  return query
  select r.id, r.full_name, r.birthday, r.contact_number, r.email,
         h.id, h.household_number, h.sitio
    from public.residents r
    join public.households h on h.id = r.household_id
   where r.id = v_resident_id;
end;
$$;

revoke all on function public.admin_save_resident(uuid, text, date, text, text, text, text) from public, anon;
grant execute on function public.admin_save_resident(uuid, text, date, text, text, text, text) to authenticated;

create or replace function public.admin_delete_resident(p_resident_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an approved admin can manage resident records';
  end if;

  delete from public.residents where id = p_resident_id;
  return found;
end;
$$;

revoke all on function public.admin_delete_resident(uuid) from public, anon;
grant execute on function public.admin_delete_resident(uuid) to authenticated;

commit;
