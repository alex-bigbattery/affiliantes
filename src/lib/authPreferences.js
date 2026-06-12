const REMEMBER_KEY = 'affiliate-dashboard-auth-remember'
const USERNAME_KEY = 'affiliate-dashboard-auth-username'

export function getRememberMe() {
  const stored = localStorage.getItem(REMEMBER_KEY)
  if (stored === null) return true
  return stored === 'true'
}

export function setRememberMe(value) {
  localStorage.setItem(REMEMBER_KEY, value ? 'true' : 'false')
  if (!value) {
    localStorage.removeItem(USERNAME_KEY)
  }
}

export function getRememberedUsername() {
  if (!getRememberMe()) return ''
  return localStorage.getItem(USERNAME_KEY) || ''
}

export function setRememberedUsername(username) {
  if (getRememberMe() && username) {
    localStorage.setItem(USERNAME_KEY, username.trim().toLowerCase())
  } else {
    localStorage.removeItem(USERNAME_KEY)
  }
}
