import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Integrations from './pages/Integrations.jsx'
import Contributors from './pages/Contributors.jsx'
import ContributorDetail from './pages/ContributorDetail.jsx'
import Repositories from './pages/Repositories.jsx'

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="p-10 text-sm text-[var(--color-muted)]">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return <Layout>{children}</Layout>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/integrations" element={<Protected><Integrations /></Protected>} />
      <Route path="/contributors" element={<Protected><Contributors /></Protected>} />
      <Route path="/contributors/:id" element={<Protected><ContributorDetail /></Protected>} />
      <Route path="/repositories" element={<Protected><Repositories /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
