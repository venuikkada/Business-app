-- Scheduled maintenance, notification generation and public document links.

-- Members of a business holding a permission.
create or replace function app.members_with(p_business uuid, p_perm text)
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select m.user_id from memberships m join roles r on r.id = m.role_id
   where m.business_id = p_business and m.status = 'active' and p_perm = any(r.permissions)
$$;

-- Generates in-app notifications for every active business. Idempotent:
-- dedupe keys make repeated runs on the same day harmless.
create or replace function app.generate_notifications(p_today date)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n int := 0;
  c int;
begin
  -- Overdue invoices (re-notified weekly while unpaid).
  insert into notifications(business_id, user_id, kind, title, body, entity_type, entity_id, dedupe_key)
  select d.business_id, u, 'overdue_invoice',
         'Overdue: ' || d.number || ' — ' || d.party_name,
         'Balance ₹' || d.balance_due || ', due ' || to_char(d.due_date, 'DD/MM/YYYY') || ' (' || (p_today - d.due_date) || ' days overdue)',
         'document', d.id, 'overdue:' || d.id || ':' || ((p_today - d.due_date) / 7)
    from documents d join businesses b on b.id = d.business_id and b.status = 'active'
    cross join lateral app.members_with(d.business_id, 'payments.view') u
   where d.doc_type = 'invoice' and d.status in ('issued', 'partially_paid') and d.due_date < p_today and d.balance_due > 0
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  -- Low stock (weekly).
  insert into notifications(business_id, user_id, kind, title, body, entity_type, entity_id, dedupe_key)
  select p.business_id, u, 'low_stock', 'Low stock: ' || p.name,
         'In stock ' || coalesce(s.qty, 0) || ' ' || p.unit || ' (reorder level ' || p.reorder_level || ')',
         'product', p.id, 'low:' || p.id || ':' || to_char(p_today, 'IYYY-IW')
    from products p join businesses b on b.id = p.business_id and b.status = 'active'
    left join (select product_id, sum(quantity) qty from stock_levels group by product_id) s on s.product_id = p.id
    cross join lateral app.members_with(p.business_id, 'inventory.view') u
   where p.archived_at is null and p.track_inventory and p.reorder_level > 0 and coalesce(s.qty, 0) <= p.reorder_level
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  -- Warranties expiring in the next 30 days.
  insert into notifications(business_id, user_id, kind, title, body, entity_type, entity_id, dedupe_key)
  select s.business_id, u, 'warranty_expiring', 'Warranty ending: ' || pr.name || ' (' || s.serial_number || ')',
         coalesce(pa.name, 'Customer') || ' — ends ' || to_char(s.warranty_until, 'DD/MM/YYYY'),
         'product', s.product_id, 'warranty:' || s.id
    from product_serials s join products pr on pr.id = s.product_id
    join businesses b on b.id = s.business_id and b.status = 'active'
    left join parties pa on pa.id = s.party_id
    cross join lateral app.members_with(s.business_id, 'service.view') u
   where s.status = 'sold' and s.warranty_until between p_today and p_today + 30
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  -- AMC renewals.
  insert into notifications(business_id, user_id, kind, title, body, entity_type, entity_id, dedupe_key)
  select a.business_id, u, 'amc_renewal', 'AMC renewal due: ' || a.number,
         pa.name || ' — ' || a.title || ', ends ' || to_char(a.end_date, 'DD/MM/YYYY'),
         'amc', a.id, 'amc:' || a.id
    from amc_contracts a join parties pa on pa.id = a.party_id
    join businesses b on b.id = a.business_id and b.status = 'active'
    cross join lateral app.members_with(a.business_id, 'service.view') u
   where a.status = 'active' and a.end_date - a.reminder_days_before <= p_today and a.end_date >= p_today
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;

  -- Follow-ups due (to the person who created them).
  insert into notifications(business_id, user_id, kind, title, body, entity_type, entity_id, dedupe_key)
  select i.business_id, i.created_by, 'follow_up', 'Follow up: ' || pa.name, i.notes, 'party', i.party_id, 'follow:' || i.id
    from party_interactions i join parties pa on pa.id = i.party_id
    join businesses b on b.id = i.business_id and b.status = 'active'
   where i.completed_at is null and i.follow_up_on <= p_today and i.created_by is not null
  on conflict do nothing;
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;

