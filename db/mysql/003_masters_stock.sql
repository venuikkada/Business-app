-- 003 Items, parties and stock. Defined in Step 1, used from Step 2 (retail) onwards.
-- Stock is always held per item VARIANT. An item without sizes/colours gets one
-- default variant, so barcode scans, stock and billing all work the same way.

CREATE TABLE units (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id  BIGINT UNSIGNED NOT NULL,
  code       VARCHAR(10)  NOT NULL COMMENT 'UQC code for GST returns, e.g. PCS, KGS, NOS',
  name       VARCHAR(40)  NOT NULL,
  decimals   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_units_tenant_id (tenant_id, id),
  UNIQUE KEY uq_units_code (tenant_id, code),
  CONSTRAINT fk_units_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE item_categories (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id  BIGINT UNSIGNED NOT NULL,
  parent_id  BIGINT UNSIGNED NULL,
  name       VARCHAR(100) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_item_categories_tenant_id (tenant_id, id),
  UNIQUE KEY uq_item_categories_name (tenant_id, parent_id, name),
  CONSTRAINT fk_item_categories_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_item_categories_parent FOREIGN KEY (tenant_id, parent_id) REFERENCES item_categories(tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE items (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id          BIGINT UNSIGNED NOT NULL,
  item_type          VARCHAR(10)  NOT NULL DEFAULT 'goods',
  name               VARCHAR(200) NOT NULL,
  name_local         VARCHAR(200) NULL COMMENT 'name in Hindi/Telugu for bills',
  category_id        BIGINT UNSIGNED NULL,
  unit_id            BIGINT UNSIGNED NOT NULL,
  hsn_sac            VARCHAR(8)   NULL,
  gst_rate           DECIMAL(5,2) NOT NULL DEFAULT 0,
  cess_rate          DECIMAL(5,2) NOT NULL DEFAULT 0,
  price_includes_tax TINYINT(1)   NOT NULL DEFAULT 1,
  track_stock        TINYINT(1)   NOT NULL DEFAULT 1,
  track_batch        TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'batch + expiry (pharmacy, FMCG)',
  track_serial       TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'serial / IMEI (electronics)',
  has_variants       TINYINT(1)   NOT NULL DEFAULT 0,
  variant_attributes JSON         NULL COMMENT '["size","colour"]',
  low_stock_qty      DECIMAL(14,3) NULL,
  warranty_months    SMALLINT UNSIGNED NULL,
  description        TEXT         NULL,
  sector_data        JSON         NULL COMMENT 'sector extras, e.g. {"prescription_required":true}',
  is_active          TINYINT(1)   NOT NULL DEFAULT 1,
  created_by         BIGINT UNSIGNED NULL,
  deleted_at         DATETIME(3)  NULL,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_items_tenant_id (tenant_id, id),
  KEY ix_items_name (tenant_id, name),
  KEY ix_items_category (tenant_id, category_id),
  CONSTRAINT fk_items_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_items_category FOREIGN KEY (tenant_id, category_id) REFERENCES item_categories(tenant_id, id),
  CONSTRAINT fk_items_unit FOREIGN KEY (tenant_id, unit_id) REFERENCES units(tenant_id, id),
  CONSTRAINT ck_items_type CHECK (item_type IN ('goods','service')),
  CONSTRAINT ck_items_gst CHECK (gst_rate >= 0 AND gst_rate <= 40)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE item_variants (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  item_id         BIGINT UNSIGNED NOT NULL,
  sku             VARCHAR(60)  NOT NULL,
  barcode         VARCHAR(60)  NULL,
  attributes      JSON         NULL COMMENT '{"size":"M","colour":"Red"}',
  sale_price      DECIMAL(14,2) NOT NULL DEFAULT 0,
  mrp             DECIMAL(14,2) NULL,
  purchase_price  DECIMAL(14,2) NOT NULL DEFAULT 0,
  is_default      TINYINT(1)   NOT NULL DEFAULT 1,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_item_variants_tenant_id (tenant_id, id),
  UNIQUE KEY uq_item_variants_sku (tenant_id, sku),
  KEY ix_item_variants_barcode (tenant_id, barcode),
  KEY ix_item_variants_item (tenant_id, item_id),
  CONSTRAINT fk_item_variants_item FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE item_images (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id  BIGINT UNSIGNED NOT NULL,
  item_id    BIGINT UNSIGNED NOT NULL,
  file_id    BIGINT UNSIGNED NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_item_images_item (tenant_id, item_id),
  CONSTRAINT fk_item_images_item FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id),
  CONSTRAINT fk_item_images_file FOREIGN KEY (tenant_id, file_id) REFERENCES files(tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE batches (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  variant_id      BIGINT UNSIGNED NOT NULL,
  batch_no        VARCHAR(40)  NOT NULL,
  mfg_date        DATE         NULL,
  expiry_date     DATE         NULL,
  mrp             DECIMAL(14,2) NULL,
  purchase_price  DECIMAL(14,2) NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_batches_tenant_id (tenant_id, id),
  UNIQUE KEY uq_batches_no (tenant_id, variant_id, batch_no),
  KEY ix_batches_expiry (tenant_id, expiry_date),
  CONSTRAINT fk_batches_variant FOREIGN KEY (tenant_id, variant_id) REFERENCES item_variants(tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per physical unit with a serial number or IMEI.
CREATE TABLE serials (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id        BIGINT UNSIGNED NOT NULL,
  variant_id       BIGINT UNSIGNED NOT NULL,
  branch_id        BIGINT UNSIGNED NULL,
  serial_no        VARCHAR(60)  NOT NULL,
  imei2            VARCHAR(20)  NULL,
  status           VARCHAR(16)  NOT NULL DEFAULT 'in_stock',
  purchase_doc_id  BIGINT UNSIGNED NULL,
  sale_doc_id      BIGINT UNSIGNED NULL,
  warranty_until   DATE         NULL,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_serials_tenant_id (tenant_id, id),
  UNIQUE KEY uq_serials_no (tenant_id, serial_no),
  KEY ix_serials_variant (tenant_id, variant_id, status),
  CONSTRAINT fk_serials_variant FOREIGN KEY (tenant_id, variant_id) REFERENCES item_variants(tenant_id, id),
  CONSTRAINT fk_serials_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT ck_serials_status CHECK (status IN ('in_stock','sold','returned','in_repair','scrapped','in_transit'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Current quantity per branch and variant (fast reads). The ledger below is the truth.
CREATE TABLE stock_levels (
  tenant_id   BIGINT UNSIGNED NOT NULL,
  branch_id   BIGINT UNSIGNED NOT NULL,
  variant_id  BIGINT UNSIGNED NOT NULL,
  qty         DECIMAL(14,3) NOT NULL DEFAULT 0,
  avg_cost    DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT 'weighted average, for valuation',
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, branch_id, variant_id),
  CONSTRAINT fk_stock_levels_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT fk_stock_levels_variant FOREIGN KEY (tenant_id, variant_id) REFERENCES item_variants(tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE batch_stock (
  tenant_id   BIGINT UNSIGNED NOT NULL,
  branch_id   BIGINT UNSIGNED NOT NULL,
  batch_id    BIGINT UNSIGNED NOT NULL,
  qty         DECIMAL(14,3) NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, branch_id, batch_id),
  CONSTRAINT fk_batch_stock_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT fk_batch_stock_batch FOREIGN KEY (tenant_id, batch_id) REFERENCES batches(tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Stock ledger: every in/out is a row. qty is positive for IN, negative for OUT.
CREATE TABLE stock_movements (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  branch_id    BIGINT UNSIGNED NOT NULL,
  variant_id   BIGINT UNSIGNED NOT NULL,
  batch_id     BIGINT UNSIGNED NULL,
  serial_id    BIGINT UNSIGNED NULL,
  qty          DECIMAL(14,3) NOT NULL,
  unit_cost    DECIMAL(14,4) NOT NULL DEFAULT 0,
  movement_type VARCHAR(20) NOT NULL,
  ref_type     VARCHAR(30)  NULL,
  ref_id       BIGINT UNSIGNED NULL,
  reason       VARCHAR(200) NULL,
  movement_date DATE        NOT NULL,
  created_by   BIGINT UNSIGNED NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_stock_movements_variant (tenant_id, variant_id, branch_id, movement_date),
  KEY ix_stock_movements_ref (tenant_id, ref_type, ref_id),
  CONSTRAINT fk_stock_movements_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT fk_stock_movements_variant FOREIGN KEY (tenant_id, variant_id) REFERENCES item_variants(tenant_id, id),
  CONSTRAINT fk_stock_movements_batch FOREIGN KEY (tenant_id, batch_id) REFERENCES batches(tenant_id, id),
  CONSTRAINT fk_stock_movements_serial FOREIGN KEY (tenant_id, serial_id) REFERENCES serials(tenant_id, id),
  CONSTRAINT ck_stock_movements_type CHECK (movement_type IN ('opening','purchase','sale','sale_return','purchase_return','transfer_out','transfer_in','adjustment','production_in','production_out','recipe_consumption','repair'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_transfers (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  number          VARCHAR(20)  NOT NULL,
  from_branch_id  BIGINT UNSIGNED NOT NULL,
  to_branch_id    BIGINT UNSIGNED NOT NULL,
  transfer_date   DATE         NOT NULL,
  status          VARCHAR(12)  NOT NULL DEFAULT 'draft',
  notes           VARCHAR(500) NULL,
  created_by      BIGINT UNSIGNED NULL,
  received_by     BIGINT UNSIGNED NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_stock_transfers_tenant_id (tenant_id, id),
  UNIQUE KEY uq_stock_transfers_number (tenant_id, number),
  CONSTRAINT fk_stock_transfers_from FOREIGN KEY (tenant_id, from_branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT fk_stock_transfers_to FOREIGN KEY (tenant_id, to_branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT ck_stock_transfers_status CHECK (status IN ('draft','dispatched','received','cancelled')),
  CONSTRAINT ck_stock_transfers_branches CHECK (from_branch_id <> to_branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_transfer_lines (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  transfer_id  BIGINT UNSIGNED NOT NULL,
  variant_id   BIGINT UNSIGNED NOT NULL,
  batch_id     BIGINT UNSIGNED NULL,
  qty          DECIMAL(14,3) NOT NULL,
  serial_ids   JSON NULL,
  PRIMARY KEY (id),
  KEY ix_stl_transfer (tenant_id, transfer_id),
  CONSTRAINT fk_stl_transfer FOREIGN KEY (tenant_id, transfer_id) REFERENCES stock_transfers(tenant_id, id),
  CONSTRAINT fk_stl_variant FOREIGN KEY (tenant_id, variant_id) REFERENCES item_variants(tenant_id, id),
  CONSTRAINT fk_stl_batch FOREIGN KEY (tenant_id, batch_id) REFERENCES batches(tenant_id, id),
  CONSTRAINT ck_stl_qty CHECK (qty > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_adjustments (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  branch_id     BIGINT UNSIGNED NOT NULL,
  number        VARCHAR(20)  NOT NULL,
  adjust_date   DATE         NOT NULL,
  reason        VARCHAR(30)  NOT NULL,
  notes         VARCHAR(500) NULL,
  status        VARCHAR(16)  NOT NULL DEFAULT 'pending',
  created_by    BIGINT UNSIGNED NULL,
  approved_by   BIGINT UNSIGNED NULL,
  approved_at   DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_stock_adjustments_tenant_id (tenant_id, id),
  UNIQUE KEY uq_stock_adjustments_number (tenant_id, number),
  CONSTRAINT fk_stock_adjustments_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT ck_stock_adjustments_reason CHECK (reason IN ('damaged','expired','lost','theft','count_correction','sample','own_use','other')),
  CONSTRAINT ck_stock_adjustments_status CHECK (status IN ('pending','approved','rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_adjustment_lines (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id      BIGINT UNSIGNED NOT NULL,
  adjustment_id  BIGINT UNSIGNED NOT NULL,
  variant_id     BIGINT UNSIGNED NOT NULL,
  batch_id       BIGINT UNSIGNED NULL,
  qty_change     DECIMAL(14,3) NOT NULL COMMENT 'negative = reduce stock',
  PRIMARY KEY (id),
  KEY ix_sal_adjustment (tenant_id, adjustment_id),
  CONSTRAINT fk_sal_adjustment FOREIGN KEY (tenant_id, adjustment_id) REFERENCES stock_adjustments(tenant_id, id),
  CONSTRAINT fk_sal_variant FOREIGN KEY (tenant_id, variant_id) REFERENCES item_variants(tenant_id, id),
  CONSTRAINT fk_sal_batch FOREIGN KEY (tenant_id, batch_id) REFERENCES batches(tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Customer groups: wholesale price lists hang off these later (sector 7).
CREATE TABLE customer_groups (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(80) NOT NULL,
  discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_groups_tenant_id (tenant_id, id),
  UNIQUE KEY uq_customer_groups_name (tenant_id, name),
  CONSTRAINT fk_customer_groups_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE parties (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id          BIGINT UNSIGNED NOT NULL,
  party_type         VARCHAR(10)  NOT NULL,
  name               VARCHAR(200) NOT NULL,
  mobile             VARCHAR(15)  NULL,
  email              VARCHAR(190) NULL,
  gstin              CHAR(15)     NULL,
  pan                CHAR(10)     NULL,
  state_code         CHAR(2)      NULL COMMENT 'decides CGST+SGST vs IGST',
  billing_address    VARCHAR(500) NULL,
  shipping_address   VARCHAR(500) NULL,
  pincode            CHAR(6)      NULL,
  customer_group_id  BIGINT UNSIGNED NULL,
  credit_limit       DECIMAL(14,2) NULL,
  credit_days        SMALLINT UNSIGNED NULL,
  opening_balance    DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT '+ = they owe us, - = we owe them',
  balance            DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'cached from party_ledger',
  notes              TEXT         NULL COMMENT 'last write wins',
  sector_data        JSON         NULL COMMENT 'e.g. measurements, date of birth',
  is_active          TINYINT(1)   NOT NULL DEFAULT 1,
  created_by         BIGINT UNSIGNED NULL,
  deleted_at         DATETIME(3)  NULL,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_parties_tenant_id (tenant_id, id),
  KEY ix_parties_name (tenant_id, party_type, name),
  KEY ix_parties_mobile (tenant_id, mobile),
  KEY ix_parties_gstin (tenant_id, gstin),
  CONSTRAINT fk_parties_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_parties_group FOREIGN KEY (tenant_id, customer_group_id) REFERENCES customer_groups(tenant_id, id),
  CONSTRAINT ck_parties_type CHECK (party_type IN ('customer','supplier','both'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Party ledger: debit = they owe more (sale), credit = they owe less (payment received).
CREATE TABLE party_ledger (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  party_id    BIGINT UNSIGNED NOT NULL,
  entry_date  DATE         NOT NULL,
  ref_type    VARCHAR(30)  NOT NULL,
  ref_id      BIGINT UNSIGNED NULL,
  debit       DECIMAL(14,2) NOT NULL DEFAULT 0,
  credit      DECIMAL(14,2) NOT NULL DEFAULT 0,
  narration   VARCHAR(255) NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_party_ledger_party (tenant_id, party_id, entry_date),
  KEY ix_party_ledger_ref (tenant_id, ref_type, ref_id),
  CONSTRAINT fk_party_ledger_party FOREIGN KEY (tenant_id, party_id) REFERENCES parties(tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
