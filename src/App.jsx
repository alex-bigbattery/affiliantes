import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext.jsx'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Affiliates from './pages/Affiliates'
import AffiliateDetail from './pages/AffiliateDetail'
import Referrals from './pages/Referrals'
import Payouts from './pages/Payouts'
import Visits from './pages/Visits'
import Coupons from './pages/Coupons'
import Orders from './pages/Orders'
import ZohoPriceHistory from './pages/ZohoPriceHistory'
import Creatives from './pages/Creatives'
import Sync from './pages/Sync'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/affiliates" element={<Affiliates />} />
            <Route path="/affiliates/:id" element={<AffiliateDetail />} />
            <Route path="/referrals" element={<Referrals />} />
            <Route path="/payouts" element={<Payouts />} />
            <Route path="/visits" element={<Visits />} />
            <Route path="/coupons" element={<Coupons />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/zoho-price-history" element={<ZohoPriceHistory />} />
            <Route path="/creatives" element={<Creatives />} />
            <Route path="/sync" element={<Sync />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </AuthProvider>
  )
}
