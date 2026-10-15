-- Row Level Security, grants, and the atomic business-creation function.
-- RLS is enabled (not forced) so SECURITY DEFINER functions owned by the
-- migration owner can perform the few cross-checks they need (membership
-- lookup, business creation). The application roles never own tables.

-- Business ids the current user belongs to (used for the business switcher).
create or replace function app.my_business_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select m.business_id from memberships m
  where m.user_id = app.current_user_id() and m.status = 'active'
$$;

-- --------------------------------------------------- tenant isolation policy
do $$
declare
  t text;
  tenant_tables text[] := array[
    'branches', 'roles', 'invitations', 'files', 'parties', 'party_interactions', 'categories', 'products',
    'stock_levels', 'approval_requests', 'stock_movements', 'product_serials', 'document_sequences', 'documents',
    'document_items', 'accounts', 'account_transactions', 'payments', 'allocations', 'expense_categories',
    'expenses', 'idempotency_keys', 'amc_contracts', 'service_tickets', 'service_ticket_events',
    'service_ticket_parts', 'audit_logs', 'support_tickets', 'support_ticket_messages'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy tenant_isolation on %I as permissive for all to cba_app
         using (business_id = (select app.current_business_id()))
         with check (business_id = (select app.current_business_id()))', t);
    execute format('grant select, insert, update, delete on %I to cba_app', t);
  end loop;
end $$;

-- Append-only tables: no update/delete privilege at all for the app role.
revoke update, delete on audit_logs, stock_movements, account_transactions from cba_app;

-- Notifications are per user inside a business.
alter table notifications enable row level security;
create policy notifications_insert on notifications for insert to cba_app
  with check (business_id = (select app.current_business_id()));
create policy notifications_own on notifications for select to cba_app
  using (business_id = (select app.current_business_id()) and user_id = (select app.current_user_id()));
create policy notifications_own_update on notifications for update to cba_app
  using (business_id = (select app.current_business_id()) and user_id = (select app.current_user_id()));
grant select, insert, update on notifications to cba_app;

-- Businesses: members can see the businesses they belong to.
alter table businesses enable row level security;
create policy businesses_member_select on businesses for select to cba_app
  using (id in (select app.my_business_ids()) or id = (select app.current_business_id()));
create policy businesses_member_update on businesses for update to cba_app
  using (id = (select app.current_business_id()))
  with check (id = (select app.current_business_id()));
grant select, update on businesses to cba_app;
create policy businesses_platform on businesses for all to cba_platform using (true) with check (true);
grant select, update on businesses to cba_platform;

-- Memberships: your own across businesses + everyone in the current business.
alter table memberships enable row level security;
create policy memberships_select on memberships for select to cba_app
  using (user_id = (select app.current_user_id()) or business_id = (select app.current_business_id()));
create policy memberships_write on memberships for all to cba_app
  using (business_id = (select app.current_business_id()))
  with check (business_id = (select app.current_business_id()));
grant select, insert, update, delete on memberships to cba_app;
create policy memberships_platform on memberships for select to cba_platform using (true);
grant select on memberships to cba_platform;

-- Support access grants are visible to the business (to approve/revoke) and
-- to the platform (to request); only the business can approve.
alter table support_access_grants enable row level security;
create policy support_grants_business on support_access_grants for all to cba_app
  using (business_id = (select app.current_business_id()))
  with check (business_id = (select app.current_business_id()));
create policy support_grants_platform on support_access_grants for all to cba_platform using (true) with check (true);
grant select, update on support_access_grants to cba_app;
grant select, insert, update on support_access_grants to cba_platform;

-- Subscriptions: tenants can only read. All writes happen via the platform
-- role after server-side payment verification.
do $$
declare t text;
begin
  foreach t in array array['subscriptions', 'subscription_payments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_read on %I for select to cba_app using (business_id = (select app.current_business_id()))', t);
    execute format('create policy platform_all on %I for all to cba_platform using (true) with check (true)', t);
    execute format('grant select on %I to cba_app', t);
    execute format('grant select, insert, update on %I to cba_platform', t);
  end loop;
end $$;

-- Platform support desk tables are shared with the platform role.
create policy support_tickets_platform on support_tickets for all to cba_platform using (true) with check (true);
create policy support_messages_platform on support_ticket_messages for all to cba_platform using (true) with check (true);
grant select, insert, update on support_tickets, support_ticket_messages to cba_platform;

-- Platform tables (no tenant data).
grant select, insert, update on users to cba_app, cba_platform;
grant select, insert, update, delete on sessions, user_tokens, rate_limits to cba_app, cba_platform;
grant select on plans, platform_settings to cba_app;
grant select, insert, update on plans, platform_settings to cba_platform;
grant select, insert on platform_audit_logs to cba_platform;
grant select, insert, update on payment_gateway_events to cba_platform;
grant usage on all sequences in schema public to cba_app, cba_platform;

-- Platform overview without exposing tenant records: counts only.
create or replace function app.platform_business_stats()
returns table (business_id uuid, members bigint, invoices_30d bigint, last_activity timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.id,
         (select count(*) from memberships m where m.business_id = b.id and m.status = 'active'),
         (select count(*) from documents d where d.business_id = b.id and d.doc_type = 'invoice'
            and d.created_at > now() - interval '30 days'),
         (select max(a.created_at) from audit_logs a where a.business_id = b.id)
  from businesses b
$$;
revoke all on function app.platform_business_stats() from public;
grant execute on function app.platform_business_stats() to cba_platform;

-- ------------------------------------------------------ business creation
-- Creates a business with its default branch, roles, owner membership,
-- accounts, expense categories and trial subscription in one transaction.
create or replace function app.create_business(p jsonb, roles_def jsonb, trial_plan_code text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := app.current_user_id();
  bid uuid;
  owner_role uuid;
  r jsonb;
  plan plans%rowtype;
  cat text;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from users where id = uid and status = 'active') then
    raise exception 'User is not active' using errcode = '28000';
  end if;

  insert into businesses(name, legal_name, business_type, gstin, pan, phone, email, address_line1, address_line2,
                         city, state_code, pincode, settings, created_by)
  values (p->>'name', p->>'legalName', coalesce(p->>'businessType', 'retail'), p->>'gstin', p->>'pan', p->>'phone',
          p->>'email', p->>'line1', p->>'line2', p->>'city', p->>'stateCode', p->>'pincode',
          coalesce(p->'settings', '{}'::jsonb), uid)
  returning id into bid;

  insert into branches(business_id, name, code, gstin, phone, address_line1, address_line2, city, state_code, pincode, is_default)
  values (bid, 'Main branch', 'MAIN', p->>'gstin', p->>'phone', p->>'line1', p->>'line2', p->>'city', p->>'stateCode', p->>'pincode', true);

  for r in select * from jsonb_array_elements(roles_def) loop
    insert into roles(business_id, key, name, description, permissions, is_system)
    values (bid, r->>'key', r->>'name', r->>'description',
            array(select jsonb_array_elements_text(r->'permissions')), true);
  end loop;
  select id into owner_role from roles where business_id = bid and key = 'owner';
  if owner_role is null then
    raise exception 'roles_def must include an owner role';
  end if;
  insert into memberships(business_id, user_id, role_id) values (bid, uid, owner_role);

  insert into accounts(business_id, name, type, is_default) values
    (bid, 'Cash in hand', 'cash', true),
    (bid, 'Bank account', 'bank', true);

  foreach cat in array array['Rent', 'Salaries & wages', 'Electricity', 'Internet & phone', 'Transport & fuel',
                             'Repairs & maintenance', 'Office supplies', 'Marketing', 'Bank charges', 'Miscellaneous'] loop
    insert into expense_categories(business_id, name) values (bid, cat);
  end loop;

  select * into plan from plans where code = trial_plan_code and is_active;
  if not found then
    select * into plan from plans where code = 'free';
  end if;
  insert into subscriptions(business_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
  values (bid, plan.id,
          case when plan.trial_days > 0 then 'trialing' else 'active' end,
          case when plan.trial_days > 0 then now() + make_interval(days => plan.trial_days) end,
          now(),
          case when plan.trial_days > 0 then now() + make_interval(days => plan.trial_days) end);

  insert into audit_logs(business_id, user_id, action, entity_type, entity_id, summary)
  values (bid, uid, 'business.create', 'business', bid, 'Business created');
  return bid;
end $$;
revoke all on function app.create_business(jsonb, jsonb, text) from public;
grant execute on function app.create_business(jsonb, jsonb, text) to cba_app;

-- Lets a user accept an invitation (they are not yet a member, so RLS
-- would otherwise hide the invitation).
create or replace function app.accept_invitation(p_token_hash bytea)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := app.current_user_id();
  inv invitations%rowtype;
  u users%rowtype;
begin
  select * into u from users where id = uid and status = 'active';
  if not found then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select * into inv from invitations where token_hash = p_token_hash for update;
  if not found or inv.accepted_at is not null or inv.revoked_at is not null or inv.expires_at < now() then
    raise exception 'Invitation is invalid or has expired' using errcode = 'P0001';
  end if;
  if lower(inv.email) <> lower(u.email) then
    raise exception 'This invitation was sent to a different email address' using errcode = 'P0001';
  end if;
  insert into memberships(business_id, user_id, role_id, branch_ids, invited_by)
  values (inv.business_id, uid, inv.role_id, inv.branch_ids, inv.invited_by)
  on conflict (business_id, user_id) do update set role_id = excluded.role_id, branch_ids = excluded.branch_ids, status = 'active';
  update invitations set accepted_at = now() where id = inv.id;
  insert into audit_logs(business_id, user_id, action, entity_type, entity_id, summary)
  values (inv.business_id, uid, 'member.join', 'membership', uid, 'Joined via invitation');
  return inv.business_id;
end $$;
revoke all on function app.accept_invitation(bytea) from public;
grant execute on function app.accept_invitation(bytea) to cba_app;

grant execute on function app.current_business_id(), app.current_user_id(), app.my_business_ids(), app.is_support_session() to cba_app, cba_platform;

-- --------------------------------------------------------- reporting views
-- security_invoker = true makes views obey the caller's RLS policies.
create view party_ledger with (security_invoker = true) as
  select p.business_id, p.id as party_id, p.created_at::date as entry_date, 'opening' as kind, null::uuid as ref_id,
         'Opening balance' as ref_number, greatest(p.opening_balance, 0) as debit, greatest(-p.opening_balance, 0) as credit
    from parties p where p.opening_balance <> 0
  union all
  select d.business_id, d.party_id, d.issue_date, d.doc_type, d.id, d.number,
         case when d.doc_type in ('invoice', 'debit_note') then d.grand_total else 0 end,
         case when d.doc_type in ('credit_note', 'purchase_bill') then d.grand_total else 0 end
    from documents d
   where d.doc_type in ('invoice', 'credit_note', 'purchase_bill', 'debit_note')
     and d.status not in ('draft', 'cancelled')
  union all
  select pm.business_id, pm.party_id, pm.paid_on, 'payment_' || pm.direction, pm.id, pm.number,
         case when pm.direction = 'out' then pm.amount else 0 end,
         case when pm.direction = 'in' then pm.amount else 0 end
    from payments pm where pm.status = 'active';

-- Positive balance = the party owes the business (receivable);
-- negative = the business owes the party (payable).
create view party_balances with (security_invoker = true) as
  select p.business_id, p.id as party_id,
         coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0) as balance
    from parties p
    left join party_ledger l on l.party_id = p.id
   group by p.business_id, p.id;

grant select on party_ledger, party_balances to cba_app;

-- The current user's businesses with role and plan (for the business switcher).
-- Roles and subscriptions are tenant-scoped, so this needs SECURITY DEFINER.
create or replace function app.my_businesses()
returns table (id uuid, name text, city text, state_code char(2), status text, role_name text, role_key text, plan_name text, subscription_status text)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.id, b.name, b.city, b.state_code, b.status, r.name, r.key, p.name, s.status
    from memberships m
    join businesses b on b.id = m.business_id
    join roles r on r.id = m.role_id
    left join subscriptions s on s.business_id = b.id
    left join plans p on p.id = s.plan_id
   where m.user_id = app.current_user_id() and m.status = 'active' and b.status <> 'deleted'
   order by b.created_at
$$;
revoke all on function app.my_businesses() from public;
grant execute on function app.my_businesses() to cba_app;
