import axios from 'axios'
import { config } from 'dotenv'
import { pool } from './db.js'

config()

const BASE = 'https://bigbattery.com/wp-json/affwp/v1'
const AUTH = Buffer.from(

  `${process.env.AFFWP_PUBLIC_KEY}:${process.env.AFFWP_TOKEN || process.env.AFFWP_SECRET_KEY}`
).toString('base64')
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function awp(endpoint, params = {}) {
  const res = await axios.get(`${BASE}${endpoint}`, {
    headers: { Authorization: `Basic ${AUTH}` },
    params,
    timeout: 30000,
  })
  return res.data
}

async function fetchAll(endpoint, extraParams = {}, delayMs = 800, maxRecords = Infinity) {
  const all = []
  let offset = 0
  while (all.length < maxRecords) {
    let page
    try {
      page = await awp(endpoint, { number: 100, offset, ...extraParams })
    } catch (e) {
      if (e.response?.status === 404) break
      throw e
    }
    if (!Array.isArray(page) || page.length === 0) break
    all.push(...page)
    if (page.length < 100) break
    offset += 100
    await sleep(delayMs)
  }
  return all
}

async function fetchWpUser(userId) {
  try {
    const res = await axios.get(`https://bigbattery.com/wp-json/wp/v2/users/${userId}`, {
      headers: { Authorization: `Basic ${AUTH}` },
      timeout: 10000,
    })
    return res.data
  } catch (_) { return null }
}

// Cache of already-resolved user_id → {username, displayName, email}
const wpUserCache = new Map()

async function upsertAffiliates(rows) {
  if (!rows.length) return 0

  // Pre-load existing names from Supabase to skip re-fetching
  const ids = rows.map(a => a.affiliate_id)
  const { rows: existing } = await pool.query(
    `SELECT affiliate_id, username, display_name FROM awp_affiliates WHERE affiliate_id = ANY($1::int[])`,
    [ids]
  )
  const existingMap = new Map(existing.map(r => [r.affiliate_id, r]))

  for (const a of rows) {
    // AffiliateWP does not embed user info — fetch from WP Users API if missing
    let username = a.username || a.user?.user_login || null
    let email = a.email || a.user?.user_email || a.payment_email || null
    let displayName = a.name || a.user?.display_name || null

    // Skip WP API call if we already have names in Supabase or in-memory cache
    const cached = wpUserCache.get(a.user_id)
    const dbRow = existingMap.get(a.affiliate_id)
    if (cached) {
      username    = username    || cached.username
      displayName = displayName || cached.displayName
      email       = email       || cached.email
    } else if (dbRow?.username) {
      username    = dbRow.username
      displayName = displayName || dbRow.display_name
    } else if ((!username || !displayName) && a.user_id) {
      const wpUser = await fetchWpUser(a.user_id)
      if (wpUser) {
        username    = username    || wpUser.slug || wpUser.username || null
        displayName = displayName || wpUser.name || null
        email       = email       || wpUser.email || a.payment_email || null
        wpUserCache.set(a.user_id, { username, displayName, email })
      }
      await sleep(200)
    }

    await pool.query(`
      INSERT INTO awp_affiliates
        (affiliate_id, user_id, username, email, display_name, status,
         rate, rate_type, earnings, unpaid_earnings, referrals, visits,
         payment_email, date_registered, raw, synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
      ON CONFLICT (affiliate_id) DO UPDATE SET
        username=EXCLUDED.username, email=EXCLUDED.email,
        display_name=EXCLUDED.display_name, status=EXCLUDED.status,
        rate=EXCLUDED.rate, rate_type=EXCLUDED.rate_type,
        earnings=EXCLUDED.earnings, unpaid_earnings=EXCLUDED.unpaid_earnings,
        referrals=EXCLUDED.referrals, visits=EXCLUDED.visits,
        payment_email=EXCLUDED.payment_email, raw=EXCLUDED.raw, synced_at=NOW()
    `, [
      a.affiliate_id, a.user_id,
      username, email, displayName,
      a.status, a.rate, a.rate_type,
      parseFloat(a.earnings || 0),
      parseFloat(a.unpaid_earnings || 0),
      parseInt(a.referrals || 0),
      parseInt(a.visits || 0),
      a.payment_email || null,
      a.date_registered || null,
      JSON.stringify(a),
    ])
  }
  return rows.length
}

async function upsertReferrals(rows) {
  if (!rows.length) return 0
  for (const r of rows) {
    await pool.query(`
      INSERT INTO awp_referrals
        (referral_id, affiliate_id, visit_id, description, amount, currency,
         status, reference, context, campaign, custom, date, raw, synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
      ON CONFLICT (referral_id) DO UPDATE SET
        affiliate_id=EXCLUDED.affiliate_id, status=EXCLUDED.status,
        amount=EXCLUDED.amount, description=EXCLUDED.description,
        reference=EXCLUDED.reference, raw=EXCLUDED.raw, synced_at=NOW()
    `, [
      r.referral_id, r.affiliate_id, r.visit_id || null,
      r.description || null,
      parseFloat(r.amount || 0),
      r.currency || 'USD',
      r.status, r.reference || null, r.context || null,
      r.campaign || null, r.custom || null,
      r.date || null,
      JSON.stringify(r),
    ])
  }
  return rows.length
}

