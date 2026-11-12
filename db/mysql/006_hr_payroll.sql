-- 006 Employees, attendance, leave, salary and payslips.
-- Sensitive IDs: only the last 4 digits of Aadhaar are kept. Bank account numbers
-- are encrypted by the app (AES-256-GCM) before they are stored.

CREATE TABLE employees (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id           BIGINT UNSIGNED NOT NULL,
  user_id             BIGINT UNSIGNED NULL COMMENT 'set when the employee also logs in',
  branch_id           BIGINT UNSIGNED NULL,
  code                VARCHAR(20)  NOT NULL,
  name                VARCHAR(120) NOT NULL,
  mobile              VARCHAR(15)  NULL,
  email               VARCHAR(190) NULL,
  designation         VARCHAR(80)  NULL,
  department          VARCHAR(80)  NULL,
  date_of_birth       DATE         NULL,
  joining_date        DATE         NOT NULL,
  leaving_date        DATE         NULL,
  pan                 CHAR(10)     NULL,
  aadhaar_last4       CHAR(4)      NULL,
  uan                 VARCHAR(12)  NULL COMMENT 'PF',
  esic_no             VARCHAR(17)  NULL,
  bank_account_enc    VARCHAR(255) NULL,
  bank_ifsc           CHAR(11)     NULL,
  address             VARCHAR(500) NULL,
  emergency_contact   VARCHAR(120) NULL,
  status              VARCHAR(12)  NOT NULL DEFAULT 'active',
  created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_employees_tenant_id (tenant_id, id),
  UNIQUE KEY uq_employees_code (tenant_id, code),
  KEY ix_employees_user (tenant_id, user_id),
  CONSTRAINT fk_employees_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_employees_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_employees_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT ck_employees_status CHECK (status IN ('active','on_notice','left'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE employee_documents (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  employee_id  BIGINT UNSIGNED NOT NULL,
  doc_type     VARCHAR(30)  NOT NULL COMMENT 'id_proof, address_proof, offer_letter ...',
  file_id      BIGINT UNSIGNED NOT NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_employee_documents (tenant_id, employee_id),
  CONSTRAINT fk_employee_documents_emp FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, id),
  CONSTRAINT fk_employee_documents_file FOREIGN KEY (tenant_id, file_id) REFERENCES files(tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE attendance (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  employee_id   BIGINT UNSIGNED NOT NULL,
  att_date      DATE         NOT NULL,
  status        VARCHAR(10)  NOT NULL,
  check_in_at   DATETIME(3)  NULL,
  check_out_at  DATETIME(3)  NULL,
  source        VARCHAR(10)  NOT NULL DEFAULT 'manual',
  notes         VARCHAR(255) NULL,
  marked_by     BIGINT UNSIGNED NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_attendance_day (tenant_id, employee_id, att_date),
  KEY ix_attendance_date (tenant_id, att_date),
  CONSTRAINT fk_attendance_emp FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, id),
  CONSTRAINT ck_attendance_status CHECK (status IN ('present','absent','half_day','leave','holiday','week_off')),
  CONSTRAINT ck_attendance_source CHECK (source IN ('manual','check_in'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE leave_types (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id      BIGINT UNSIGNED NOT NULL,
  name           VARCHAR(60)  NOT NULL,
  days_per_year  DECIMAL(5,1) NOT NULL DEFAULT 0,
  is_paid        TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_leave_types_tenant_id (tenant_id, id),
  UNIQUE KEY uq_leave_types_name (tenant_id, name),
  CONSTRAINT fk_leave_types_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE leave_requests (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id      BIGINT UNSIGNED NOT NULL,
  employee_id    BIGINT UNSIGNED NOT NULL,
  leave_type_id  BIGINT UNSIGNED NOT NULL,
  from_date      DATE         NOT NULL,
  to_date        DATE         NOT NULL,
  days           DECIMAL(5,1) NOT NULL,
  reason         VARCHAR(500) NULL,
  status         VARCHAR(12)  NOT NULL DEFAULT 'pending',
  decided_by     BIGINT UNSIGNED NULL,
  decided_at     DATETIME(3)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_leave_requests_emp (tenant_id, employee_id, from_date),
  CONSTRAINT fk_leave_requests_emp FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, id),
  CONSTRAINT fk_leave_requests_type FOREIGN KEY (tenant_id, leave_type_id) REFERENCES leave_types(tenant_id, id),
  CONSTRAINT ck_leave_requests_status CHECK (status IN ('pending','approved','rejected','cancelled')),
  CONSTRAINT ck_leave_requests_dates CHECK (to_date >= from_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Salary structure: monthly amounts. components = [{"name":"HRA","type":"allowance","amount":3000}, ...]
CREATE TABLE salary_structures (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  employee_id     BIGINT UNSIGNED NOT NULL,
  effective_from  DATE         NOT NULL,
  basic           DECIMAL(12,2) NOT NULL,
  components      JSON         NOT NULL,
  pay_basis       VARCHAR(10)  NOT NULL DEFAULT 'monthly' COMMENT 'monthly or daily wage',
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_salary_structures (tenant_id, employee_id, effective_from),
  CONSTRAINT fk_salary_structures_emp FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE salary_advances (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id          BIGINT UNSIGNED NOT NULL,
  employee_id        BIGINT UNSIGNED NOT NULL,
  advance_date       DATE         NOT NULL,
  amount             DECIMAL(12,2) NOT NULL,
  monthly_recovery   DECIMAL(12,2) NOT NULL,
  recovered          DECIMAL(12,2) NOT NULL DEFAULT 0,
  account_id         BIGINT UNSIGNED NULL,
  notes              VARCHAR(255) NULL,
  created_by         BIGINT UNSIGNED NULL,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_salary_advances_emp (tenant_id, employee_id),
  CONSTRAINT fk_salary_advances_emp FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, id),
  CONSTRAINT fk_salary_advances_account FOREIGN KEY (tenant_id, account_id) REFERENCES accounts(tenant_id, id),
  CONSTRAINT ck_salary_advances_amount CHECK (amount > 0 AND recovered <= amount)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payroll_runs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  period_month  CHAR(7)      NOT NULL COMMENT 'YYYY-MM',
  status        VARCHAR(12)  NOT NULL DEFAULT 'draft',
  total_gross   DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_net     DECIMAL(14,2) NOT NULL DEFAULT 0,
  finalised_by  BIGINT UNSIGNED NULL,
  finalised_at  DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payroll_runs_tenant_id (tenant_id, id),
  UNIQUE KEY uq_payroll_runs_month (tenant_id, period_month),
  CONSTRAINT fk_payroll_runs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT ck_payroll_runs_status CHECK (status IN ('draft','finalised','paid'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payslips (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id        BIGINT UNSIGNED NOT NULL,
  payroll_run_id   BIGINT UNSIGNED NOT NULL,
  employee_id      BIGINT UNSIGNED NOT NULL,
  days_in_month    DECIMAL(4,1) NOT NULL,
  paid_days        DECIMAL(4,1) NOT NULL,
  gross            DECIMAL(12,2) NOT NULL,
  total_deductions DECIMAL(12,2) NOT NULL,
  advance_recovery DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_pay          DECIMAL(12,2) NOT NULL,
  breakdown        JSON         NOT NULL,
  pdf_file_id      BIGINT UNSIGNED NULL,
  paid_at          DATETIME(3)  NULL,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payslips (tenant_id, payroll_run_id, employee_id),
  CONSTRAINT fk_payslips_run FOREIGN KEY (tenant_id, payroll_run_id) REFERENCES payroll_runs(tenant_id, id),
  CONSTRAINT fk_payslips_emp FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, id),
  CONSTRAINT fk_payslips_pdf FOREIGN KEY (tenant_id, pdf_file_id) REFERENCES files(tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
