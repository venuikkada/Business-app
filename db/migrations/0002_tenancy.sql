-- Businesses, branches, roles, memberships, subscriptions.

create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 120),
  legal_name text,
  business_type text not null default 'retail',
  gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  pan text,
  phone text,
  email citext,
  address_line1 text,
  address_line2 text,
  city text,
  state_code char(2) not null,
  pincode text,
  logo_file_id uuid,
  currency char(3) not null default 'INR',
  timezone text not null default 'Asia/Kolkata',
  fy_start_month smallint not null default 4 check (fy_start_month between 1 and 12),
  settings jsonb not null default '{}',
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  suspended_reason text,
  deletion_requested_at timestamptz,
  purge_after timestamptz,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger businesses_updated before update on businesses for each row execute function app.set_updated_at();

create table branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  code text,
  gstin text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state_code char(2) not null,
  pincode text,
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);
create unique index branches_one_default on branches(business_id) where is_default;
create unique index branches_name_uniq on branches(business_id, lower(name));
create trigger branches_updated before update on branches for each row execute function app.set_updated_at();

create table roles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  key text,
  name text not null,
  description text,
  permissions text[] not null default '{}',
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);
create unique index roles_name_uniq on roles(business_id, lower(name));
create unique index roles_key_uniq on roles(business_id, key) where key is not null;
create trigger roles_updated before update on roles for each row execute function app.set_updated_at();

create table memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null,
  branch_ids uuid[],
  status text not null default 'active' check (status in ('active', 'disabled')),
  invited_by uuid references users(id),
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id),
  foreign key (business_id, role_id) references roles(business_id, id)
);
create index memberships_user_idx on memberships(user_id) where status = 'active';
create trigger memberships_updated before update on memberships for each row execute function app.set_updated_at();

create table invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  email citext not null,
  role_id uuid not null,
  branch_ids uuid[],
  token_hash bytea not null unique,
  invited_by uuid not null references users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (business_id, role_id) references roles(business_id, id)
);
create unique index invitations_pending_uniq on invitations(business_id, email) where accepted_at is null and revoked_at is null;

-- Time-boxed, owner-approved access for platform support staff. Without an
-- active grant the super-admin cannot read any tenant business records.
create table support_access_grants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  platform_user_id uuid not null references users(id) on delete cascade,
  reason text not null,
  requested_at timestamptz not null default now(),
  approved_by uuid references users(id),
  approved_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);
create index support_grants_lookup on support_access_grants(business_id, platform_user_id);

-- ------------------------------------------------------------ subscriptions
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references businesses(id) on delete cascade,
  plan_id uuid not null references plans(id),
  status text not null check (status in ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  billing_interval text not null default 'month' check (billing_interval in ('month', 'year')),
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  grace_until timestamptz,
  gateway text,
  gateway_customer_id text,
  gateway_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger subscriptions_updated before update on subscriptions for each row execute function app.set_updated_at();

create table subscription_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  plan_id uuid not null references plans(id),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  amount bigint not null check (amount >= 0), -- paise
  currency char(3) not null default 'INR',
  status text not null default 'created' check (status in ('created', 'paid', 'failed', 'refunded')),
  gateway text not null,
  gateway_order_id text unique,
  gateway_payment_id text unique,
  failure_reason text,
  verified_at timestamptz,
  raw jsonb,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger subscription_payments_updated before update on subscription_payments for each row execute function app.set_updated_at();

-- Returns the business id from the request context only when the current
-- user is an active member (or holds an approved, unexpired support grant).
-- SECURITY DEFINER so it can read memberships regardless of RLS; it never
-- returns another tenant's id.
create or replace function app.current_business_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select b.id from businesses b
  where b.id = nullif(current_setting('app.business_id', true), '')::uuid
    and b.status <> 'deleted'
    and (
      exists (select 1 from memberships m
              where m.business_id = b.id and m.user_id = app.current_user_id() and m.status = 'active')
      or exists (select 1 from support_access_grants g
                 where g.business_id = b.id and g.platform_user_id = app.current_user_id()
                   and g.approved_at is not null and g.revoked_at is null and g.expires_at > now())
    )
$$;

create or replace function app.is_support_session() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not exists (
    select 1 from memberships m
    where m.business_id = nullif(current_setting('app.business_id', true), '')::uuid
      and m.user_id = app.current_user_id() and m.status = 'active')
$$;
