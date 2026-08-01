-- Keyring demo schema (hackathon).
--
-- PRODUCTION STEP: enable restrictive Row Level Security on all tables and
-- scope policies to authenticated users / service role. Do not ship an open
-- anon write path. RLS is intentionally left OFF here for the demo.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- cards: physical NFC cards used for approval taps
-- ---------------------------------------------------------------------------
create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  holder_name text not null,
  active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- pending_requests: privileged actions waiting for NFC tap(s)
-- expires_at defaults to created_at + 60 seconds
-- ---------------------------------------------------------------------------
create type public.request_kind as enum ('grant_admin', 'apply_fix');
create type public.request_status as enum (
  'pending',
  'approved',
  'expired',
  'cancelled'
);

create table if not exists public.pending_requests (
  id uuid primary key default gen_random_uuid(),
  kind public.request_kind not null,
  payload jsonb not null default '{}'::jsonb,
  requested_by text not null,
  reason text not null default '',
  dual_control boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '60 seconds'),
  status public.request_status not null default 'pending',
  constraint pending_requests_expires_after_create
    check (expires_at > created_at)
);

create index if not exists pending_requests_status_expires_idx
  on public.pending_requests (status, expires_at);

-- ---------------------------------------------------------------------------
-- taps: physical card taps bound to a pending request
-- ---------------------------------------------------------------------------
create table if not exists public.taps (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id),
  request_id uuid not null references public.pending_requests (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists taps_request_id_idx on public.taps (request_id);
create unique index if not exists taps_request_card_unique_idx
  on public.taps (request_id, card_id);

-- ---------------------------------------------------------------------------
-- grants: time-limited elevated access (default 15 minutes at insert time)
-- ---------------------------------------------------------------------------
create table if not exists public.grants (
  id uuid primary key default gen_random_uuid(),
  subject_id text not null,
  role text not null,
  target text not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  revoked_at timestamptz null
);

create index if not exists grants_subject_id_idx on public.grants (subject_id);
create index if not exists grants_expires_at_idx on public.grants (expires_at);

-- ---------------------------------------------------------------------------
-- audit: append-only event log (no updates / deletes)
-- ---------------------------------------------------------------------------
create table if not exists public.audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  detail jsonb not null default '{}'::jsonb
);

create or replace function public.reject_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit is append-only';
end;
$$;

drop trigger if exists audit_no_update on public.audit;
create trigger audit_no_update
  before update on public.audit
  for each row
  execute function public.reject_audit_mutation();

drop trigger if exists audit_no_delete on public.audit;
create trigger audit_no_delete
  before delete on public.audit
  for each row
  execute function public.reject_audit_mutation();

-- ---------------------------------------------------------------------------
-- Realtime: pending_requests and grants
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.pending_requests;
alter publication supabase_realtime add table public.grants;

-- Demo seed cards (optional; safe to re-run with on conflict do nothing)
insert into public.cards (id, label, holder_name, active)
values
  ('11111111-1111-1111-1111-111111111111', 'Card A', 'Priya Raman', true),
  ('22222222-2222-2222-2222-222222222222', 'Card B', 'Alex Rivera', true)
on conflict (id) do nothing;
