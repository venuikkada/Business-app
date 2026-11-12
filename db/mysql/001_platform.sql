-- 001 Platform: users, businesses (tenants), sessions, OTP, rate limits.
-- Compatible with MySQL 8.0+ and MariaDB 10.6+ (Hostinger uses MariaDB).
-- All times are stored in UTC. Business dates (invoice date etc.) are DATE in IST.

CREATE TABLE users (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name                VARCHAR(120) NOT NULL DEFAULT '',
  mobile              VARCHAR(15)  NULL COMMENT 'E.164, e.g. +919876543210',
  email               VARCHAR(190) NULL COMMENT 'stored lower-case',
  password_hash       VARCHAR(100) NULL COMMENT 'bcrypt; NULL = OTP-only account',
  mobile_verified_at  DATETIME(3)  NULL,
  email_verified_at   DATETIME(3)  NULL,
  language            VARCHAR(10)  NOT NULL DEFAULT 'en',
  status              VARCHAR(16)  NOT NULL DEFAULT 'active',
  failed_logins       INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until        DATETIME(3)  NULL,
  password_changed_at DATETIME(3)  NULL,
  last_login_at       DATETIME(3)  NULL,
  created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_mobile (mobile),
  UNIQUE KEY uq_users_email (email),
  CONSTRAINT ck_users_contact CHECK (mobile IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT ck_users_language CHECK (language IN ('en','hi','te','hinglish')),
  CONSTRAINT ck_users_status CHECK (status IN ('active','disabled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A tenant = one business. A user can own or work in many businesses.
CREATE TABLE tenants (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name                  VARCHAR(150) NOT NULL,
  legal_name            VARCHAR(200) NULL,
  gstin                 CHAR(15)     NULL,
  pan                   CHAR(10)     NULL,
  state_code            CHAR(2)      NOT NULL COMMENT 'GST state code of the main place of business',
  address_line1         VARCHAR(200) NULL,
  address_line2         VARCHAR(200) NULL,
  city                  VARCHAR(80)  NULL,
  pincode               CHAR(6)      NULL,
  phone                 VARCHAR(15)  NULL,
  email                 VARCHAR(190) NULL,
  sector                VARCHAR(30)  NOT NULL,
  fy_start_month        TINYINT UNSIGNED NOT NULL DEFAULT 4 COMMENT '4 = April-March',
  timezone              VARCHAR(40)  NOT NULL DEFAULT 'Asia/Kolkata',
  currency              CHAR(3)      NOT NULL DEFAULT 'INR',
  default_language      VARCHAR(10)  NOT NULL DEFAULT 'en',
  logo_file_id          BIGINT UNSIGNED NULL,
  settings              JSON         NULL COMMENT 'small per-business preferences',
  -- subscription
  plan                  VARCHAR(30)  NOT NULL DEFAULT 'trial',
  subscription_status   VARCHAR(16)  NOT NULL DEFAULT 'trial',
  subscription_ends_at  DATETIME(3)  NULL,
  -- FUTURE: e-invoice (IRN) is mandatory above the turnover threshold
  aggregate_turnover_band VARCHAR(20) NULL COMMENT 'e.g. below_5cr, 5cr_plus; decides e-invoice need',
  einvoice_enabled      TINYINT(1)   NOT NULL DEFAULT 0,
  ewaybill_enabled      TINYINT(1)   NOT NULL DEFAULT 0,
  status                VARCHAR(16)  NOT NULL DEFAULT 'active',
  created_by            BIGINT UNSIGNED NOT NULL,
  deleted_at            DATETIME(3)  NULL,
  created_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_tenants_gstin (gstin),
  KEY ix_tenants_sub (subscription_status, subscription_ends_at),
  CONSTRAINT fk_tenants_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT ck_tenants_sector CHECK (sector IN ('retail','restaurant','hotel','electronics','garment','pharmacy','wholesale','services','salon','manufacturing')),
  CONSTRAINT ck_tenants_fy CHECK (fy_start_month BETWEEN 1 AND 12),
  CONSTRAINT ck_tenants_status CHECK (status IN ('active','suspended','deleted')),
  CONSTRAINT ck_tenants_sub CHECK (subscription_status IN ('trial','active','grace','expired','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Which sector modules are switched on (the primary sector + any extras later).
CREATE TABLE tenant_modules (
  tenant_id   BIGINT UNSIGNED NOT NULL,
  module_key  VARCHAR(30) NOT NULL,
  enabled_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, module_key),
  CONSTRAINT fk_tenant_modules_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Subscription history (FUTURE: payment gateway reference).
CREATE TABLE subscriptions (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id      BIGINT UNSIGNED NOT NULL,
  plan           VARCHAR(30)  NOT NULL,
  starts_at      DATETIME(3)  NOT NULL,
  ends_at        DATETIME(3)  NOT NULL,
  amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  gateway        VARCHAR(30)  NULL,
  gateway_ref    VARCHAR(100) NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_subscriptions_tenant (tenant_id, ends_at),
  CONSTRAINT fk_subscriptions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per signed-in device. Revoking sets revoked_at; checked on every request.
CREATE TABLE sessions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  tenant_id     BIGINT UNSIGNED NULL COMMENT 'business currently open on this device',
  user_agent    VARCHAR(255) NULL,
  ip            VARCHAR(45)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at    DATETIME(3)  NOT NULL COMMENT 'absolute limit, refresh cannot extend past it',
  revoked_at    DATETIME(3)  NULL,
  revoke_reason VARCHAR(40)  NULL,
  PRIMARY KEY (id),
  KEY ix_sessions_user (user_id, revoked_at),
  KEY ix_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_sessions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Refresh tokens rotate on every use. Only a SHA-256 hash is stored.
-- Re-use of an already used token = theft signal -> whole session revoked.
CREATE TABLE refresh_tokens (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id  BIGINT UNSIGNED NOT NULL,
  token_hash  CHAR(64)    NOT NULL,
  expires_at  DATETIME(3) NOT NULL,
  used_at     DATETIME(3) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_hash (token_hash),
  KEY ix_refresh_session (session_id),
  KEY ix_refresh_expires (expires_at),
  CONSTRAINT fk_refresh_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- OTP codes: only an HMAC of the code is stored.
CREATE TABLE otp_codes (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  purpose      VARCHAR(20)  NOT NULL,
  mobile       VARCHAR(15)  NOT NULL,
  code_hash    CHAR(64)     NOT NULL,
  attempts     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at   DATETIME(3)  NOT NULL,
  consumed_at  DATETIME(3)  NULL,
  ip           VARCHAR(45)  NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_otp_lookup (mobile, purpose, created_at),
  KEY ix_otp_expires (expires_at),
  CONSTRAINT ck_otp_purpose CHECK (purpose IN ('login','reset_password','verify_mobile'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fixed-window counters for rate limiting (no Redis on shared hosting).
CREATE TABLE rate_limits (
  bucket        VARCHAR(190) NOT NULL,
  window_start  DATETIME     NOT NULL,
  hits          INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start),
  KEY ix_rate_limits_window (window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Security log for sign-in activity (not tied to one business).
CREATE TABLE auth_events (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NULL,
  event       VARCHAR(40)  NOT NULL,
  identifier  VARCHAR(190) NULL COMMENT 'masked mobile/email',
  success     TINYINT(1)   NOT NULL,
  ip          VARCHAR(45)  NULL,
  user_agent  VARCHAR(255) NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_auth_events_user (user_id, created_at),
  KEY ix_auth_events_created (created_at),
  CONSTRAINT fk_auth_events_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
