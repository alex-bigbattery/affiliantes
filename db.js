import pg from 'pg'
import { config } from 'dotenv'

config()

const { Pool } = pg

// Supabase session pooler allows ~15 clients total (shared with commission project).
// Keep this low; use the transaction pooler URL (port 6543) on Render if you need more.
const poolMax = Number.parseInt(process.env.PG_POOL_MAX || '', 10) || 3

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolMax,
  idleTimeoutMillis: 20_000,
  connectionTimeoutMillis: 15_000,
})

export async function initTables() {
  // Mark any stale running syncs as interrupted (server crashed mid-sync)
  await pool.query(`
    UPDATE awp_sync_log SET status='interrupted', finished_at=NOW()
    WHERE status='running' AND finished_at IS NULL
  `).catch(() => {})

  await pool.query(`
    CREATE TABLE IF NOT EXISTS awp_affiliates (
      affiliate_id   INTEGER PRIMARY KEY,
      user_id        INTEGER,
      username       TEXT,
      email          TEXT,
      display_name   TEXT,
      status         TEXT,
      rate           TEXT,
      rate_type      TEXT,
      earnings       NUMERIC(12,2) DEFAULT 0,
      unpaid_earnings NUMERIC(12,2) DEFAULT 0,
      referrals      INTEGER DEFAULT 0,
      visits         INTEGER DEFAULT 0,
      payment_email  TEXT,
      date_registered TIMESTAMPTZ,
      raw            JSONB,
      synced_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS awp_referrals (
      referral_id    INTEGER PRIMARY KEY,
      affiliate_id   INTEGER,
      visit_id       INTEGER,
      description    TEXT,
      amount         NUMERIC(12,2) DEFAULT 0,
      currency       TEXT,
      status         TEXT,
      reference      TEXT,
      context        TEXT,
      campaign       TEXT,
      custom         TEXT,
      date           TIMESTAMPTZ,
      raw            JSONB,
      synced_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS awp_payouts (
      payout_id      INTEGER PRIMARY KEY,
      affiliate_id   INTEGER,
      referrals      JSONB,
      amount         NUMERIC(12,2) DEFAULT 0,
      currency       TEXT,
      status         TEXT,
      payout_method  TEXT,
      date           TIMESTAMPTZ,
      raw            JSONB,
      synced_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS awp_visits (
      visit_id       INTEGER PRIMARY KEY,
      affiliate_id   INTEGER,
      referral_id    INTEGER,
      url            TEXT,
      referrer       TEXT,
      campaign       TEXT,
      context        TEXT,
      ip             TEXT,
      date           TIMESTAMPTZ,
      raw            JSONB,
      synced_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS awp_sync_log (
      id             SERIAL PRIMARY KEY,
      started_at     TIMESTAMPTZ DEFAULT NOW(),
      finished_at    TIMESTAMPTZ,
      status         TEXT DEFAULT 'running',
      affiliates_synced  INTEGER DEFAULT 0,
      referrals_synced   INTEGER DEFAULT 0,
      payouts_synced     INTEGER DEFAULT 0,
      visits_synced      INTEGER DEFAULT 0,
      error          TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_referrals_affiliate ON awp_referrals(affiliate_id);
    CREATE INDEX IF NOT EXISTS idx_referrals_status ON awp_referrals(status);
    CREATE INDEX IF NOT EXISTS idx_referrals_date ON awp_referrals(date);
    CREATE INDEX IF NOT EXISTS idx_payouts_affiliate ON awp_payouts(affiliate_id);
    CREATE INDEX IF NOT EXISTS idx_visits_affiliate ON awp_visits(affiliate_id);

    -- Coupon → affiliate mapping. Coupon stats come live from sales_orders
    -- (Zoho cf_coupon_s); this table only stores the human classification.
    CREATE TABLE IF NOT EXISTS coupon_map (
      coupon_code     TEXT PRIMARY KEY,
      kind            TEXT DEFAULT 'unclassified',  -- affiliate | promo | unclassified
      affiliate_name  TEXT,
      affiliate_email TEXT,
      affiliate_id    INTEGER,
      rate            NUMERIC(5,2),                  -- commission % (not the customer discount)
      confirmed       BOOLEAN DEFAULT FALSE,
      notes           TEXT,
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );

    -- Banner / material library for affiliates (managed in this dashboard).
    CREATE TABLE IF NOT EXISTS creatives_library (
      id              SERIAL PRIMARY KEY,
      name            TEXT NOT NULL,
      type            TEXT DEFAULT 'banner',   -- banner | text | email | video
      image_url       TEXT,
      destination_url TEXT,
      width           INTEGER,
      height          INTEGER,
      description     TEXT,
      promo_text      TEXT,
      active          BOOLEAN DEFAULT TRUE,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );

    -- Simple key/value settings (referral link base, etc.)
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- WooCommerce coupons (synced from /wp-json/wc/v3/coupons)
    CREATE TABLE IF NOT EXISTS wc_coupons (
      coupon_id            INTEGER PRIMARY KEY,
      code                   TEXT NOT NULL,
      code_normalized        TEXT NOT NULL,
      status                 TEXT,
      discount_type          TEXT,
      amount                 NUMERIC(12,2) DEFAULT 0,
      description            TEXT,
      date_created           TIMESTAMPTZ,
      date_modified          TIMESTAMPTZ,
      date_expires           TIMESTAMPTZ,
      usage_count            INTEGER DEFAULT 0,
      usage_limit            INTEGER,
      usage_limit_per_user   INTEGER,
      individual_use         BOOLEAN DEFAULT FALSE,
      free_shipping          BOOLEAN DEFAULT FALSE,
      minimum_amount         NUMERIC(12,2) DEFAULT 0,
      maximum_amount         NUMERIC(12,2) DEFAULT 0,
      product_ids            JSONB,
      excluded_product_ids   JSONB,
      product_categories     JSONB,
      email_restrictions     JSONB,
      used_by                JSONB,
      meta_data              JSONB,
      raw                    JSONB,
      synced_at              TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_wc_coupons_code ON wc_coupons(code_normalized);
    CREATE INDEX IF NOT EXISTS idx_wc_coupons_status ON wc_coupons(status);

    CREATE TABLE IF NOT EXISTS wc_sync_log (
      id              SERIAL PRIMARY KEY,
      started_at      TIMESTAMPTZ DEFAULT NOW(),
      finished_at     TIMESTAMPTZ,
      status          TEXT DEFAULT 'running',
      coupons_synced  INTEGER DEFAULT 0,
      orders_synced   INTEGER DEFAULT 0,
      error           TEXT
    );

    -- WooCommerce order id ↔ BB order number (for wp-admin links)
    CREATE TABLE IF NOT EXISTS wc_orders (
      order_id        INTEGER PRIMARY KEY,
      order_number    TEXT NOT NULL,
      order_number_norm TEXT NOT NULL,
      status          TEXT,
      date_created    TIMESTAMPTZ,
      synced_at       TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_wc_orders_number ON wc_orders(order_number_norm);
    CREATE INDEX IF NOT EXISTS idx_wc_orders_status ON wc_orders(status);

    -- Manual sales tax rate overrides (Sales Tax tab — stored in Supabase Postgres)
    CREATE TABLE IF NOT EXISTS sales_tax_overrides (
      salesorder_number TEXT PRIMARY KEY,
      rate              NUMERIC(10,6) NOT NULL,
      tax_amount        NUMERIC(12,2),
      provider          TEXT NOT NULL DEFAULT 'state_avg',
      notes             TEXT,
      updated_by        TEXT,
      updated_at        TIMESTAMPTZ DEFAULT NOW()
    );
  `)

  await pool.query(`
    ALTER TABLE wc_orders ADD COLUMN IF NOT EXISTS customer_name TEXT;
    ALTER TABLE wc_orders ADD COLUMN IF NOT EXISTS total NUMERIC(12,2);
    ALTER TABLE wc_orders ADD COLUMN IF NOT EXISTS sub_total NUMERIC(12,2);
    ALTER TABLE wc_orders ADD COLUMN IF NOT EXISTS coupon_code TEXT;
    ALTER TABLE wc_orders ADD COLUMN IF NOT EXISTS net_sales NUMERIC(12,2);
    ALTER TABLE wc_orders ADD COLUMN IF NOT EXISTS items_sold INTEGER;
    ALTER TABLE wc_orders ADD COLUMN IF NOT EXISTS raw JSONB;
  `).catch(() => {})

  // wc_sync_log.orders_synced added after initial deploy
  await pool.query(`
    ALTER TABLE wc_sync_log ADD COLUMN IF NOT EXISTS orders_synced INTEGER DEFAULT 0
  `).catch(() => {})
  console.log('  ✔ Supabase tables ready')
  await seedCouponMap()
  await seedSettings()
}

