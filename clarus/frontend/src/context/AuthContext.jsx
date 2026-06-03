import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import api, { tokenStore } from '../api/client.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [orgs, setOrgs] = useState([])
  const [activeOrg, setActiveOrg] = useState(tokenStore.org || null)
  const [loading, setLoading] = useState(true)

  const loadMe = useCallback(async () => {
    if (!tokenStore.access) { setLoading(false); return }
    try {
      const { data } = await api.get('/auth/me/')
      setUser(data.user)
      setOrgs(data.organizations)
      const org = tokenStore.org || data.active_organization
      tokenStore.setOrg(org)
      setActiveOrg(org)
    } catch {
      tokenStore.clear()
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadMe() }, [loadMe])

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login/', { email, password })
    tokenStore.set({ access: data.access, refresh: data.refresh })
    await loadMe()
  }

  const register = async (payload) => {
    const { data } = await api.post('/auth/register/', payload)
    tokenStore.set(data.tokens)
    await loadMe()
  }

  const logout = () => {
    tokenStore.clear()
    setUser(null)
    setOrgs([])
    setActiveOrg(null)
    window.location.href = '/login'
  }

  const switchOrg = (slug) => {
    tokenStore.setOrg(slug)
    setActiveOrg(slug)
    window.location.reload()
  }

  return (
    <AuthContext.Provider value={{ user, orgs, activeOrg, loading, login, register, logout, switchOrg, reload: loadMe }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
