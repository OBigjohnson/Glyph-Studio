import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { useAuth } from './AuthContext'

export function ProtectedRoute({ children }) {
  const { loading, user, configured } = useAuth()
  const location = useLocation()
  if (loading) return <main className="auth-loading"><span className="eyebrow">Loading your workspace</span><h1>Making space…</h1></main>
  if (!configured || !user) return <Navigate to="/sign-in" replace state={{ from: `${location.pathname}${location.search}` }} />
  return children
}
