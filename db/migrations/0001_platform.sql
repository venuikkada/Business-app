-- CRAZY BUSINESS APP — platform-level schema
-- Runs as the migration owner. Application code connects as cba_app (tenant
-- traffic, RLS enforced) or cba_platform (super-admin, no tenant data grants).

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cba_app') then
    create role cba_app nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'cba_platform') then
    create role cba_platform nologin;
  end if;
end $$;

create schema if not exists app;
grant usage on schema app to cba_app, cba_platform;
grant usage on schema public to cba_app, cba_platform;

-- Request context. The server sets these with set_config(..., true) at the
-- start of every transaction after authenticating the caller.
create or replace function app.current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- users
create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  password_hash text not null,
  full_name text not null check (length(full_name) between 1 and 120),
  phone text,
  email_verified_at timestamptz,
  is_platform_admin boolean not null default false,
  totp_secret_enc text,
  totp_enabled_at timestamptz,
  failed_login_count int not null default 0,
  locked_until timestamptz,
  status text not null default 'active' check (status in ('active', 'disabled', 'deleted')),
  last_login_at timestamptz,
  deletion_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_updated before update on users for each row execute function app.set_updated_at();

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash bytea not null unique,
  kind text not null check (kind in ('web', 'mobile', 'admin')),
  mfa_verified boolean not null default false,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index sessions_user_idx on sessions(user_id) where revoked_at is null;

create table user_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  purpose text not null check (purpose in ('password_reset', 'email_verify')),
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index user_tokens_user_idx on user_tokens(user_id, purpose);

create table rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, window_start)
);

-- ---------------------------------------------------------------- plans
create table plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]{2,32}$'),
  name text not null,
  description text,
  price_monthly bigint not null default 0 check (price_monthly >= 0), -- paise
  price_yearly bigint not null default 0 check (price_yearly >= 0),   -- paise
  trial_days int not null default 0 check (trial_days between 0 and 90),
  limits jsonb not null default '{}',
  features jsonb not null default '{}',
  is_active boolean not null default true,
  is_public boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger plans_updated before update on plans for each row execute function app.set_updated_at();

create table platform_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

create table platform_audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references users(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}',
  ip inet,
  created_at timestamptz not null default now()
);
create index platform_audit_created_idx on platform_audit_logs(created_at desc);

create or replace function app.block_mutation() returns trigger
language plpgsql as $$
begin
  if current_setting('app.purge', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end $$;
create trigger platform_audit_immutable before update or delete on platform_audit_logs
  for each row execute function app.block_mutation();

create table payment_gateway_events (
  id text primary key,
  gateway text not null,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  received_at timestamptz not null default now()
);
