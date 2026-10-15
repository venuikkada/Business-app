-- Quotations, orders, challans, invoices, credit notes, purchase orders,
-- purchase bills, debit notes; payments, allocations, accounts, expenses.

create table document_sequences (
  business_id uuid not null references businesses(id) on delete cascade,
  doc_type text not null,
  fy text not null,
  prefix text not null,
  next_value int not null default 1 check (next_value > 0),
  primary key (business_id, doc_type, fy)
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  branch_id uuid not null,
  doc_type text not null check (doc_type in ('quotation', 'sales_order', 'delivery_challan', 'invoice', 'credit_note',
                                             'purchase_order', 'purchase_bill', 'debit_note')),
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired', 'issued',
                                                       'partially_paid', 'paid', 'cancelled', 'converted', 'fulfilled',
                                                       'partially_received', 'received')),
  number text,
  sequence_no int,
  fy text,
  party_id uuid not null,
  -- Snapshot of party details at the time of issue (documents must not
  -- change if the customer record is edited later).
  party_name text not null,
  party_gstin text,
  party_phone text,
  party_email text,
  party_billing_address jsonb,
  party_shipping_address jsonb,
  party_state_code char(2),
  issue_date date not null,
  due_date date,
  valid_until date,
  place_of_supply char(2) not null,
  is_inter_state boolean not null,
  prices_include_tax boolean not null default false,
  reverse_charge boolean not null default false,
  document_discount_type text check (document_discount_type in ('percent', 'amount')),
  document_discount_value numeric(14,2) not null default 0,
  additional_charges numeric(14,2) not null default 0 check (additional_charges >= 0),
  additional_charges_label text,
  additional_charges_tax_rate numeric(5,2) not null default 0,
  round_off_enabled boolean not null default true,
  gross_total numeric(14,2) not null default 0,
  line_discount_total numeric(14,2) not null default 0,
  document_discount numeric(14,2) not null default 0,
  taxable_total numeric(14,2) not null default 0,
  cgst_total numeric(14,2) not null default 0,
  sgst_total numeric(14,2) not null default 0,
  igst_total numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  round_off numeric(14,2) not null default 0 check (abs(round_off) <= 0.5),
  grand_total numeric(14,2) not null default 0 check (grand_total >= 0),
  amount_settled numeric(14,2) not null default 0 check (amount_settled >= 0),
  balance_due numeric(14,2) generated always as (grand_total - amount_settled) stored,
  cost_total numeric(14,2),
  supplier_invoice_number text,
  reference_number text,
  notes text,
  terms text,
  source_document_id uuid,
  approval_id uuid,
  share_token text unique,
  created_by uuid references users(id),
  finalized_by uuid references users(id),
  finalized_at timestamptz,
  sent_at timestamptz,
  accepted_at timestamptz,
  cancelled_by uuid references users(id),
  cancelled_at timestamptz,
  cancel_reason text,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, branch_id) references branches(business_id, id),
  foreign key (business_id, party_id) references parties(business_id, id),
  foreign key (business_id, source_document_id) references documents(business_id, id),
  foreign key (business_id, approval_id) references approval_requests(business_id, id),
  check (tax_total = cgst_total + sgst_total + igst_total),
  check (grand_total = taxable_total + tax_total + round_off),
  check (amount_settled <= grand_total),
  check (status = 'draft' or number is not null),
  check (not is_inter_state or (cgst_total = 0 and sgst_total = 0)),
  check (is_inter_state or igst_total = 0)
);
create unique index documents_number_uniq on documents(business_id, doc_type, number) where number is not null;
create unique index documents_seq_uniq on documents(business_id, doc_type, fy, sequence_no) where sequence_no is not null;
create index documents_list on documents(business_id, doc_type, issue_date desc);
create index documents_party on documents(business_id, party_id, issue_date desc);
create index documents_open on documents(business_id, doc_type, due_date) where status in ('issued', 'partially_paid');
create index documents_source on documents(source_document_id) where source_document_id is not null;
create trigger documents_updated before update on documents for each row execute function app.set_updated_at();

