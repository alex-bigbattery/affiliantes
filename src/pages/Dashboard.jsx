import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import { api, fmt, fmtDate } from '../api'
import { PageHeader, Spinner, ErrorMsg, StatCard, StatusBadge } from '../components/Layout'
import { TrendingUp, Users, DollarSign, AlertCircle, ArrowRight } from 'lucide-react'

const COLORS = ['#1f3864','#2f5496','#ed7d31','#107c10','#ffd966','#c00000','#4472c4','#70ad47']

/** Last 12 calendar months as YYYY-MM keys, oldest → newest. */
function last12MonthKeys() {
  const keys = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

function monthChartLabel(ym) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function buildMonthlyChartData(monthly) {
  return last12MonthKeys().map(ym => {
    const d = monthly?.[ym] || {}
    return {
      month: monthChartLabel(ym),
      paid: +Number(d.paid || 0).toFixed(2),
      unpaid: +Number(d.unpaid || 0).toFixed(2),
    }
  })
}

function parseReferrals(data) {
  if (Array.isArray(data)) return { items: data, total: data.length }
  return { items: data?.items || [], total: data?.total ?? (data?.items?.length || 0) }
}

export default function Dashboard() {
  const [stats, setStats]       = useState(null)
  const [referrals, setReferrals] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  useEffect(() => {
    Promise.all([
      api.stats(),
      api.referrals({ status: 'open', number: 10, orderby: 'amount', order: 'DESC' })
    ])
      .then(([s, r]) => { setStats(s); setReferrals(parseReferrals(r).items) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Spinner />
  if (error)   return <ErrorMsg error={error} />

  const { affiliates: aff, referrals: ref, payouts: pay, monthly, by_affiliate } = stats
  const affName = id => by_affiliate?.find(a => a.affiliate_id === id)?.name || `ID ${id}`

  const monthlyData = buildMonthlyChartData(monthly)

  // Pie chart data — top affiliates
  const pieData = (by_affiliate || []).slice(0, 6).map(a => ({
    name: a.name || `ID ${a.affiliate_id}`,
    value: +a.total.toFixed(2)
  }))

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Overview of your affiliate program"
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 px-4 sm:px-6 mb-6">
        <StatCard label="Active affiliates" value={aff.active}
          sub={`${aff.total} total`} />
        <StatCard label="Open commissions" value={fmt(ref.amount_unpaid)}
          color="text-red-600" sub={`${(ref.unpaid || 0) + (ref.estimated || 0) + (ref.pending || 0)} orders`} />
        <StatCard label="Total paid" value={fmt(ref.amount_paid)}
          color="text-green-700" sub={`${ref.paid} paid · ${ref.total} total orders`} />
        <StatCard label="Total payouts issued" value={fmt(pay.amount)}
          sub={`${pay.total} payouts total`} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 px-4 sm:px-6 mb-6">
        {/* Bar chart */}
        <div className="card lg:col-span-3 p-4">
          <div className="text-sm font-semibold text-gray-700 mb-1">Commissions by month (last 12)</div>
          <p className="text-xs text-gray-500 mb-3">
            By order date from Supabase · Green = paid · Red = unpaid/estimated
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <XAxis dataKey="month" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
              <Tooltip formatter={v => fmt(v)} cursor={{ fill: 'rgba(31,56,100,0.08)' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="paid"   name="Paid"   fill="#107c10" radius={[3,3,0,0]} maxBarSize={28} />
              <Bar dataKey="unpaid" name="Unpaid" fill="#c00000" radius={[3,3,0,0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Pie chart */}
        <div className="card lg:col-span-2 p-4">
          <div className="text-sm font-semibold text-gray-700 mb-3">Top affiliates by total commission</div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={v => fmt(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Referral status summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 px-4 sm:px-6 mb-6">
        {[
          { label: 'Paid',      val: ref.paid,      cls: 'text-green-700' },
          { label: 'Unpaid',    val: ref.unpaid,    cls: 'text-red-600' },
          { label: 'Estimated', val: ref.estimated, cls: 'text-orange-600' },
          { label: 'Pending',   val: ref.pending,   cls: 'text-yellow-600' },
        ].map(({ label, val, cls }) => (
          <div key={label} className="card px-5 py-4 flex items-center gap-4">
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
              <div className={`text-2xl font-bold ${cls}`}>{val ?? 0}</div>
              <div className="text-xs text-gray-400">orders</div>
            </div>
          </div>
        ))}
      </div>

      {/* Unpaid referrals quick list */}
      <div className="px-4 sm:px-6 pb-8">
        <div className="card">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <AlertCircle size={15} className="text-red-500" />
              Open commissions (highest amount)
            </div>
            <Link to="/referrals?status=open" className="text-xs text-navy-500 hover:underline flex items-center gap-1">
              View all <ArrowRight size={12} />
            </Link>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Order','Affiliate','Date','Description','Amount','Status'].map(h =>
                  <th key={h} className="th">{h}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {referrals.length === 0
                ? <tr><td colSpan={6} className="td text-center text-gray-400">No open commissions</td></tr>
                : referrals.map(r => (
                  <tr key={r.referral_id} className="tr-hover">
                    <td className="td font-mono text-xs">{r.salesorder_number || `#${r.referral_id}`}</td>
                    <td className="td">{r.affiliate_name || affName(r.affiliate_id)}</td>
                    <td className="td text-gray-500">{fmtDate(r.date)}</td>
                    <td className="td max-w-xs truncate">{r.description || r.reference || '—'}</td>
                    <td className="td font-semibold text-red-700">{fmt(r.amount)}</td>
                    <td className="td"><StatusBadge status={r.status} /></td>
                  </tr>
                ))
              }
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </div>
  )
}
