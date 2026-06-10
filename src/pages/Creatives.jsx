import { useState, useEffect, useMemo } from 'react'
import {
  Copy, Check, Link2, Tag, Plus, Pencil, Trash2, Settings,
  Search, Info, Image as ImageIcon, ExternalLink,
} from 'lucide-react'
import { api, fmt } from '../api'
import { PageHeader, Spinner, ErrorMsg, Empty, Modal } from '../components/Layout'

/* ── copy-to-clipboard button ─────────────────────────────────────────────── */
function CopyBtn({ text, label, className = '' }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(text) } catch { /* ignore */ }
    setDone(true); setTimeout(() => setDone(false), 1200)
  }
  return (
    <button onClick={copy} className={`inline-flex items-center gap-1 ${className}`} title="Copy">
      {done ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
      {label && <span className="text-xs">{done ? 'Copied' : label}</span>}
    </button>
  )
}

export default function Creatives() {
  const [tab, setTab] = useState('kit')
  return (
    <div>
      <PageHeader
        title="Creatives & Materials"
        subtitle="Per-affiliate promo kit and banner library"
      />
      <div className="flex gap-1 px-6 mb-3">
        {[['kit', 'Affiliate kit'], ['library', 'Banner library']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === k ? 'bg-navy-700 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'kit' ? <KitTab /> : <LibraryTab />}
    </div>
  )
}

/* ── TAB 1: per-affiliate promo kit ───────────────────────────────────────── */
function KitTab() {
  const [data, setData]       = useState({ items: [], settings: {} })
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [search, setSearch]   = useState('')
  const [onlyActive, setOnlyActive] = useState(true)
  const [showSettings, setShowSettings] = useState(false)

  const load = () => {
    setLoading(true)
    api.affiliateKit()
      .then(d => setData({ items: d.items || [], settings: d.settings || {} }))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const base = data.settings.referral_base_url || 'https://bigbattery.com/?ref='
  const template = data.settings.promo_template || 'Shop with my link {LINK} or my code {COUPON}.'

  const rows = useMemo(() => {
    let r = data.items
    if (onlyActive) r = r.filter(a => Number(a.earnings) > 0 || (a.coupons && a.coupons.length))
    if (search.trim()) {
      const q = search.toLowerCase()
      r = r.filter(a =>
        (a.display_name || '').toLowerCase().includes(q) ||
        (a.username || '').toLowerCase().includes(q) ||
        (a.payment_email || a.email || '').toLowerCase().includes(q) ||
        (a.coupons || []).some(c => c.code.toLowerCase().includes(q)))
    }
    return r
  }, [data.items, search, onlyActive])

  if (loading) return <Spinner />
  if (error) return <ErrorMsg error={error} />

  return (
    <div className="px-6 pb-8">
      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 mb-4">
        <Info size={18} className="mt-0.5 shrink-0 text-blue-500" />
        <span>
          Referral link = <code className="bg-white/60 px-1 rounded">{base}{'{ID}'}</code>.
          If your site uses a different format, edit it with the gear. Coupons are linked by affiliate email.
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="relative">
          <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
          <input className="input pl-8 w-64" placeholder="Search affiliate or coupon…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={onlyActive} onChange={e => setOnlyActive(e.target.checked)} />
            Only with sales or coupon
          </label>
          <button className="btn-outline" onClick={() => setShowSettings(true)}>
            <Settings size={14} /> Configure link
          </button>
        </div>
      </div>

      {rows.length === 0
        ? <div className="card p-12"><Empty label="No affiliates to show" /></div>
        : (
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map(a => {
              const link = `${base}${a.affiliate_id}`
              const coupon = a.coupons?.[0]?.code || ''
              const promo = template.replace(/\{LINK\}/g, link).replace(/\{COUPON\}/g, coupon || '—')
              const name = a.display_name || a.username || a.payment_email || `Affiliate #${a.affiliate_id}`
              return (
                <div key={a.affiliate_id} className="card p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-gray-900">{name}</div>
                      <div className="text-xs text-gray-500">#{a.affiliate_id} · {a.payment_email || a.email || 'no email'}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-navy-700">{fmt(a.earnings)}</div>
                      <div className="text-xs text-gray-400">{a.referrals || 0} referrals</div>
                    </div>
                  </div>

                  {/* Referral link */}
                  <div className="mt-3">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Referral link</div>
                    <div className="flex items-center gap-2 bg-gray-50 rounded-md px-2.5 py-1.5">
                      <Link2 size={13} className="text-gray-400 shrink-0" />
                      <span className="text-sm font-mono truncate flex-1">{link}</span>
                      <CopyBtn text={link} className="text-gray-500 hover:text-navy-700 shrink-0" />
                    </div>
                  </div>

                  {/* Coupons */}
                  <div className="mt-2">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Coupon(s)</div>
                    {a.coupons?.length
                      ? <div className="flex flex-wrap gap-1.5">
                          {a.coupons.map(c => (
                            <span key={c.code} className="inline-flex items-center gap-1 bg-green-50 text-green-700 rounded-md px-2 py-1 text-sm font-mono">
                              <Tag size={11} />{c.code}{c.rate != null && <span className="text-green-500 text-xs">({c.rate}%)</span>}
                              <CopyBtn text={c.code} className="text-green-600 hover:text-green-800" />
                            </span>
                          ))}
                        </div>
                      : <span className="text-xs text-gray-400">No coupon assigned (assign it on the Coupons page)</span>}
                  </div>

                  {/* Promo text */}
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Promo text</div>
                      <CopyBtn text={promo} label="Copy text" className="text-gray-500 hover:text-navy-700" />
                    </div>
                    <div className="text-sm text-gray-600 bg-gray-50 rounded-md px-2.5 py-1.5">{promo}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

      {showSettings && (
        <SettingsModal settings={data.settings} onClose={() => setShowSettings(false)}
          onSaved={() => { setShowSettings(false); load() }} />
      )}
    </div>
  )
}

function SettingsModal({ settings, onClose, onSaved }) {
  const [base, setBase] = useState(settings.referral_base_url || 'https://bigbattery.com/?ref=')
  const [tpl, setTpl]   = useState(settings.promo_template || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const save = async () => {
    setSaving(true); setErr(null)
    try {
      await api.updateSettings({ referral_base_url: base, promo_template: tpl })
      onSaved()
    } catch (e) { setErr(e.message); setSaving(false) }
  }
  return (
    <Modal title="Configure link & text" onClose={onClose}>
      <div className="space-y-3">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Referral link base</span>
          <input className="input mt-1 font-mono" value={base} onChange={e => setBase(e.target.value)} />
          <span className="text-xs text-gray-400">The affiliate ID is appended at the end. E.g.: <code>https://bigbattery.com/?ref=</code></span>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Promo text template</span>
          <textarea className="input mt-1" rows={3} value={tpl} onChange={e => setTpl(e.target.value)} />
          <span className="text-xs text-gray-400">Use <code>{'{LINK}'}</code> and <code>{'{COUPON}'}</code> as variables.</span>
        </label>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  )
}

/* ── TAB 2: banner / material library ─────────────────────────────────────── */
function LibraryTab() {
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [editing, setEditing] = useState(null) // material obj or {} for new

  const load = () => {
    setLoading(true)
    api.materials()
      .then(d => setItems(Array.isArray(d) ? d : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const remove = async (id) => {
    if (!confirm('Delete this material?')) return
    await api.deleteMaterial(id); load()
  }

  return (
    <div className="px-6 pb-8">
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500">Banners and images your affiliates can use. Stored in Supabase.</p>
        <button className="btn-orange" onClick={() => setEditing({})}><Plus size={15} /> Add material</button>
      </div>

      {error && <ErrorMsg error={error} />}

      {loading
        ? <Spinner />
        : items.length === 0
          ? <div className="card p-12 text-center text-gray-400">
              <ImageIcon size={32} className="mx-auto mb-3 text-gray-300" />
              <div className="text-gray-500">No materials yet. Click "Add material".</div>
            </div>
          : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {items.map(c => (
                <div key={c.id} className="card p-4 flex flex-col">
                  <div className="mb-3 bg-gray-50 rounded-lg overflow-hidden flex items-center justify-center h-32">
                    {c.image_url
                      ? <img src={c.image_url} alt={c.name} className="max-h-full max-w-full object-contain" />
                      : <ImageIcon size={28} className="text-gray-300" />}
                  </div>
                  <div className="font-medium text-sm">{c.name}</div>
                  {c.description && <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{c.description}</div>}
                  <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
                    <span className="bg-gray-100 rounded px-1.5 py-0.5">{c.type}</span>
                    {c.width && c.height && <span>{c.width}×{c.height}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                    {c.destination_url && (
                      <a href={c.destination_url} target="_blank" rel="noreferrer"
                        className="btn-ghost px-2 py-1 text-xs"><ExternalLink size={13} /> Open</a>
                    )}
                    {c.image_url && <CopyBtn text={c.image_url} label="URL" className="btn-ghost px-2 py-1 text-gray-500" />}
                    <div className="flex-1" />
                    <button className="btn-ghost px-2 py-1" onClick={() => setEditing(c)} title="Edit"><Pencil size={13} /></button>
                    <button className="btn-ghost px-2 py-1 text-red-500" onClick={() => remove(c.id)} title="Delete"><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}

      {editing && (
        <MaterialModal material={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }} />
      )}
    </div>
  )
}

function MaterialModal({ material, onClose, onSaved }) {
  const isNew = !material.id
  const [form, setForm] = useState({
    name: material.name || '', type: material.type || 'banner',
    image_url: material.image_url || '', destination_url: material.destination_url || '',
    width: material.width || '', height: material.height || '',
    description: material.description || '', promo_text: material.promo_text || '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.name.trim()) { setErr('Name is required'); return }
    setSaving(true); setErr(null)
    const payload = { ...form, width: form.width ? Number(form.width) : null, height: form.height ? Number(form.height) : null }
    try {
      if (isNew) await api.createMaterial(payload)
      else await api.updateMaterial(material.id, payload)
      onSaved()
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  return (
    <Modal title={isNew ? 'Add material' : 'Edit material'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block col-span-2">
            <span className="text-sm font-medium text-gray-700">Name *</span>
            <input className="input mt-1" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Banner 728x90 EG4" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Type</span>
            <select className="select mt-1" value={form.type} onChange={e => set('type', e.target.value)}>
              <option value="banner">Banner</option>
              <option value="text">Text link</option>
              <option value="email">Email</option>
              <option value="video">Video</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Width</span>
              <input className="input mt-1" type="number" value={form.width} onChange={e => set('width', e.target.value)} placeholder="px" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Height</span>
              <input className="input mt-1" type="number" value={form.height} onChange={e => set('height', e.target.value)} placeholder="px" />
            </label>
          </div>
        </div>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Image URL</span>
          <input className="input mt-1" value={form.image_url} onChange={e => set('image_url', e.target.value)} placeholder="https://…/banner.png" />
        </label>
        {form.image_url && (
          <div className="bg-gray-50 rounded-md p-2 flex justify-center">
            <img src={form.image_url} alt="preview" className="max-h-24 object-contain" />
          </div>
        )}
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Destination URL</span>
          <input className="input mt-1" value={form.destination_url} onChange={e => set('destination_url', e.target.value)} placeholder="https://bigbattery.com/…" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Description</span>
          <textarea className="input mt-1" rows={2} value={form.description} onChange={e => set('description', e.target.value)} />
        </label>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  )
}
