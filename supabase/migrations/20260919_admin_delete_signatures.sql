-- Run once in the existing Supabase project's SQL Editor.
-- Only authenticated users listed in public.admin_users may delete signatures.

grant delete on public.signatures to authenticated;

drop policy if exists "Admins delete signatures" on public.signatures;
create policy "Admins delete signatures"
on public.signatures for delete
to authenticated
using (public.is_admin());
