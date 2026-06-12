export const STATE_RATES = {
  AL: 0.0925, AK: 0.0176, AZ: 0.0837, AR: 0.0945, CA: 0.0857, CO: 0.0777,
  CT: 0.0635, DE: 0.0000, FL: 0.0700, GA: 0.0735, HI: 0.0444, ID: 0.0603,
  IL: 0.0873, IN: 0.0700, IA: 0.0694, KS: 0.0869, KY: 0.0600, LA: 0.0955,
  ME: 0.0550, MD: 0.0600, MA: 0.0625, MI: 0.0600, MN: 0.0746, MS: 0.0707,
  MO: 0.0836, MT: 0.0000, NE: 0.0697, NV: 0.0823, NH: 0.0000, NJ: 0.0660,
  NM: 0.0762, NY: 0.0852, NC: 0.0698, ND: 0.0704, OH: 0.0723, OK: 0.0899,
  OR: 0.0000, PA: 0.0634, RI: 0.0700, SC: 0.0744, SD: 0.0611, TN: 0.0955,
  TX: 0.0820, UT: 0.0719, VT: 0.0624, VA: 0.0577, WA: 0.0938, WV: 0.0655,
  WI: 0.0543, WY: 0.0544, DC: 0.0600,
}

const STATE_NAMES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC', 'washington dc': 'DC',
}

export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100
export const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0 }

export function normalizeUsState(raw) {
  if (!raw) return ''
  const t = String(raw).trim()
  if (!t) return ''
  const up = t.toUpperCase()
  if (up.length === 2 && up in STATE_RATES) return up
  const code = STATE_NAMES[t.toLowerCase()]
  if (code) return code
  if (up.length === 2) return up
  return ''
}

export function parseJson(val) {
  if (!val) return null
  if (typeof val === 'object') return val
  try { return JSON.parse(val) } catch { return null }
}

export function extractShippingAddress(zohoRaw, wcRaw) {
  const z = parseJson(zohoRaw) || {}
  const w = parseJson(wcRaw) || {}
  const ship = z.shipping_address || {}
  const bill = z.billing_address || {}
  const wcShip = w.shipping || {}
  const wcBill = w.billing || {}

  const line1 = String(ship.address || ship.street || wcShip.address_1 || wcBill.address_1 || '').trim()
  const city = String(ship.city || wcShip.city || bill.city || '').trim()
  const zip = String(ship.zip || ship.zipcode || ship.postal_code || wcShip.postcode || '').trim()
  const county = String(ship.county || '').trim()
  const state = normalizeUsState(
    ship.state || ship.state_code || wcShip.state || bill.state || wcBill.state,
  )

  return { line1, city, state, postal_code: zip, county, country: 'US' }
}
