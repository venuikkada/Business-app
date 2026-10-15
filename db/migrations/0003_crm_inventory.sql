-- Customers/suppliers, products, stock ledger, files.
-- Composite foreign keys (business_id, id) guarantee at the database level
-- that a record can never reference another tenant's record.

create table files (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  purpose text not null check (purpose in ('logo', 'expense_receipt', 'attachment', 'import')),
  storage_key text not null unique,
  mime_type text not null,
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 10485760),
  original_name text,
  sha256 text not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (business_id, id)
);

create table parties (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null check (length(name) between 1 and 160),
  is_customer boolean not null default true,
  is_supplier boolean not null default false,
  contact_person text,
  phone text,
  alt_phone text,
  email citext,
  gstin text,
  pan text,
  billing_line1 text, billing_line2 text, billing_city text, billing_state_code char(2), billing_pincode text,
  shipping_line1 text, shipping_line2 text, shipping_city text, shipping_state_code char(2), shipping_pincode text,
  opening_balance numeric(14,2) not null default 0, -- positive: they owe us
  credit_limit numeric(14,2) check (credit_limit is null or credit_limit >= 0),
  payment_terms_days int check (payment_terms_days is null or payment_terms_days between 0 and 365),
  notes text,
  tags text[] not null default '{}',
  whatsapp_opt_in boolean not null default false,
  archived_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (is_customer or is_supplier)
);
create index parties_name_trgm on parties using gin (name gin_trgm_ops);
create index parties_business_name on parties(business_id, lower(name));
create index parties_business_phone on parties(business_id, phone) where phone is not null;
create index parties_business_gstin on parties(business_id, gstin) where gstin is not null;
create trigger parties_updated before update on parties for each row execute function app.set_updated_at();

create table party_interactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  party_id uuid not null,
  kind text not null check (kind in ('call', 'visit', 'whatsapp', 'email', 'meeting', 'note')),
  notes text not null,
  follow_up_on date,
  completed_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  foreign key (business_id, party_id) references parties(business_id, id) on delete cascade
);
create index party_interactions_followup on party_interactions(business_id, follow_up_on) where completed_at is null and follow_up_on is not null;
create index party_interactions_party on party_interactions(party_id, created_at desc);

create table categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  parent_id uuid,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, parent_id) references categories(business_id, id)
);
create unique index categories_name_uniq on categories(business_id, lower(name));

create table products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  parent_product_id uuid,
  variant_attributes jsonb,
  name text not null check (length(name) between 1 and 200),
  type text not null default 'goods' check (type in ('goods', 'service')),
  sku text,
  barcode text,
  category_id uuid,
  brand text,
  unit text not null default 'pcs',
  hsn_code text check (hsn_code is null or hsn_code ~ '^[0-9]{4,8}$'),
  description text,
  cost_price numeric(14,2) not null default 0 check (cost_price >= 0),
  selling_price numeric(14,2) not null default 0 check (selling_price >= 0),
  mrp numeric(14,2) check (mrp is null or mrp >= 0),
  tax_rate numeric(5,2) not null default 18 check (tax_rate in (0, 0.1, 0.25, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40)),
  prices_include_tax boolean not null default false,
  track_inventory boolean not null default true,
  track_serials boolean not null default false,
  reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0),
  warranty_months int check (warranty_months is null or warranty_months between 0 and 120),
  archived_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, category_id) references categories(business_id, id),
  foreign key (business_id, parent_product_id) references products(business_id, id),
  check (type = 'goods' or (not track_inventory and not track_serials)),
  check (not track_serials or track_inventory)
);
create unique index products_sku_uniq on products(business_id, lower(sku)) where sku is not null;
create unique index products_barcode_uniq on products(business_id, barcode) where barcode is not null;
create index products_name_trgm on products using gin (name gin_trgm_ops);
create index products_business_name on products(business_id, lower(name));
create trigger products_updated before update on products for each row execute function app.set_updated_at();

-- Current stock per branch, maintained exclusively by the stock_movements trigger.
create table stock_levels (
  business_id uuid not null references businesses(id) on delete cascade,
  branch_id uuid not null,
  product_id uuid not null,
  quantity numeric(14,3) not null default 0,
  avg_cost numeric(14,4) not null default 0 check (avg_cost >= 0),
  updated_at timestamptz not null default now(),
  primary key (branch_id, product_id),
  foreign key (business_id, branch_id) references branches(business_id, id) on delete cascade,
  foreign key (business_id, product_id) references products(business_id, id) on delete cascade
);
create index stock_levels_business on stock_levels(business_id, product_id);

