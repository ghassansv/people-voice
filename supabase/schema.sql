-- صوت الناس: مخطط قاعدة البيانات الآمن لمشروع Supabase مستقل.
-- شغّل هذا الملف كاملًا مرة واحدة من Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  headline text not null check (char_length(headline) between 2 and 160),
  letter_title text not null check (char_length(letter_title) between 2 and 180),
  letter_body text not null check (char_length(letter_body) between 20 and 10000),
  version integer not null default 1 check (version > 0),
  is_active boolean not null default true,
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists campaigns_one_active_idx
  on public.campaigns ((is_active))
  where is_active = true;

create table if not exists public.campaign_versions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  version integer not null,
  headline text not null,
  letter_title text not null,
  letter_body text not null,
  created_at timestamptz not null default now(),
  unique (campaign_id, version)
);

create table if not exists public.signatures (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  campaign_version integer not null check (campaign_version > 0),
  full_name text not null check (char_length(full_name) between 2 and 100),
  mobile text check (mobile is null or char_length(mobile) between 5 and 30),
  address text check (address is null or char_length(address) <= 180),
  consented_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists signatures_unique_mobile_idx
  on public.signatures (campaign_id, mobile)
  where mobile is not null;

create index if not exists signatures_campaign_created_idx
  on public.signatures (campaign_id, created_at desc);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;

create or replace function public.set_campaign_update_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.headline is distinct from old.headline
     or new.letter_title is distinct from old.letter_title
     or new.letter_body is distinct from old.letter_body then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;

create or replace function public.snapshot_campaign_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into public.campaign_versions (
    campaign_id, version, headline, letter_title, letter_body
  ) values (
    new.id, new.version, new.headline, new.letter_title, new.letter_body
  ) on conflict (campaign_id, version) do nothing;
  return new;
end;
$$;

drop trigger if exists campaigns_update_metadata on public.campaigns;
create trigger campaigns_update_metadata
before update on public.campaigns
for each row execute function public.set_campaign_update_metadata();

drop trigger if exists campaigns_snapshot_insert on public.campaigns;
create trigger campaigns_snapshot_insert
after insert on public.campaigns
for each row execute function public.snapshot_campaign_version();

drop trigger if exists campaigns_snapshot_update on public.campaigns;
create trigger campaigns_snapshot_update
after update of headline, letter_title, letter_body on public.campaigns
for each row execute function public.snapshot_campaign_version();

insert into public.campaigns (headline, letter_title, letter_body)
select
  'معًا ليصل صوتنا بوضوح',
  'إلى ممثلينا وصنّاع القرار',
  E'نحن الموقّعين أدناه، نطلب الاستماع إلى مطالب المجتمع ومناقشتها بشفافية، والعمل على اتخاذ خطوات عملية تحقق المصلحة العامة.\n\nنؤمن بأن الحوار المباشر والمشاركة المدنية أساس القرارات العادلة، ونأمل تحديد لقاء معلن لعرض الخطوات القادمة ومتابعتها.'
where not exists (select 1 from public.campaigns);

create or replace function public.get_public_campaign()
returns table (
  id uuid,
  headline text,
  letter_title text,
  letter_body text,
  version integer,
  is_open boolean,
  updated_at timestamptz,
  signature_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.headline,
    c.letter_title,
    c.letter_body,
    c.version,
    c.is_open,
    c.updated_at,
    (select count(*) from public.signatures s where s.campaign_id = c.id)
  from public.campaigns c
  where c.is_active = true
  limit 1;
$$;

create or replace function public.submit_signature(
  p_campaign_id uuid,
  p_full_name text,
  p_mobile text,
  p_address text,
  p_accepted boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version integer;
  v_signature_id uuid;
  v_name text := btrim(coalesce(p_full_name, ''));
  v_mobile text := nullif(regexp_replace(btrim(coalesce(p_mobile, '')), '[^0-9+]', '', 'g'), '');
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
begin
  if p_accepted is not true then
    raise exception 'CONSENT_REQUIRED' using errcode = '22023';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 100 then
    raise exception 'INVALID_NAME' using errcode = '22023';
  end if;

  if v_mobile is not null and char_length(v_mobile) not between 5 and 30 then
    raise exception 'INVALID_MOBILE' using errcode = '22023';
  end if;

  if v_address is not null and char_length(v_address) > 180 then
    raise exception 'INVALID_ADDRESS' using errcode = '22023';
  end if;

  select c.version into v_version
  from public.campaigns c
  where c.id = p_campaign_id and c.is_active = true and c.is_open = true;

  if v_version is null then
    raise exception 'CAMPAIGN_CLOSED' using errcode = 'P0001';
  end if;

  insert into public.signatures (
    campaign_id, campaign_version, full_name, mobile, address, consented_at
  ) values (
    p_campaign_id, v_version, v_name, v_mobile, v_address, now()
  ) returning id into v_signature_id;

  return v_signature_id;
exception
  when unique_violation then
    raise exception 'DUPLICATE_MOBILE' using errcode = 'P0001';
end;
$$;

alter table public.campaigns enable row level security;
alter table public.campaign_versions enable row level security;
alter table public.signatures enable row level security;
alter table public.admin_users enable row level security;

drop policy if exists "Public can read active campaign" on public.campaigns;
create policy "Public can read active campaign"
on public.campaigns for select
to anon, authenticated
using (is_active = true);

drop policy if exists "Admins manage campaigns" on public.campaigns;
create policy "Admins manage campaigns"
on public.campaigns for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins read campaign versions" on public.campaign_versions;
create policy "Admins read campaign versions"
on public.campaign_versions for select
to authenticated
using (public.is_admin());

drop policy if exists "Admins read signatures" on public.signatures;
create policy "Admins read signatures"
on public.signatures for select
to authenticated
using (public.is_admin());

drop policy if exists "Admins delete signatures" on public.signatures;
create policy "Admins delete signatures"
on public.signatures for delete
to authenticated
using (public.is_admin());

drop policy if exists "Users read own admin membership" on public.admin_users;
create policy "Users read own admin membership"
on public.admin_users for select
to authenticated
using (user_id = auth.uid());

revoke all on public.campaigns from anon, authenticated;
revoke all on public.campaign_versions from anon, authenticated;
revoke all on public.signatures from anon, authenticated;
revoke all on public.admin_users from anon, authenticated;

grant select on public.campaigns to anon, authenticated;
grant select, insert, update, delete on public.campaigns to authenticated;
grant select on public.campaign_versions to authenticated;
grant select, delete on public.signatures to authenticated;
grant select on public.admin_users to authenticated;

revoke all on function public.is_admin() from public;
revoke all on function public.get_public_campaign() from public;
revoke all on function public.submit_signature(uuid, text, text, text, boolean) from public;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.get_public_campaign() to anon, authenticated;
grant execute on function public.submit_signature(uuid, text, text, text, boolean) to anon, authenticated;

-- بعد إنشاء مستخدم المسؤول في Authentication > Users، نفّذ هذا السطر بعد استبدال البريد:
-- insert into public.admin_users (user_id)
-- select id from auth.users where email = 'YOUR_ADMIN_EMAIL';