create table document_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  document_id uuid not null,
  position int not null,
  product_id uuid,
  description text not null,
  hsn_code text,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null default 'pcs',
  unit_price numeric(14,2) not null check (unit_price >= 0),
  discount_type text check (discount_type in ('percent', 'amount')),
  discount_value numeric(14,2) not null default 0 check (discount_value >= 0),
  tax_rate numeric(5,2) not null,
  gross numeric(14,2) not null,
  line_discount numeric(14,2) not null default 0,
  document_discount_share numeric(14,2) not null default 0,
  taxable_value numeric(14,2) not null,
  cgst numeric(14,2) not null default 0,
  sgst numeric(14,2) not null default 0,
  igst numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null,
  total numeric(14,2) not null,
  unit_cost numeric(14,4),
  serial_numbers text[] not null default '{}',
  -- Fulfilment tracking for orders (quantity invoiced / received so far).
  fulfilled_quantity numeric(14,3) not null default 0 check (fulfilled_quantity >= 0),
  source_item_id uuid,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, document_id) references documents(business_id, id) on delete cascade,
  foreign key (business_id, product_id) references products(business_id, id),
  check (tax_amount = cgst + sgst + igst),
  check (total = taxable_value + tax_amount)
);
create index document_items_doc on document_items(document_id, position);
create index document_items_product on document_items(business_id, product_id);

-- Finalised documents are immutable: only lifecycle columns may change.
create or replace function app.protect_document() returns trigger
language plpgsql as $$
begin
  if current_setting('app.purge', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only draft documents can be deleted; cancel issued documents instead' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status = 'draft' then
    return new;
  end if;
  if (new.business_id, new.branch_id, new.doc_type, new.number, new.sequence_no, new.fy, new.party_id, new.party_name,
      new.party_gstin, new.issue_date, new.place_of_supply, new.is_inter_state, new.prices_include_tax,
      new.taxable_total, new.tax_total, new.cgst_total, new.sgst_total, new.igst_total, new.round_off,
      new.grand_total, new.gross_total, new.line_discount_total, new.document_discount, new.additional_charges,
      new.finalized_at, new.finalized_by, new.cost_total)
     is distinct from
     (old.business_id, old.branch_id, old.doc_type, old.number, old.sequence_no, old.fy, old.party_id, old.party_name,
      old.party_gstin, old.issue_date, old.place_of_supply, old.is_inter_state, old.prices_include_tax,
      old.taxable_total, old.tax_total, old.cgst_total, old.sgst_total, old.igst_total, old.round_off,
      old.grand_total, old.gross_total, old.line_discount_total, old.document_discount, old.additional_charges,
      old.finalized_at, old.finalized_by, old.cost_total) then
    raise exception 'Finalised document % cannot be edited; cancel it or issue a credit/debit note', old.number
      using errcode = 'P0001';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'Cancelled documents cannot be reopened' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger documents_protect before update or delete on documents
  for each row execute function app.protect_document();

create or replace function app.protect_document_item() returns trigger
language plpgsql as $$
declare
  st text;
begin
  if current_setting('app.purge', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select status into st from documents where id = coalesce(new.document_id, old.document_id);
  if st is null then
    -- Parent row already deleted (cascade from a draft deletion).
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if st = 'draft' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'fulfilled_quantity') = (to_jsonb(old) - 'fulfilled_quantity') then
    return new;
  end if;
  raise exception 'Items of a finalised document cannot be changed' using errcode = 'P0001';
end $$;
create trigger document_items_protect before insert or update or delete on document_items
  for each row execute function app.protect_document_item();

-- ---------------------------------------------------------------- accounts
create table accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  type text not null check (type in ('cash', 'bank', 'upi', 'card', 'other')),
  opening_balance numeric(14,2) not null default 0,
  account_number_last4 text,
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, id)
);
create unique index accounts_name_uniq on accounts(business_id, lower(name));
create unique index accounts_default_per_type on accounts(business_id, type) where is_default;

create table account_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  account_id uuid not null,
  txn_date date not null,
  amount numeric(14,2) not null check (amount <> 0), -- positive = money in
  kind text not null check (kind in ('payment_in', 'payment_out', 'expense', 'transfer_in', 'transfer_out',
                                     'income', 'withdrawal', 'deposit', 'reversal')),
  category text,
  source_type text,
  source_id uuid,
  transfer_group uuid,
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  foreign key (business_id, account_id) references accounts(business_id, id)
);
create unique index account_txn_once on account_transactions(source_type, source_id, account_id, kind) where source_id is not null;
create index account_txn_list on account_transactions(business_id, account_id, txn_date desc);
create trigger account_transactions_immutable before update or delete on account_transactions
  for each row execute function app.block_mutation();

-- ---------------------------------------------------------------- payments
create table payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  branch_id uuid not null,
  direction text not null check (direction in ('in', 'out')),
  number text not null,
  party_id uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  method text not null check (method in ('cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other')),
  account_id uuid,
  paid_on date not null,
  reference text,
  notes text,
  status text not null default 'active' check (status in ('active', 'void')),
  voided_by uuid references users(id),
  voided_at timestamptz,
  void_reason text,
  approval_id uuid,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, number),
  foreign key (business_id, branch_id) references branches(business_id, id),
  foreign key (business_id, party_id) references parties(business_id, id),
  foreign key (business_id, account_id) references accounts(business_id, id),
  foreign key (business_id, approval_id) references approval_requests(business_id, id)
);
create index payments_party on payments(business_id, party_id, paid_on desc);
create index payments_list on payments(business_id, paid_on desc);