export async function seedSettings() {
  // Default AffiliateWP referral format is ?ref=AFFILIATE_ID. Editable in the UI.
  await pool.query(`
    INSERT INTO app_settings (key, value) VALUES
      ('referral_base_url', 'https://bigbattery.com/?ref='),
      ('promo_template', 'Shop at BigBattery with my link {LINK} or use my code {COUPON} to support me. 🔋⚡')
    ON CONFLICT (key) DO NOTHING
  `)
}

// Known affiliate coupons from the commission project. ON CONFLICT DO NOTHING
// so any edits the user makes in the UI are preserved across restarts.
const COUPON_SEED = [
  // [code, kind, affiliate_name, affiliate_email, rate, confirmed, notes]
  ['fentertainment', 'affiliate', 'Willie Fenters', 'rfenters1@gmail.com', 5, true, null],
  ['racefamily',     'affiliate', 'Willie Fenters', 'rfenters1@gmail.com', 5, true, "Willie Fenters' second account"],
  ['nowyouknow',     'affiliate', 'Nowyouknow (Zac)', 'zac@nowyouknowchannel.com', 5, true, null],
  ['joe10',          'affiliate', 'Joe Williams (AveRageJoe)', 'Hooptejoe@hotmail.com', 7, true, null],
  ['solarrolla10',   'affiliate', 'Kira Belan (Solarrolla)', 'belan@solarrolla.com', 5, true, null],
  ['stege10',        'affiliate', 'Jeff Stege', 'jeffstege@yahoo.com', 5, true, null],
  ['tocci10',        'affiliate', 'Jarrod Tocci', 'info@jarrodtocci.com', 10, true, null],
  ['spicer10',       'affiliate', 'Kyle Spicer', 'spicerdesignsllc@gmail.com', 10, true, null],
  ['karr10',         'affiliate', 'Kerry Koehler', 'kerrykoehler28@gmail.com', 5, true, 'Link Kerry (299) in WC coupon if affwp meta is empty'],
  ['daveandsonya10', 'affiliate', 'Dave & Sonya', 'daveandsonya@daveandsonyainmichigan.com', 5, true, null],
  ['landtohouse',    'affiliate', 'landtohouse', 'landtohouse@gmail.com', 5, true, null],
  // Affiliate coupons with UNCONFIRMED owner/rate (flagged for Accounting)
  ['partner10',      'affiliate', null, null, null, false, 'Owner unconfirmed — review with Accounting'],
  ['solarhav10',     'affiliate', null, null, null, false, 'Owner unconfirmed — review with Accounting'],
  ['diysolar',       'affiliate', null, null, null, false, 'Owner unconfirmed — review with Accounting'],
  ['kgsgarage10',    'affiliate', "KG's Garage", null, 5, true, 'Affiliate #295 — link in WC coupon if affwp meta empty'],
  ['karr5',          'affiliate', 'Kerry Koehler', 'kerrykoehler28@gmail.com', 5, true, 'Same as karr10 — affiliate #299'],
  // Marketing / store-wide promos (not affiliate commissions)
  ...['volt5','volt 5','mycart5','mycart7','mycart3','blackfriday2025','bigbatterybf2025',
      'blackfridaybf2025','battery','2battery','february7','jan5','holiday2025','holiday2025cs',
      'welcome2bb','welcome2bb2','welcome2bb3','cyberweek2025','bigbatterycw2025','browse3',
      'browse5','browse6','save5','save10','thankyou5','thankyou7','thankyou8','christmas7',
      'spooky6','green','july4th','powerwalls','10% off eg4 promo','meta4','og10']
      .map(c => [c, 'promo', null, null, null, true, null]),
]

export async function seedCouponMap() {
  for (const [code, kind, name, email, rate, confirmed, notes] of COUPON_SEED) {
    await pool.query(`
      INSERT INTO coupon_map (coupon_code, kind, affiliate_name, affiliate_email, rate, confirmed, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (coupon_code) DO NOTHING
    `, [code, kind, name, email, rate, confirmed, notes])
  }
  console.log(`  ✔ Coupon map seeded (${COUPON_SEED.length} known codes)`)
}
