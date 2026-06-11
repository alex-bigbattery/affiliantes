import { NavLink } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard, Users, ArrowLeftRight, DollarSign,
  Eye, Tag, Image, RefreshCw, Zap, Database, Menu, X, ShoppingCart, LineChart
} from 'lucide-react'
import { api } from '../api'

const links = [
  { to: '/',            label: 'Dashboard',   icon: LayoutDashboard },
  { to: '/affiliates',  label: 'Affiliates',  icon: Users },
  { to: '/referrals',   label: 'Referrals',   icon: ArrowLeftRight },
  { to: '/payouts',     label: 'Payouts',      icon: DollarSign },
  { to: '/visits',      label: 'Visits',       icon: Eye },
  { to: '/coupons',     label: 'Coupons',      icon: Tag },
  { to: '/orders',      label: 'Orders',       icon: ShoppingCart },
  { to: '/zoho-price-history', label: 'Price History', icon: LineChart },
  { to: '/creatives',   label: 'Creatives',    icon: Image },
  { to: '/sync',        label: 'Sync DB',      icon: Database },
]

function SyncFooter() {
  const [info, setInfo] = useState(null)
  const [syncing, setSyncing] = useState(false)

  const load = () =>
    api.syncStatus().then(setInfo).catch(() => {})

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [])

  const triggerSync = async () => {
    setSyncing(true)
    await api.runSync()
    setTimeout(() => { load(); setSyncing(false) }, 2000)
  }

  const running = info?.running || syncing
  const last = info?.last
  const lastTime = last?.finished_at
    ? new Date(last.finished_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="px-3 py-3 border-t border-white/10 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${running ? 'bg-yellow-400 animate-pulse' : last?.status === 'error' ? 'bg-red-400' : 'bg-green-400'}`} />
          <span className="text-navy-100/50 text-xs">{running ? 'Syncing…' : lastTime ? `Sync ${lastTime}` : 'No sync'}</span>
        </div>
        <button
          onClick={triggerSync}
          disabled={running}
          className="text-navy-100/40 hover:text-white disabled:opacity-30 transition-colors"
          title="Sync now"
        >
          <RefreshCw size={12} className={running ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="text-navy-100/30 text-xs">Supabase · every 30 min</div>
    </div>
  )
}

export default function Layout({ children }) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile backdrop */}
      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={close} />}

      {/* Sidebar — slide-out drawer on mobile, static on md+ */}
      <aside className={`fixed md:static inset-y-0 left-0 z-40 w-56 bg-navy-700 shrink-0 flex flex-col
        transform transition-transform duration-200
        ${open ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
        {/* Logo */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-navy-500/40">
          <div className="flex items-center gap-2">
            <Zap className="text-brand-orange" size={22} />
            <div>
              <div className="text-white font-bold text-sm leading-none">BigBattery</div>
              <div className="text-navy-100/60 text-xs mt-0.5">Affiliate Dashboard</div>
            </div>
          </div>
          <button className="md:hidden text-navy-100/60 hover:text-white" onClick={close} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={close}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-white/15 text-white font-medium'
                    : 'text-navy-100/70 hover:bg-white/8 hover:text-white'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <SyncFooter />
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar with hamburger */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b bg-white shrink-0">
          <button onClick={() => setOpen(true)} className="text-gray-600" aria-label="Open menu">
            <Menu size={22} />
          </button>
          <Zap className="text-brand-orange" size={18} />
          <span className="font-bold text-navy-700 text-sm">BigBattery</span>
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between px-4 sm:px-6 pt-5 sm:pt-6 pb-4">
      <div>
        <h1 className="text-lg sm:text-xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  )
}

export function StatusBadge({ status }) {
  const map = {
    active:   'bg-green-100 text-green-700',
    inactive: 'bg-gray-100 text-gray-600',
    pending:  'bg-yellow-100 text-yellow-700',
    paid:     'bg-green-100 text-green-700',
    unpaid:   'bg-red-100 text-red-700',
    rejected: 'bg-gray-100 text-gray-500 line-through',
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export function ErrorMsg({ error }) {
  return (
    <div className="mx-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
      {String(error)}
    </div>
  )
}

export function Empty({ label = 'No data' }) {
  return <div className="py-16 text-center text-gray-400 text-sm">{label}</div>
}

export function Modal({ title, onClose, children, width = 'max-w-lg' }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className={`bg-white rounded-xl shadow-xl w-full ${width}`}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function StatCard({ label, value, sub, color = 'text-navy-700' }) {
  return (
    <div className="card px-5 py-4">
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}
