/**
 * Windows (case-insensitive FS) resolves imports of "../context/AuthContext"
 * to this file before AuthContext.jsx. Re-export everything from the real modules.
 */
export { AuthContext } from './authReactContext.js'
export { AuthProvider, useAuth, mustChangePassword } from './AuthContext.jsx'
