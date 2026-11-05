-- Run this once in the Supabase SQL Editor to enable deletion of saved residents.
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
