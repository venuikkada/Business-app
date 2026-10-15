-- Service tickets, AMC contracts, notifications, audit log, support.

create or replace function app.payment_status_changed() returns trigger
language plpgsql as $$
declare
  r record;
begin
  if new.status is distinct from old.status then
    for r in select distinct document_id from allocations where payment_id = new.id loop
      perform app.recompute_settlement(r.document_id);
    end loop;
  end if;
  return null;
end $$;
create trigger payments_resettle after update on payments
  for each row execute function app.payment_status_changed();

create table amc_contracts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  number text not null,
  party_id uuid not null,
  title text not null,
  start_date date not null,
  end_date date not null,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  visits_included int not null default 0 check (visits_included >= 0),
  covered_items text,
  reminder_days_before int not null default 30,
  status text not null default 'active' check (status in ('active', 'expired', 'cancelled', 'renewed')),
  renewed_from_id uuid,
  invoice_id uuid,
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, number),
  check (end_date > start_date),
  foreign key (business_id, party_id) references parties(business_id, id),
  foreign key (business_id, renewed_from_id) references amc_contracts(business_id, id),
  foreign key (business_id, invoice_id) references documents(business_id, id)
);
create index amc_expiry on amc_contracts(business_id, end_date) where status = 'active';
create trigger amc_updated before update on amc_contracts for each row execute function app.set_updated_at();

create table service_tickets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  branch_id uuid not null,
  number text not null,
  party_id uuid not null,
  product_id uuid,
  equipment text,
  serial_number text,
  issue text not null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'assigned', 'in_progress', 'on_hold', 'completed', 'cancelled')),
  assigned_to uuid references users(id),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  resolution text,
  service_charge numeric(14,2) not null default 0 check (service_charge >= 0),
  under_warranty boolean not null default false,
  amc_contract_id uuid,
  invoice_id uuid,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, number),
  foreign key (business_id, branch_id) references branches(business_id, id),
  foreign key (business_id, party_id) references parties(business_id, id),
  foreign key (business_id, product_id) references products(business_id, id),
  foreign key (business_id, amc_contract_id) references amc_contracts(business_id, id),
  foreign key (business_id, invoice_id) references documents(business_id, id)
);
create index service_tickets_list on service_tickets(business_id, status, created_at desc);
create index service_tickets_assignee on service_tickets(business_id, assigned_to) where status not in ('completed', 'cancelled');
create trigger service_tickets_updated before update on service_tickets for each row execute function app.set_updated_at();

create table service_ticket_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  ticket_id uuid not null,
  kind text not null check (kind in ('created', 'status', 'assigned', 'note', 'part', 'scheduled', 'invoiced')),
  from_status text,
  to_status text,
  note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  foreign key (business_id, ticket_id) references service_tickets(business_id, id) on delete cascade
);
create index service_ticket_events_ticket on service_ticket_events(ticket_id, created_at);

create table service_ticket_parts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  ticket_id uuid not null,
  product_id uuid not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  consumed_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, ticket_id) references service_tickets(business_id, id) on delete cascade,
  foreign key (business_id, product_id) references products(business_id, id)
);

-- ----------------------------------------------------------- notifications
create table notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('overdue_invoice', 'low_stock', 'warranty_expiring', 'amc_renewal', 'follow_up',
                                     'approval_request', 'approval_decision', 'service_assigned', 'subscription', 'system')),
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, user_id, dedupe_key)
);
create index notifications_inbox on notifications(business_id, user_id, created_at desc);

-- --------------------------------------------------------------- audit log
create table audit_logs (
  id bigint generated always as identity primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text,
  before jsonb,
  after jsonb,
  ip inet,
  user_agent text,
  via_support boolean not null default false,
  created_at timestamptz not null default now()
);
create index audit_logs_business on audit_logs(business_id, created_at desc);
create index audit_logs_entity on audit_logs(business_id, entity_type, entity_id);
create trigger audit_logs_immutable before update or delete on audit_logs
  for each row execute function app.block_mutation();

-- ------------------------------------------------------------ support desk
create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  created_by uuid not null references users(id),
  subject text not null check (length(subject) between 3 and 200),
  status text not null default 'open' check (status in ('open', 'waiting_on_customer', 'closed')),
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);
create trigger support_tickets_updated before update on support_tickets for each row execute function app.set_updated_at();

create table support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  ticket_id uuid not null,
  author_user_id uuid references users(id) on delete set null,
  is_staff boolean not null default false,
  body text not null check (length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  foreign key (business_id, ticket_id) references support_tickets(business_id, id) on delete cascade
);
