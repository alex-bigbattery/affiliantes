import axios from 'axios'
import { config } from 'dotenv'

config()

const STORE = (process.env.WOO_STORE_URL || 'https://bigbattery.com').replace(/\/+$/, '')
const AWP_BASE = `${STORE}/wp-json/affwp/v1`
const BRIDGE_BASE = `${STORE}/wp-json/bb-affiliate-dashboard/v1`

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

function formatWpError(wp, status, fallback) {
  let msg = fallback
  if (wp?.message) msg = wp.message
  else if (typeof wp?.code === 'string') msg = wp.code
  else if (typeof wp === 'string') msg = wp
  else if (wp && typeof wp === 'object') msg = JSON.stringify(wp)

  if (status === 401) {
    msg = 'AffiliateWP rejected API credentials — verify AFFWP_PUBLIC_KEY and AFFWP_TOKEN.'
  }
  if (status === 404 && String(msg).includes('rest_no_route')) {
    msg = 'AffiliateWP referrals are read-only on this site (REST API Extended not active). '
      + 'Install wordpress/bb-affiliate-dashboard-bridge.php as a mu-plugin, or enable REST API Extended for referrals.'
  }
  return msg
}

export async function awpRequest(method, endpoint, { params, data, base = AWP_BASE } = {}) {
  if (!awpConfigured()) {
    const err = awpAuthError()
    err.status = 503
    throw err
  }
  try {
    const res = await axios({
      method,
      url: `${base}${endpoint}`,
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      params: params || undefined,
      data: data ?? undefined,
      timeout: 30000,
    })
    return res.data
  } catch (e) {
    const wp = e.response?.data
    const status = e.response?.status || 502
    const err = new Error(formatWpError(wp, status, e.message))
    err.status = status
    err.code = wp?.code
    throw err
  }
}

async function referralRouteAllowsWrite(referralId) {
  try {
    const res = await axios({
      method: 'OPTIONS',
      url: `${AWP_BASE}/referrals/${referralId}`,
      headers: { Authorization: authHeader() },
      timeout: 15000,
    })
    const methods = res.data?.methods || res.data?.endpoints?.[0]?.methods || []
    return methods.some(m => ['POST', 'PUT', 'PATCH'].includes(String(m).toUpperCase()))
  } catch {
    return false
  }
}

async function updateViaExtended(referralId, fields) {
  const params = fields || {}
  let lastErr
  for (const method of ['PATCH', 'POST', 'PUT']) {
    try {
      const result = await awpRequest(method, `/referrals/${referralId}`, { params, data: fields })
      if (result?.referral_id != null || result?.id != null) return result
    } catch (e) {
      lastErr = e
      if (e.status === 404 && e.code === 'rest_no_route') break
      if (e.status === 405) continue
    }
  }
  throw lastErr || new Error('AffiliateWP extended update failed')
}

async function updateViaBridge(referralId, fields) {
  return awpRequest('POST', `/referrals/${referralId}`, {
    data: fields,
    base: BRIDGE_BASE,
  })
}

/** Update referral status — REST API Extended, or BB mu-plugin bridge fallback. */
export async function awpUpdateReferral(referralId, fields) {
  const writable = await referralRouteAllowsWrite(referralId)
  if (writable) {
    try {
      return await updateViaExtended(referralId, fields)
    } catch (e) {
      if (e.status !== 404) throw e
    }
  }
  try {
    return await updateViaBridge(referralId, fields)
  } catch (e) {
    if (e.status === 404) {
      throw new Error(
        'Cannot mark referral paid: install wordpress/bb-affiliate-dashboard-bridge.php on bigbattery.com '
        + '(wp-content/mu-plugins/) and add BB_AFFWP_PUBLIC_KEY + BB_AFFWP_TOKEN to wp-config.php, '
        + 'OR install AffiliateWP REST API Extended addon.',
      )
    }
    throw e
  }
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

async function bridgeRouteAvailable(referralId) {
  try {
    const res = await axios({
      method: 'OPTIONS',
      url: `${BRIDGE_BASE}/referrals/${referralId}`,
      headers: { Authorization: authHeader() },
      timeout: 15000,
      validateStatus: s => s < 500,
    })
    if (res.status === 404) return false
    const methods = res.data?.methods || res.data?.endpoints?.[0]?.methods || []
    return methods.some(m => ['POST', 'PUT', 'PATCH'].includes(String(m).toUpperCase()))
  } catch {
    return false
  }
}

export async function probeAffwpWriteSupport(referralId = 1) {
  const [extended_api, bridge_plugin] = await Promise.all([
    referralRouteAllowsWrite(referralId),
    bridgeRouteAvailable(referralId),
  ])
  return { extended_api, bridge_plugin }
}
