import { createContext } from 'react'

/** Separate file so Vite HMR does not recreate the context object on AuthProvider edits. */
export const AuthContext = createContext(null)