async function upsertPayouts(rows) {
  if (!rows.length) return 0
  for (const p of rows) {
    await pool.query(`
      INSERT INTO awp_payouts
        (payout_id, affiliate_id, referrals, amount, currency, status,
         payout_method, date, raw, synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
      ON CONFLICT (payout_id) DO UPDATE SET
        affiliate_id=EXCLUDED.affiliate_id, amount=EXCLUDED.amount,
        status=EXCLUDED.status, payout_method=EXCLUDED.payout_method,
        raw=EXCLUDED.raw, synced_at=NOW()
    `, [
      p.payout_id, p.affiliate_id,
      JSON.stringify(p.referrals || []),
      parseFloat(p.amount || 0),
      p.currency || 'USD',
      p.status, p.payout_method || null,
      p.date || null,
      JSON.stringify(p),
    ])
  }
  return rows.length
}

async function upsertVisits(rows) {
  if (!rows.length) return 0
  for (const v of rows) {
    await pool.query(`
      INSERT INTO awp_visits
        (visit_id, affiliate_id, referral_id, url, referrer, campaign,
         context, ip, date, raw, synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
      ON CONFLICT (visit_id) DO UPDATE SET
        affiliate_id=EXCLUDED.affiliate_id, referral_id=EXCLUDED.referral_id,
        raw=EXCLUDED.raw, synced_at=NOW()
    `, [
      v.visit_id, v.affiliate_id, v.referral_id || null,
      v.url || null, v.referrer || null, v.campaign || null,
      v.context || null, v.ip || null,
      v.date || null,
      JSON.stringify(v),
    ])
  }
  return rows.length
}

export let lastSync = null
export let syncRunning = false

export async function runSync() {
  if (syncRunning) {
    console.log('  ⏭ Sync already running, skipping')
    return
  }
  syncRunning = true

  const { rows: [log] } = await pool.query(
    `INSERT INTO awp_sync_log (started_at) VALUES (NOW()) RETURNING id`
  )
  const logId = log.id
  console.log(`  🔄 Sync started (log #${logId})`)

  const counts = { affiliates: 0, referrals: 0, payouts: 0, visits: 0 }
  let error = null

  try {
    // 1. Affiliates (usually <50 records, fast)
    console.log('    Fetching affiliates...')
    const affiliates = await fetchAll('/affiliates', {}, 500)
    counts.affiliates = await upsertAffiliates(affiliates)
    console.log(`    ✔ ${counts.affiliates} affiliates`)
    await sleep(800)

    // 2. Referrals (paginated, most expensive)
    console.log('    Fetching referrals...')
    const referrals = await fetchAll('/referrals', { orderby: 'referral_id', order: 'DESC' }, 1000)
    counts.referrals = await upsertReferrals(referrals)
    console.log(`    ✔ ${counts.referrals} referrals`)
    await sleep(800)

    // 3. Payouts — cap at 2000 most recent (old payouts rarely change status)
    console.log('    Fetching payouts (last 2000)...')
    const payouts = await fetchAll('/payouts', { order: 'DESC', orderby: 'payout_id' }, 800, 2000)
    counts.payouts = await upsertPayouts(payouts)
    console.log(`    ✔ ${counts.payouts} payouts`)
    await sleep(600)

    // 4. Visits — full paginated sync (can be large; throttled like referrals)
    console.log('    Fetching visits (all pages)...')
    let visits = []
    try {
      visits = await fetchAll('/visits', { order: 'DESC' }, 800)
    } catch (_) {}
    counts.visits = await upsertVisits(visits)
    console.log(`    ✔ ${counts.visits} visits`)

  } catch (e) {
    error = e.message || String(e)
    console.error('  ✗ Sync error:', error)
  } finally {
    syncRunning = false
    lastSync = {
      finished_at: new Date().toISOString(),
      status: error ? 'error' : 'success',
      ...counts,
      error,
    }
    await pool.query(`
      UPDATE awp_sync_log
      SET finished_at=NOW(), status=$1, affiliates_synced=$2,
          referrals_synced=$3, payouts_synced=$4, visits_synced=$5, error=$6
      WHERE id=$7
    `, [lastSync.status, counts.affiliates, counts.referrals, counts.payouts, counts.visits, error, logId])

    console.log(`  ✅ Sync done — ${counts.affiliates} affiliates, ${counts.referrals} referrals, ${counts.payouts} payouts`)
  }
}
