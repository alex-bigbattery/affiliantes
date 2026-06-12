// Sales tax rate providers — state table, Ziptax, TaxLocus, SalesTaxZip

import { STATE_RATES, normalizeUsState, round2, num } from './taxShared.js'

export const TAX_PROVIDERS = ['state_avg', 'ziptax', 'taxlocus', 'salestaxzip']

export const PROVIDER_LABELS = {
  state_avg: 'State average',
  ziptax: 'Ziptax',
  taxlocus: 'TaxLocus',
  salestaxzip: 'SalesTaxZip',
}

function zip5(raw) {
  const m = String(raw || '').match(/\d{5}/)
  return m ? m[0] : ''
}

export function addressCacheKey(provider, addr) {
  const st = normalizeUsState(addr?.state)
  const zip = zip5(addr?.postal_code)
  const line = String(addr?.line1 || '').trim().toLowerCase()
  const city = String(addr?.city || '').trim().toLowerCase()
  if (provider === 'salestaxzip') return `${provider}:${zip || st}`
  return `${provider}:${st}:${zip}:${city}:${line}`
}

export function formatAddressQuery(addr) {
  const parts = [
    addr.line1,
    addr.city,
    normalizeUsState(addr.state),
    zip5(addr.postal_code),
  ].filter(Boolean)
  return parts.join(', ')
}

function okResult({ rate, source, note, breakdown, raw, is_estimate = true }) {
  return {
    ok: true,
    rate,
    rate_pct: round2(rate * 100),
    source,
    is_estimate,
    note,
    breakdown: breakdown || null,
    raw: raw || null,
  }
}

function errResult(error, source, extra = {}) {
  return { ok: false, error, source, ...extra }
}

export function computeFromRate({ rate, state, subtotal, shipping = 0, source, note, breakdown, raw, is_estimate = true, override = false }) {
  const sub = num(subtotal)
  const ship = num(shipping)
  const tax = round2(sub * rate)
  return {
    subtotal: round2(sub),
    shipping: round2(ship),
    taxable_base: round2(sub),
    state: normalizeUsState(state) || '',
    rate,
    rate_pct: round2(rate * 100),
    tax,
    total: round2(sub + ship + tax),
    source,
    is_estimate,
    note,
    breakdown,
    raw,
    override,
  }
}

export function computeStateAvg({ state, subtotal, shipping = 0, exempt = false }) {
  const st = normalizeUsState(state)
  const sub = num(subtotal)
  const ship = num(shipping)
  if (!st) return { error: 'missing_state', subtotal: round2(sub), shipping: round2(ship) }
  if (!(st in STATE_RATES)) return { error: 'unknown_state', state: st, subtotal: round2(sub), shipping: round2(ship) }
  if (sub <= 0) return { error: 'invalid_subtotal', state: st, subtotal: 0, shipping: round2(ship) }
  const rate = exempt ? 0 : STATE_RATES[st]
  return computeFromRate({
    rate,
    state: st,
    subtotal: sub,
    shipping: ship,
    source: 'state_avg',
    note: exempt
      ? 'Tax-exempt customer — $0 tax applied.'
      : 'Estimated tax using the state AVERAGE combined rate. Edit rate to save a custom value in Supabase.',
  })
}

