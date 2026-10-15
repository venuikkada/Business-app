#!/usr/bin/env bash
# Compares row counts and money totals between two databases (e.g. production
# and a freshly restored copy) to prove a backup is complete and usable.
# Usage: ./scripts/verify-restore.sh <source-url> <restored-url>
set -euo pipefail
SRC="${1:?source database url}"
DST="${2:?restored database url}"
Q="select 'businesses', count(*)::text from businesses
union all select 'users', count(*)::text from users
union all select 'parties', count(*)::text from parties
union all select 'products', count(*)::text from products
union all select 'documents', count(*)::text from documents
union all select 'document_items', count(*)::text from document_items
union all select 'stock_movements', count(*)::text from stock_movements
union all select 'payments', count(*)::text from payments
union all select 'expenses', count(*)::text from expenses
union all select 'audit_logs', count(*)::text from audit_logs
union all select 'invoice_total', coalesce(sum(grand_total), 0)::text from documents where doc_type = 'invoice' and status <> 'cancelled'
union all select 'stock_qty', coalesce(sum(quantity), 0)::text from stock_levels
union all select 'migrations', string_agg(name, ',' order by name) from schema_migrations"
diff <(psql "$SRC" -At -F'|' -c "$Q") <(psql "$DST" -At -F'|' -c "$Q") && echo "OK: restored database matches source"