create table approval_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('discount', 'refund', 'stock_adjustment', 'negative_stock', 'payment_void')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'used', 'expired')),
  entity_type text,
  entity_id uuid,
  payload jsonb not null default '{}',
  reason text,
  requested_by uuid not null references users(id),
  decided_by uuid references users(id),
  decided_at timestamptz,
  decision_note text,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, id)
);
create index approval_requests_pending on approval_requests(business_id, created_at desc) where status = 'pending';

-- Append-only inventory ledger. Every change to stock is a row here.
create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  branch_id uuid not null,
  product_id uuid not null,
  quantity numeric(14,3) not null check (quantity <> 0),
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  kind text not null check (kind in ('opening', 'purchase', 'sale', 'sale_return', 'purchase_return', 'adjustment',
                                     'transfer_in', 'transfer_out', 'service_consumption', 'reversal')),
  reason text,
  source_type text,
  source_id uuid,
  source_line_id uuid,
  transfer_group uuid,
  note text,
  allow_negative boolean not null default false,
  approval_id uuid,
  balance_after numeric(14,3),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  foreign key (business_id, branch_id) references branches(business_id, id),
  foreign key (business_id, product_id) references products(business_id, id),
  foreign key (business_id, approval_id) references approval_requests(business_id, id)
);
-- A document line can move stock exactly once per movement kind.
create unique index stock_movements_once on stock_movements(source_line_id, kind) where source_line_id is not null;
create index stock_movements_product on stock_movements(business_id, product_id, created_at desc);
create index stock_movements_source on stock_movements(source_type, source_id);

create or replace function app.apply_stock_movement() returns trigger
language plpgsql as $$
declare
  cur stock_levels%rowtype;
  allow_neg boolean;
  new_qty numeric(14,3);
  tracked boolean;
begin
  select track_inventory into tracked from products where id = new.product_id and business_id = new.business_id;
  if not coalesce(tracked, false) then
    raise exception 'Product does not track inventory' using errcode = 'P0001';
  end if;

  insert into stock_levels(business_id, branch_id, product_id, quantity, avg_cost)
  values (new.business_id, new.branch_id, new.product_id, 0, 0)
  on conflict (branch_id, product_id) do nothing;

  select * into cur from stock_levels where branch_id = new.branch_id and product_id = new.product_id for update;
  new_qty := cur.quantity + new.quantity;

  select coalesce((settings->>'allowNegativeStock')::boolean, false) into allow_neg from businesses where id = new.business_id;
  if new_qty < 0 and not (allow_neg or new.allow_negative) then
    raise exception 'Insufficient stock: available %, required %', cur.quantity, -new.quantity
      using errcode = 'P0002', hint = 'NEGATIVE_STOCK';
  end if;

  update stock_levels set
    quantity = new_qty,
    -- Weighted average cost moves only on priced inward movements.
    avg_cost = case
      when new.quantity > 0 and new.unit_cost > 0 and new.kind in ('opening', 'purchase', 'adjustment', 'transfer_in', 'sale_return') then
        case when cur.quantity <= 0 then new.unit_cost
             else round((cur.quantity * cur.avg_cost + new.quantity * new.unit_cost) / (cur.quantity + new.quantity), 4) end
      else cur.avg_cost end,
    updated_at = now()
  where branch_id = new.branch_id and product_id = new.product_id;

  new.balance_after := new_qty;
  return new;
end $$;
create trigger stock_movements_apply before insert on stock_movements
  for each row execute function app.apply_stock_movement();
create trigger stock_movements_immutable before update or delete on stock_movements
  for each row execute function app.block_mutation();

create table product_serials (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  product_id uuid not null,
  serial_number text not null,
  status text not null default 'in_stock' check (status in ('in_stock', 'sold', 'returned_to_supplier', 'defective')),
  branch_id uuid,
  purchase_document_id uuid,
  sale_document_id uuid,
  party_id uuid,
  sold_on date,
  warranty_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, product_id, serial_number),
  foreign key (business_id, product_id) references products(business_id, id) on delete cascade,
  foreign key (business_id, branch_id) references branches(business_id, id)
);
create index product_serials_lookup on product_serials(business_id, serial_number);
create index product_serials_warranty on product_serials(business_id, warranty_until) where status = 'sold';
create trigger product_serials_updated before update on product_serials for each row execute function app.set_updated_at();
