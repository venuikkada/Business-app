# Backup & restore

Two layers — use both in production:

1. **Managed Postgres point-in-time recovery (PITR)** — enable it with at least
   7 days retention (RDS / Cloud SQL / Supabase Pro all offer it). This covers
   "undo the last hour" disasters.
2. **Logical backups you own** with the scripts below, kept off-site and encrypted.
   This covers provider/account loss and lets you prove a restore works.

## Scripts (tested)

```bash
# Backup (custom format, compressed, with SHA-256 checksum; optional GPG encryption)
BACKUP_DATABASE_URL=postgres://owner:…@host/cba BACKUP_GPG_RECIPIENT=ops@your-domain.in \
  ./scripts/backup.sh /secure/backups

# Restore into an EMPTY database (creates the app roles if missing, without login)
createdb cba_restore_test
RESTORE_DATABASE_URL=postgres://owner:…@host/cba_restore_test ./scripts/restore.sh /secure/backups/cba-YYYYMMDD-HHMMSS.dump

# Prove the copy is complete: compares row counts, invoice totals, stock and migrations
./scripts/verify-restore.sh postgres://…/cba postgres://…/cba_restore_test
```

After restoring for real use, set the role passwords again with
`pnpm --filter @cba/server db:setup-roles` and point the apps at the new database.

Verified in development: backup of the seeded demo database → restore into a new
database → `verify-restore.sh` reported every count and total identical.

## Schedule & retention (recommendation)

- Daily logical backup at 02:00 IST; keep 7 daily, 4 weekly, 12 monthly.
- Store in a different cloud account/region-provider than the database, encrypted
  (GPG or bucket SSE-KMS), with object lock / versioning on.
- **Monthly restore drill**: restore the latest backup to a scratch database and run
  `verify-restore.sh`. A backup you have never restored is not a backup.

## Business-level export (for customers)

Owners can download all their own data any time from **Settings → Data → Export**
(ZIP of CSV files per table, scoped by RLS to that business). Deleted businesses
are hidden immediately, restorable for 30 days, then purged by the daily job.

## Files

Uploaded files (logos, attachments) live in the storage bucket, not the database.
Enable bucket versioning and replicate/back it up separately.
