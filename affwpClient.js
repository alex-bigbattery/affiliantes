import axios from 'axios'
import { config } from 'dotenv'

config()

const AWP_BASE = `${(process.env.WOO_STORE_URL || 'https://bigbattery.com').replace(/\/+$/, '')}/wp-json/affwp/v1`

export function awpConfigured() {
  return !!(process.env.AFFWP_PUBLIC_KEY && (process.env.AFFWP_TOKEN || process.env.AFFWP_SECRET_KEY))
}

function authHeader() {
  const user = process.env.AFFWP_PUBLIC_KEY
  const pass = process.env.AFFWP_TOKEN || process.env.AFFWP_SECRET_KEY
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
}

export function awpAuthError() {
  return new Error(
    'AffiliateWP API not configured on server (AFFWP_PUBLIC_KEY + AFFWP_TOKEN). '
    + 'Add your read/write API keys in Render → affiliate-dashboard-api → Environment.',
  )
}

export async function awpRequest(method, endpoint, { params, data } = {}) {
  if (!awpConfigured()) {
    const err = awpAuthError()
    err.status = 503
    throw err
  }
  try {
    const res = await axios({
      method,
      url: `${AWP_BASE}${endpoint}`,
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      params: params || undefined,
      data: data ?? undefined,
      timeout: 30000,
    })
    return res.data
  } catch (e) {
    const wp = e.response?.data
    let msg = e.message
    if (wp?.message) msg = wp.message
    else if (typeof wp?.code === 'string') msg = wp.code
    else if (typeof wp === 'string') msg = wp
    else if (wp && typeof wp === 'object') msg = JSON.stringify(wp)
    if (e.response?.status === 401) {
      msg = 'AffiliateWP rejected API credentials — verify AFFWP_PUBLIC_KEY and AFFWP_TOKEN on Render (read/write key).'
    }
    if (e.response?.status === 405) {
      msg = 'AffiliateWP rejected this request — enable REST API Extended for referrals (POST/PATCH).'
    }
    const err = new Error(msg)
    err.status = e.response?.status || 502
    throw err
  }
}

/** REST API Extended: edit referral with POST/PATCH + query params (not PUT body). */
export async function awpUpdateReferral(referralId, fields) {
  const params = fields || {}
  let lastErr
  for (const method of ['PATCH', 'POST']) {
    try {
      const result = await awpRequest(method, `/referrals/${referralId}`, { params })
      if (result?.referral_id != null || result?.id != null) return result
    } catch (e) {
      lastErr = e
      if (e.status === 405) continue
    }
  }
  if (lastErr) throw lastErr
  return awpRequest('PUT', `/referrals/${referralId}`, { data: fields })
}

export async function awpDeleteReferral(referralId) {
  return awpRequest('DELETE', `/referrals/${referralId}`)
}

export async function syncReferralRow(pool, result) {
  const referralId = result?.referral_id ?? result?.id
  if (referralId == null) return
  await pool.query(`
    UPDATE awp_referrals SET status=$1, amount=$2, raw=$3, synced_at=NOW()
    WHERE referral_id=$4
  `, [result.status, parseFloat(result.amount || 0), JSON.stringify(result), referralId])
}