create or replace function app.daily_maintenance(p_today date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  expired_quotes int;
  expired_amc int;
  trials int;
  lapsed int;
  purged int := 0;
  r record;
begin
  update documents set status = 'expired'
   where doc_type = 'quotation' and status = 'sent' and valid_until < p_today;
  get diagnostics expired_quotes = row_count;

  update amc_contracts set status = 'expired' where status = 'active' and end_date < p_today;
  get diagnostics expired_amc = row_count;

  update subscriptions set status = 'expired' where status = 'trialing' and trial_ends_at < now();
  get diagnostics trials = row_count;

  update subscriptions set status = case when grace_until is not null and grace_until > now() then 'past_due' else 'expired' end
   where status in ('active', 'cancelled') and current_period_end is not null and current_period_end < now();
  get diagnostics lapsed = row_count;
  update subscriptions set status = 'expired' where status = 'past_due' and (grace_until is null or grace_until < now());

  -- Permanently purge businesses whose deletion retention window has passed.
  perform set_config('app.purge', 'on', true);
  for r in select id from businesses where status = 'deleted' and purge_after < now() loop
    delete from businesses where id = r.id;
    insert into platform_audit_logs(action, target_type, target_id, details)
    values ('business.purged', 'business', r.id::text, '{}'::jsonb);
    purged := purged + 1;
  end loop;
  perform set_config('app.purge', 'off', true);

  delete from rate_limits where window_start < now() - interval '1 day';
  delete from sessions where expires_at < now() - interval '30 days' or revoked_at < now() - interval '30 days';
  delete from user_tokens where expires_at < now() - interval '7 days';
  delete from idempotency_keys where created_at < now() - interval '2 days';

  return jsonb_build_object('expiredQuotations', expired_quotes, 'expiredAmc', expired_amc, 'expiredTrials', trials,
                            'lapsedSubscriptions', lapsed, 'purgedBusinesses', purged,
                            'notifications', app.generate_notifications(p_today));
end $$;

revoke all on function app.generate_notifications(date), app.daily_maintenance(date), app.members_with(uuid, text) from public;
grant execute on function app.daily_maintenance(date) to cba_platform;

-- Cancel a pending deletion within the retention window (owner only).
create or replace function app.restore_business(p_business uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from memberships m join roles r on r.id = m.role_id
                  where m.business_id = p_business and m.user_id = app.current_user_id() and m.status = 'active' and r.key = 'owner') then
    raise exception 'Only an owner can restore this business' using errcode = '42501';
  end if;
  update businesses set status = 'active', deletion_requested_at = null, purge_after = null
   where id = p_business and status = 'deleted' and purge_after > now();
  if not found then raise exception 'This business can no longer be restored' using errcode = 'P0001'; end if;
  insert into audit_logs(business_id, user_id, action, entity_type, entity_id, summary)
  values (p_business, app.current_user_id(), 'business.restore', 'business', p_business, 'Deletion cancelled');
end $$;
revoke all on function app.restore_business(uuid) from public;
grant execute on function app.restore_business(uuid) to cba_app;

-- Owner's businesses pending deletion (hidden from normal RLS views).
create or replace function app.my_deleted_businesses()
returns table (id uuid, name text, purge_after timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.id, b.name, b.purge_after from businesses b
    join memberships m on m.business_id = b.id and m.user_id = app.current_user_id() and m.status = 'active'
    join roles r on r.id = m.role_id and r.key = 'owner'
   where b.status = 'deleted' and b.purge_after > now()
$$;
revoke all on function app.my_deleted_businesses() from public;
grant execute on function app.my_deleted_businesses() to cba_app;

-- Public, read-only view of one issued document via its unguessable share
-- token (used for "view invoice" links sent on WhatsApp). Returns only what is
-- printed on the document itself.
create or replace function app.public_document(p_token text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'document', to_jsonb(d) - array['cost_total', 'created_by', 'finalized_by', 'cancelled_by', 'approval_id', 'share_token', 'business_id'],
    'items', coalesce((select jsonb_agg(to_jsonb(i) - array['unit_cost', 'business_id'] order by i.position) from document_items i where i.document_id = d.id), '[]'::jsonb),
    'business', jsonb_build_object('name', b.name, 'legal_name', b.legal_name, 'gstin', coalesce(br.gstin, b.gstin), 'phone', b.phone, 'email', b.email,
                                   'address_line1', coalesce(br.address_line1, b.address_line1), 'address_line2', coalesce(br.address_line2, b.address_line2),
                                   'city', coalesce(br.city, b.city), 'state_code', br.state_code, 'pincode', coalesce(br.pincode, b.pincode),
                                   'settings', b.settings, 'logo_storage_key', (select f.storage_key from files f where f.id = b.logo_file_id))
  )
  from documents d join businesses b on b.id = d.business_id join branches br on br.id = d.branch_id
  where d.share_token = p_token and length(p_token) >= 24 and d.status not in ('draft') and b.status = 'active'
$$;
revoke all on function app.public_document(text) from public;
grant execute on function app.public_document(text) to cba_app;
