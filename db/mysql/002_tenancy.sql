-- 002 Tenancy: branches, number series, roles, team, audit log, files, jobs, notifications.
-- Rule: every business table has tenant_id, and child rows point to parents with a
-- composite foreign key (tenant_id, x_id) -> parent(tenant_id, id). The database itself
-- then refuses a row that links to another business's data.

CREATE TABLE branches (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  name          VARCHAR(120) NOT NULL,
  code          VARCHAR(10)  NOT NULL COMMENT 'short code used in document numbers',
  gstin         CHAR(15)     NULL COMMENT 'set when the branch is registered in another state',
  state_code    CHAR(2)      NOT NULL,
  address_line1 VARCHAR(200) NULL,
  address_line2 VARCHAR(200) NULL,
  city          VARCHAR(80)  NULL,
  pincode       CHAR(6)      NULL,
  phone         VARCHAR(15)  NULL,
  is_default    TINYINT(1)   NOT NULL DEFAULT 0,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_branches_tenant_id (tenant_id, id),
  UNIQUE KEY uq_branches_code (tenant_id, code),
  CONSTRAINT fk_branches_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gap-free document numbers per branch, document type and financial year.
-- Allocated with SELECT ... FOR UPDATE inside the same transaction as the document.
CREATE TABLE document_series (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  branch_id    BIGINT UNSIGNED NOT NULL,
  doc_type     VARCHAR(30)  NOT NULL,
  fy           CHAR(7)      NOT NULL COMMENT 'e.g. 2026-27',
  prefix       VARCHAR(10)  NOT NULL,
  next_number  INT UNSIGNED NOT NULL DEFAULT 1,
  padding      TINYINT UNSIGNED NOT NULL DEFAULT 4,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_series_tenant_id (tenant_id, id),
  UNIQUE KEY uq_series (tenant_id, branch_id, doc_type, fy),
  CONSTRAINT fk_series_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_series_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT ck_series_doc_type CHECK (doc_type IN ('invoice','quotation','sales_order','delivery_challan','credit_note','debit_note','purchase_order','goods_receipt','supplier_bill','payment_in','payment_out','expense','stock_transfer','stock_adjustment','payslip'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Roles hold a JSON array of permission keys like ["items.view","sales.create"].
-- System roles (owner, admin, manager, cashier, accountant) are created per business.
CREATE TABLE roles (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  role_key     VARCHAR(40)  NOT NULL,
  name         VARCHAR(80)  NOT NULL,
  description  VARCHAR(255) NULL,
  is_system    TINYINT(1)   NOT NULL DEFAULT 0,
  permissions  JSON         NOT NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_tenant_id (tenant_id, id),
  UNIQUE KEY uq_roles_key (tenant_id, role_key),
  CONSTRAINT fk_roles_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A user's place in a business. status: invited -> active -> disabled.
CREATE TABLE memberships (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  role_id       BIGINT UNSIGNED NOT NULL,
  status        VARCHAR(16)  NOT NULL DEFAULT 'invited',
  all_branches  TINYINT(1)   NOT NULL DEFAULT 1,
  display_name  VARCHAR(120) NULL COMMENT 'name as the business knows this person',
  invited_by    BIGINT UNSIGNED NULL,
  joined_at     DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_memberships_tenant_id (tenant_id, id),
  UNIQUE KEY uq_memberships_user (tenant_id, user_id),
  KEY ix_memberships_user (user_id, status),
  CONSTRAINT fk_memberships_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_memberships_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_memberships_role FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id),
  CONSTRAINT fk_memberships_invited_by FOREIGN KEY (invited_by) REFERENCES users(id),
  CONSTRAINT ck_memberships_status CHECK (status IN ('invited','active','disabled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Branch restriction: used only when memberships.all_branches = 0.
CREATE TABLE membership_branches (
  tenant_id      BIGINT UNSIGNED NOT NULL,
  membership_id  BIGINT UNSIGNED NOT NULL,
  branch_id      BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (membership_id, branch_id),
  KEY ix_mb_tenant (tenant_id),
  CONSTRAINT fk_mb_membership FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_mb_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only audit trail: every create, edit and delete, with before/after values.
CREATE TABLE audit_logs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  user_id      BIGINT UNSIGNED NULL COMMENT 'NULL = system job',
  action       VARCHAR(20)  NOT NULL,
  entity_type  VARCHAR(40)  NOT NULL,
  entity_id    BIGINT UNSIGNED NULL,
  summary      VARCHAR(255) NOT NULL,
  changes      JSON         NULL COMMENT '{"field":{"from":..,"to":..}}',
  branch_id    BIGINT UNSIGNED NULL,
  ip           VARCHAR(45)  NULL,
  user_agent   VARCHAR(255) NULL,
  request_id   CHAR(16)     NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_audit_tenant_time (tenant_id, created_at),
  KEY ix_audit_entity (tenant_id, entity_type, entity_id),
  KEY ix_audit_user (tenant_id, user_id, created_at),
  CONSTRAINT fk_audit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT ck_audit_action CHECK (action IN ('create','update','delete','restore','approve','reject','cancel','login','export','import','print','other'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Uploaded and generated files. Bytes live on disk under STORAGE_DIR/t_<tenant_id>/...
CREATE TABLE files (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id      BIGINT UNSIGNED NOT NULL,
  kind           VARCHAR(20)  NOT NULL,
  storage_path   VARCHAR(255) NOT NULL COMMENT 'relative to STORAGE_DIR, never user-controlled',
  original_name  VARCHAR(200) NOT NULL,
  mime_type      VARCHAR(80)  NOT NULL,
  size_bytes     INT UNSIGNED NOT NULL,
  sha256         CHAR(64)     NOT NULL,
  created_by     BIGINT UNSIGNED NULL,
  deleted_at     DATETIME(3)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_files_tenant_id (tenant_id, id),
  KEY ix_files_kind (tenant_id, kind, created_at),
  CONSTRAINT fk_files_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_files_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT ck_files_kind CHECK (kind IN ('logo','item_image','document','employee_doc','pdf','payslip','import','export','backup','attachment'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE tenants
  ADD CONSTRAINT fk_tenants_logo FOREIGN KEY (id, logo_file_id) REFERENCES files(tenant_id, id);

-- Background jobs, processed by the cron runner every minute (max ~50 s per run).
-- tenant_id is NULL only for platform-wide jobs (cleanup, subscription expiry).
CREATE TABLE jobs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id     BIGINT UNSIGNED NULL,
  type          VARCHAR(50)  NOT NULL,
  payload       JSON         NULL,
  status        VARCHAR(12)  NOT NULL DEFAULT 'queued',
  priority      TINYINT UNSIGNED NOT NULL DEFAULT 5 COMMENT '1 = most urgent',
  run_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  attempts      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts  TINYINT UNSIGNED NOT NULL DEFAULT 5,
  dedupe_key    VARCHAR(150) NULL COMMENT 'stops the same job being queued twice',
  locked_by     VARCHAR(60)  NULL,
  locked_at     DATETIME(3)  NULL,
  last_error    TEXT         NULL,
  result        JSON         NULL,
  created_by    BIGINT UNSIGNED NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at   DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_jobs_dedupe (dedupe_key),
  KEY ix_jobs_due (status, run_at, priority),
  KEY ix_jobs_tenant (tenant_id, created_at),
  CONSTRAINT fk_jobs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT ck_jobs_status CHECK (status IN ('queued','running','done','failed','dead'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- In-app notifications (bell icon). Polled by the app every 10-20 seconds.
CREATE TABLE notifications (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NULL COMMENT 'NULL = everyone with the permission below',
  permission  VARCHAR(60)  NULL,
  type        VARCHAR(40)  NOT NULL,
  title       VARCHAR(200) NOT NULL,
  body        VARCHAR(500) NULL,
  link        VARCHAR(200) NULL,
  read_at     DATETIME(3)  NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_notifications_feed (tenant_id, user_id, id),
  CONSTRAINT fk_notifications_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Offline sync safety: a request replayed with the same key returns the first answer.
CREATE TABLE idempotency_keys (
  tenant_id    BIGINT UNSIGNED NOT NULL,
  idem_key     VARCHAR(64)  NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  method_path  VARCHAR(200) NOT NULL,
  status_code  SMALLINT UNSIGNED NOT NULL,
  response     JSON         NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, idem_key),
  KEY ix_idem_created (created_at),
  CONSTRAINT fk_idem_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- FUTURE integrations (IRP e-invoice, e-way bill, payment gateway, online store, Tally).
-- config is encrypted by the app (AES-256-GCM) before it is stored.
CREATE TABLE integrations (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id        BIGINT UNSIGNED NOT NULL,
  provider         VARCHAR(30)  NOT NULL,
  status           VARCHAR(16)  NOT NULL DEFAULT 'disabled',
  config_encrypted TEXT         NULL,
  last_sync_at     DATETIME(3)  NULL,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_integrations (tenant_id, provider),
  CONSTRAINT fk_integrations_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT ck_integrations_provider CHECK (provider IN ('irp_einvoice','eway_bill','payment_gateway','online_store','tally_export','sms','whatsapp_api'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
