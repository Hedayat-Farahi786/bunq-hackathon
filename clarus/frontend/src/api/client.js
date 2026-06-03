import axios from 'axios'

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const STORAGE = {
  access: 'clarus.access',
  refresh: 'clarus.refresh',
  org: 'clarus.org',
}

export const tokenStore = {
  get access() { return localStorage.getItem(STORAGE.access) },
  get refresh() { return localStorage.getItem(STORAGE.refresh) },
  get org() { return localStorage.getItem(STORAGE.org) },
  set({ access, refresh }) {
    if (access) localStorage.setItem(STORAGE.access, access)
    if (refresh) localStorage.setItem(STORAGE.refresh, refresh)
  },
  setOrg(slug) {
    if (slug) localStorage.setItem(STORAGE.org, slug)
  },
  clear() {
    Object.values(STORAGE).forEach((k) => localStorage.removeItem(k))
  },
}

const api = axios.create({ baseURL: `${API_BASE}/api` })

api.interceptors.request.use((config) => {
  const access = tokenStore.access
  const org = tokenStore.org
  if (access) config.headers.Authorization = `Bearer ${access}`
  if (org) config.headers['X-Org-Slug'] = org
  return config
})

let refreshing = null
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && !original._retry && tokenStore.refresh) {
      original._retry = true
      try {
        refreshing = refreshing || axios.post(`${API_BASE}/api/auth/refresh/`, {
          refresh: tokenStore.refresh,
        })
        const { data } = await refreshing
        refreshing = null
        tokenStore.set({ access: data.access })
        original.headers.Authorization = `Bearer ${data.access}`
        return api(original)
      } catch (e) {
        refreshing = null
        tokenStore.clear()
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

export default api
