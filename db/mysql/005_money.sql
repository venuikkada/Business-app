-- 005 Money: cash / bank / UPI accounts, payments, expenses, day book.

CREATE TABLE accounts (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id        BIGINT UNSIGNED NOT NULL,
  branch_id        BIGINT UNSIGNED NULL,
  account_type     VARCHAR(10)  NOT NULL,
  name             VARCHAR(100) NOT NULL,
  bank_name        VARCHAR(100) NULL,
  account_last4    CHAR(4)      NULL COMMENT 'never store the full account number here',
  ifsc             CHAR(11)     NULL,
  upi_id           VARCHAR(100) NULL,
  opening_balance  DECIMAL(14,2) NOT NULL DEFAULT 0,
  balance          DECIMAL(14,2) NOT NULL DEFAULT 0,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_accounts_tenant_id (tenant_id, id),
  UNIQUE KEY uq_accounts_name (tenant_id, name),
  CONSTRAINT fk_accounts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_accounts_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT ck_accounts_type CHECK (account_type IN ('cash','bank','upi','card','wallet'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payments (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  branch_id     BIGINT UNSIGNED NOT NULL,
  direction     VARCHAR(4)   NOT NULL COMMENT 'in = received, out = paid',
  number        VARCHAR(20)  NOT NULL,
  payment_date  DATE         NOT NULL,
  party_id      BIGINT UNSIGNED NULL,
  account_id    BIGINT UNSIGNED NOT NULL,
  mode          VARCHAR(10)  NOT NULL,
  amount        DECIMAL(14,2) NOT NULL,
  reference     VARCHAR(100) NULL COMMENT 'UPI ref / cheque no / UTR',
  notes         VARCHAR(500) NULL,
  status        VARCHAR(10)  NOT NULL DEFAULT 'posted',
  gateway_ref   VARCHAR(100) NULL COMMENT 'FUTURE: payment gateway',
  client_uuid   CHAR(36)     NULL,
  created_by    BIGINT UNSIGNED NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_tenant_id (tenant_id, id),
  UNIQUE KEY uq_payments_number (tenant_id, direction, number),
  UNIQUE KEY uq_payments_client (tenant_id, client_uuid),
  KEY ix_payments_date (tenant_id, payment_date),
  KEY ix_payments_party (tenant_id, party_id, payment_date),
  CONSTRAINT fk_payments_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT fk_payments_party FOREIGN KEY (tenant_id, party_id) REFERENCES parties(tenant_id, id),
  CONSTRAINT fk_payments_account FOREIGN KEY (tenant_id, account_id) REFERENCES accounts(tenant_id, id),
  CONSTRAINT ck_payments_direction CHECK (direction IN ('in','out')),
  CONSTRAINT ck_payments_mode CHECK (mode IN ('cash','upi','bank','card','cheque','wallet')),
  CONSTRAINT ck_payments_amount CHECK (amount > 0),
  CONSTRAINT ck_payments_status CHECK (status IN ('posted','void'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Which invoices / bills a payment settles (one payment can settle many).
CREATE TABLE payment_allocations (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id           BIGINT UNSIGNED NOT NULL,
  payment_id          BIGINT UNSIGNED NOT NULL,
  sales_document_id   BIGINT UNSIGNED NULL,
  purchase_document_id BIGINT UNSIGNED NULL,
  amount              DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_pa_payment (tenant_id, payment_id),
  KEY ix_pa_sales (tenant_id, sales_document_id),
  KEY ix_pa_purchase (tenant_id, purchase_document_id),
  CONSTRAINT fk_pa_payment FOREIGN KEY (tenant_id, payment_id) REFERENCES payments(tenant_id, id),
  CONSTRAINT fk_pa_sales FOREIGN KEY (tenant_id, sales_document_id) REFERENCES sales_documents(tenant_id, id),
  CONSTRAINT fk_pa_purchase FOREIGN KEY (tenant_id, purchase_document_id) REFERENCES purchase_documents(tenant_id, id),
  CONSTRAINT ck_pa_one_target CHECK ((sales_document_id IS NULL) <> (purchase_document_id IS NULL)),
  CONSTRAINT ck_pa_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE expense_categories (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(80) NOT NULL,
  is_active   TINYINT(1)  NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_expense_categories_tenant_id (tenant_id, id),
  UNIQUE KEY uq_expense_categories_name (tenant_id, name),
  CONSTRAINT fk_expense_categories_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Staff claims start as 'pending' and need approval; owner/manager entries are 'approved'.
CREATE TABLE expenses (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  branch_id       BIGINT UNSIGNED NOT NULL,
  number          VARCHAR(20)  NOT NULL,
  expense_date    DATE         NOT NULL,
  category_id     BIGINT UNSIGNED NOT NULL,
  amount          DECIMAL(14,2) NOT NULL,
  gst_amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  vendor_party_id BIGINT UNSIGNED NULL,
  description     VARCHAR(500) NULL,
  status          VARCHAR(12)  NOT NULL DEFAULT 'approved',
  is_staff_claim  TINYINT(1)   NOT NULL DEFAULT 0,
  claimed_by      BIGINT UNSIGNED NULL,
  approved_by     BIGINT UNSIGNED NULL,
  approved_at     DATETIME(3)  NULL,
  reject_reason   VARCHAR(255) NULL,
  paid_from_account_id BIGINT UNSIGNED NULL,
  attachment_file_id BIGINT UNSIGNED NULL,
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_expenses_tenant_id (tenant_id, id),
  UNIQUE KEY uq_expenses_number (tenant_id, number),
  KEY ix_expenses_date (tenant_id, expense_date),
  KEY ix_expenses_status (tenant_id, status),
  CONSTRAINT fk_expenses_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT fk_expenses_category FOREIGN KEY (tenant_id, category_id) REFERENCES expense_categories(tenant_id, id),
  CONSTRAINT fk_expenses_vendor FOREIGN KEY (tenant_id, vendor_party_id) REFERENCES parties(tenant_id, id),
  CONSTRAINT fk_expenses_account FOREIGN KEY (tenant_id, paid_from_account_id) REFERENCES accounts(tenant_id, id),
  CONSTRAINT fk_expenses_file FOREIGN KEY (tenant_id, attachment_file_id) REFERENCES files(tenant_id, id),
  CONSTRAINT ck_expenses_status CHECK (status IN ('pending','approved','rejected','paid')),
  CONSTRAINT ck_expenses_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Day book: every money movement in/out of an account (payments, expenses, transfers).
CREATE TABLE account_entries (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  account_id   BIGINT UNSIGNED NOT NULL,
  entry_date   DATE         NOT NULL,
  amount       DECIMAL(14,2) NOT NULL COMMENT '+ money in, - money out',
  ref_type     VARCHAR(30)  NOT NULL,
  ref_id       BIGINT UNSIGNED NULL,
  narration    VARCHAR(255) NULL,
  created_by   BIGINT UNSIGNED NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_account_entries_daybook (tenant_id, entry_date),
  KEY ix_account_entries_account (tenant_id, account_id, entry_date),
  KEY ix_account_entries_ref (tenant_id, ref_type, ref_id),
  CONSTRAINT fk_account_entries_account FOREIGN KEY (tenant_id, account_id) REFERENCES accounts(tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
