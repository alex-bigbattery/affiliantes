import { Zap, Shield } from 'lucide-react'

export function AuthShell({ title, subtitle, badge, children, wide = false }) {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-navy-900">
      {/* Brand panel */}
      <div className="relative lg:w-[44%] xl:w-[42%] shrink-0 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-navy-700 via-navy-900 to-[#0f1f38]" />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
            backgroundSize: '28px 28px',
          }}
        />
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-brand-orange/20 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-96 h-96 rounded-full bg-navy-500/30 blur-3xl" />

        <div className="relative px-8 py-10 lg:px-12 lg:py-16 lg:min-h-screen flex flex-col justify-center">
          <div className="flex items-center gap-3 mb-8 lg:mb-12">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20 backdrop-blur-sm">
              <Zap className="text-brand-orange" size={26} strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-white font-bold text-xl tracking-tight">BigBattery</div>
              <div className="text-navy-100/60 text-sm">Affiliate Dashboard</div>
            </div>
          </div>

          <h2 className="hidden lg:block text-3xl xl:text-4xl font-bold text-white leading-tight max-w-md">
            Commission insights, affiliates &amp; orders — in one place.
          </h2>
          <p className="hidden lg:block mt-4 text-navy-100/55 text-sm leading-relaxed max-w-sm">
            Secure access for the BigBattery team. Sign in with your username and password.
          </p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 bg-gray-50 lg:rounded-l-[2rem] lg:shadow-2xl lg:-ml-4 relative z-10">
        <div className={`w-full ${wide ? 'max-w-lg' : 'max-w-md'}`}>
          {badge && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-navy-50 text-navy-700 text-xs font-medium px-3 py-1 mb-4 ring-1 ring-navy-100">
              <Shield size={12} />
              {badge}
            </span>
          )}
          {title && (
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{title}</h1>
          )}
          {subtitle && (
            <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">{subtitle}</p>
          )}
          <div className={title || subtitle ? 'mt-8' : ''}>{children}</div>
        </div>
      </div>
    </div>
  )
}

export function UsernameField({ label, value, onChange, icon: Icon, ...props }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex rounded-lg border border-gray-200 bg-white shadow-sm focus-within:ring-2 focus-within:ring-navy-700/20 focus-within:border-navy-700 overflow-hidden">
        <div className="relative flex-1 min-w-0">
          {Icon && (
            <Icon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          )}
          <input
            className={`w-full border-0 py-2.5 text-sm focus:outline-none focus:ring-0 ${Icon ? 'pl-9 pr-2' : 'px-3'}`}
            value={value}
            onChange={onChange}
            autoComplete="username"
            spellCheck={false}
            {...props}
          />
        </div>
        <span className="shrink-0 self-center pr-3 pl-1 text-sm text-gray-400 select-none border-l border-gray-100 bg-gray-50/80 py-2.5">
          @bigbattery.com
        </span>
      </div>
    </div>
  )
}

export function AuthField({ label, icon: Icon, ...props }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        {Icon && (
          <Icon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        )}
        <input
          className={`input py-2.5 ${Icon ? 'pl-9' : ''} rounded-lg border-gray-200 focus:ring-2 focus:ring-navy-700/20`}
          {...props}
        />
      </div>
    </div>
  )
}

export function AuthError({ children }) {
  if (!children) return null
  return (
    <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2.5 text-sm text-red-700">
      {children}
    </div>
  )
}

export function OtpInput({ value, onChange, disabled }) {
  return (
    <input
      className="input text-center text-2xl font-mono tracking-[0.45em] py-3 rounded-lg border-gray-200 focus:ring-2 focus:ring-navy-700/20"
      placeholder="······"
      value={value}
      onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      disabled={disabled}
      required
    />
  )
}

export function AuthSubmit({ loading, loadingText, children, disabled }) {
  return (
    <button
      type="submit"
      className="btn-primary w-full justify-center py-2.5 rounded-lg text-sm font-semibold shadow-sm shadow-navy-700/20"
      disabled={loading || disabled}
    >
      {loading ? loadingText : children}
    </button>
  )
}
