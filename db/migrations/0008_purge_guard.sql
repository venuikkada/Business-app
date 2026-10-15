-- Defence in depth: the "purge" bypass in the protection triggers must only work
-- inside the privileged SECURITY DEFINER purge routine, never for the application
-- roles. (Any role can call set_config('app.purge', 'on'), so the setting alone
-- is not enough — a SQL-injection bug must not be able to rewrite issued
-- invoices, payments or history.)
create or replace function app.purge_active() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.purge', true), '') = 'on'
     and current_user not in ('cba_app', 'cba_platform')
$$;

create or replace function app.block_mutation() returns trigger
language plpgsql as $$
begin
  if app.purge_active() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end $$;

create or replace function app.protect_document() returns trigger
language plpgsql as $$
begin
  if app.purge_active() then
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

create or replace function app.protect_document_item() returns trigger
language plpgsql as $$
declare
  st text;
begin
  if app.purge_active() then
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

create or replace function app.protect_payment() returns trigger
language plpgsql as $$
begin
  if app.purge_active() then
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