create or replace function app.protect_payment() returns trigger
language plpgsql as $$
begin
  if current_setting('app.purge', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Payments cannot be deleted; void them instead' using errcode = 'P0001';
  end if;
  if old.status = 'void' then
    raise exception 'Voided payments cannot be changed' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - array['status', 'voided_by', 'voided_at', 'void_reason']) <> (to_jsonb(old) - array['status', 'voided_by', 'voided_at', 'void_reason']) then
    raise exception 'Payments cannot be edited; void and re-record instead' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger payments_protect before update or delete on payments
  for each row execute function app.protect_payment();

-- Links money (a payment, or a credit/debit note) to the document it settles.
create table allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  document_id uuid not null,                -- the invoice / bill / note being settled
  payment_id uuid,                          -- money received or paid
  credit_document_id uuid,                  -- or a credit note / debit note applied
  amount numeric(14,2) not null check (amount > 0),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  foreign key (business_id, document_id) references documents(business_id, id),
  foreign key (business_id, payment_id) references payments(business_id, id),
  foreign key (business_id, credit_document_id) references documents(business_id, id),
  check ((payment_id is null) <> (credit_document_id is null))
);
create index allocations_document on allocations(document_id);
create index allocations_payment on allocations(payment_id) where payment_id is not null;
create index allocations_credit on allocations(credit_document_id) where credit_document_id is not null;

-- Recomputes amount_settled and payment status of a document from its
-- allocations. Over-allocation fails the documents CHECK constraint.
create or replace function app.recompute_settlement(doc uuid) returns void
language plpgsql as $$
declare
  settled numeric(14,2);
  d documents%rowtype;
begin
  select * into d from documents where id = doc for update;
  if not found then return; end if;
  select coalesce(sum(a.amount), 0) into settled
    from allocations a
    left join payments p on p.id = a.payment_id
   where (a.document_id = doc or a.credit_document_id = doc)
     and (a.payment_id is null or p.status = 'active');
  update documents set
    amount_settled = settled,
    status = case
      when d.doc_type in ('invoice', 'purchase_bill') and d.status in ('issued', 'partially_paid', 'paid') then
        case when settled >= d.grand_total and d.grand_total > 0 then 'paid'
             when settled > 0 then 'partially_paid'
             else 'issued' end
      else d.status end
  where id = doc;
end $$;

create or replace function app.allocations_changed() returns trigger
language plpgsql as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform app.recompute_settlement(old.document_id);
    if old.credit_document_id is not null then perform app.recompute_settlement(old.credit_document_id); end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform app.recompute_settlement(new.document_id);
    if new.credit_document_id is not null then perform app.recompute_settlement(new.credit_document_id); end if;
  end if;
  return null;
end $$;
create trigger allocations_settle after insert or update or delete on allocations
  for each row execute function app.allocations_changed();

-- --------------------------------------------------------------- expenses
create table expense_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, id)
);
create unique index expense_categories_name on expense_categories(business_id, lower(name));

create table expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  branch_id uuid not null,
  number text not null,
  category_id uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0 and tax_amount <= amount),
  expense_date date not null,
  method text not null check (method in ('cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other')),
  account_id uuid,
  party_id uuid,
  reference text,
  notes text,
  attachment_file_id uuid,
  status text not null default 'active' check (status in ('active', 'void')),
  voided_by uuid references users(id),
  voided_at timestamptz,
  void_reason text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, number),
  foreign key (business_id, branch_id) references branches(business_id, id),
  foreign key (business_id, category_id) references expense_categories(business_id, id),
  foreign key (business_id, account_id) references accounts(business_id, id),
  foreign key (business_id, party_id) references parties(business_id, id),
  foreign key (business_id, attachment_file_id) references files(business_id, id)
);
create index expenses_list on expenses(business_id, expense_date desc);
create trigger expenses_updated before update on expenses for each row execute function app.set_updated_at();

-- Replay protection for create endpoints (Idempotency-Key header).
create table idempotency_keys (
  business_id uuid not null references businesses(id) on delete cascade,
  key text not null,
  user_id uuid not null references users(id) on delete cascade,
  request_hash text not null,
  response jsonb,
  status_code int,
  created_at timestamptz not null default now(),
  primary key (business_id, key)
);