async function fetchSalesTaxZip(addr) {
  const zip = zip5(addr.postal_code)
  if (!zip) return errResult('missing_zip', 'salestaxzip')
  const res = await fetch(`https://salestaxzip.com/api/v1/rate/${zip}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) return errResult(`SalesTaxZip HTTP ${res.status}`, 'salestaxzip')
  const json = await res.json()
  const rate = Number(json?.data?.rates?.combined)
  if (!Number.isFinite(rate)) return errResult('SalesTaxZip returned no combined rate', 'salestaxzip')
  return okResult({
    rate,
    source: 'salestaxzip',
    note: `ZIP ${zip} combined rate (free API — estimation only).`,
    breakdown: json?.data?.rates || null,
    raw: json,
  })
}

async function fetchZiptax(addr) {
  const key = process.env.ZIPTAX_API_KEY
  if (!key) return errResult('ZIPTAX_API_KEY not configured on server', 'ziptax')
  const address = formatAddressQuery(addr)
  if (!address) return errResult('insufficient_address', 'ziptax')
  const url = new URL('https://api.zip-tax.com/request/v60')
  url.searchParams.set('address', address)
  const res = await fetch(url, {
    headers: { 'X-API-Key': key, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) return errResult(`Ziptax HTTP ${res.status}`, 'ziptax')
  const json = await res.json()
  const code = json?.metadata?.response?.code
  if (code !== 100) {
    return errResult(json?.metadata?.response?.message || `Ziptax code ${code}`, 'ziptax', { raw: json })
  }
  const rate = Number(json?.taxSummaries?.[0]?.rate)
  if (!Number.isFinite(rate)) return errResult('Ziptax returned no rate', 'ziptax', { raw: json })
  return okResult({
    rate,
    source: 'ziptax',
    note: 'Address-level rate from Ziptax (estimation — product taxability not included).',
    breakdown: json?.baseRates || null,
    raw: json,
  })
}

async function fetchTaxLocus(addr) {
  const key = process.env.TAXLOCUS_API_KEY
  if (!key) return errResult('TAXLOCUS_API_KEY not configured on server', 'taxlocus')
  const body = {
    product_category: 'general',
    address: {
      line1: addr.line1 || undefined,
      city: addr.city || undefined,
      state: normalizeUsState(addr.state) || undefined,
      postal_code: zip5(addr.postal_code) || undefined,
    },
  }
  if (!body.address.state && !body.address.postal_code) {
    return errResult('insufficient_address', 'taxlocus')
  }
  const res = await fetch('https://api.taxlocus.com/v1/rate/lookup', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return errResult(`TaxLocus HTTP ${res.status}: ${text.slice(0, 120)}`, 'taxlocus')
  }
  const json = await res.json()
  const rate = Number(json?.combined_rate)
  if (!Number.isFinite(rate)) return errResult('TaxLocus returned no combined_rate', 'taxlocus', { raw: json })
  return okResult({
    rate,
    source: 'taxlocus',
    note: 'Address-level rate from TaxLocus (estimation).',
    breakdown: json?.breakdown || null,
    raw: json,
  })
}

export async function lookupProviderRate(provider, address, cache = new Map()) {
  const p = TAX_PROVIDERS.includes(provider) ? provider : 'state_avg'
  const key = addressCacheKey(p, address)
  if (cache.has(key)) return cache.get(key)

  let promise
  if (p === 'salestaxzip') promise = fetchSalesTaxZip(address)
  else if (p === 'ziptax') promise = fetchZiptax(address)
  else if (p === 'taxlocus') promise = fetchTaxLocus(address)
  else promise = Promise.resolve(errResult('unsupported_provider', p))

  cache.set(key, promise)
  return promise
}

export async function computeOrderTax({
  provider = 'state_avg',
  address,
  subtotal,
  shipping = 0,
  exempt = false,
  override = null,
  cache = new Map(),
}) {
  const sub = num(subtotal)
  const ship = num(shipping)
  const st = normalizeUsState(address?.state)

  if (override?.rate != null) {
    const rate = Number(override.rate)
    if (Number.isFinite(rate) && rate >= 0) {
      const base = computeFromRate({
        rate,
        state: st,
        subtotal: sub,
        shipping: ship,
        source: 'state_avg_override',
        note: override.notes || 'Custom rate saved in Supabase.',
        override: true,
      })
      if (override.tax_amount != null && Number.isFinite(Number(override.tax_amount))) {
        base.tax = round2(Number(override.tax_amount))
        base.total = round2(sub + ship + base.tax)
      }
      return base
    }
  }

  if (provider === 'state_avg') {
    const r = computeStateAvg({ state: st, subtotal: sub, shipping: ship, exempt })
    if (r.error) return r
    return r
  }

  if (!st && !zip5(address?.postal_code)) {
    return { error: 'missing_state', subtotal: round2(sub), shipping: round2(ship) }
  }
  if (sub <= 0) return { error: 'invalid_subtotal', state: st, subtotal: 0, shipping: round2(ship) }

  const lookup = await lookupProviderRate(provider, address, cache)
  if (!lookup.ok) {
    return {
      error: lookup.error,
      state: st,
      subtotal: round2(sub),
      shipping: round2(ship),
      provider_error: lookup.error,
      source: lookup.source,
    }
  }

  return computeFromRate({
    rate: lookup.rate,
    state: st,
    subtotal: sub,
    shipping: ship,
    source: lookup.source,
    note: lookup.note,
    breakdown: lookup.breakdown,
    raw: lookup.raw,
  })
}
