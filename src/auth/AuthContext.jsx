import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, isSupabaseConfigured, supabaseConfigMessage } from '../lib/supabase'

const AuthContext = createContext(null)

function getAuthRedirectBase() {
  const configuredUrl = import.meta.env.VITE_SITE_URL || import.meta.env.VITE_APP_URL || window.location.origin
  const siteBase = configuredUrl.replace(/\/+$/, '')
  const appBase = import.meta.env.BASE_URL.replace(/\/$/, '')
  return appBase && !siteBase.endsWith(appBase) ? `${siteBase}${appBase}` : siteBase
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [recoveryPending, setRecoveryPending] = useState(false)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return undefined
    }

    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session)
        setLoading(false)
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession)
      if (event === 'PASSWORD_RECOVERY') setRecoveryPending(true)
      if (!nextSession) setRecoveryPending(false)
      if (!nextSession) setProfile(null)
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!supabase || !session?.user?.id) return

    supabase.from('profiles').select('id, full_name, avatar_url').eq('id', session.user.id).maybeSingle().then(({ data, error }) => {
      if (error) {
        console.error('Failed to load profile', error)
        setProfile(null)
        return
      }
      setProfile(data)
    })
  }, [session])

  const value = useMemo(() => ({
    session,
    user: session?.user || null,
    profile,
    loading,
    recoveryPending,
    configured: isSupabaseConfigured,
    configMessage: supabaseConfigMessage,
    async signUp({ email, password, fullName, redirectTo, accountType }) {
      if (!supabase) return { data: null, error: new Error(supabaseConfigMessage) }
      const redirectUrl = redirectTo || `${getAuthRedirectBase()}/sign-in`
      const result = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName, ...(accountType ? { account_type: accountType } : {}) },
          emailRedirectTo: redirectUrl,
        },
      })
      return result
    },
    async signIn({ email, password }) {
      if (!supabase) return { data: null, error: new Error(supabaseConfigMessage) }
      return supabase.auth.signInWithPassword({ email, password })
    },
    async signOut() {
      if (!supabase) return { error: new Error(supabaseConfigMessage) }
      const result = await supabase.auth.signOut()
      setSession(null)
      setProfile(null)
      return result
    },
    async resetPassword(email) {
      if (!supabase) return { data: null, error: new Error(supabaseConfigMessage) }
      return supabase.auth.resetPasswordForEmail(email, { redirectTo: `${getAuthRedirectBase()}/sign-in` })
    },
    async updatePassword(password) {
      if (!supabase || !session?.user?.id) {
        return { data: null, error: new Error('Open a valid password-reset link before setting a new password.') }
      }
      const result = await supabase.auth.updateUser({ password })
      if (!result.error) setRecoveryPending(false)
      return result
    },
    async updateProfile(updates = {}) {
      if (!supabase || !session?.user?.id) {
        return { data: null, error: new Error('Sign in to update your profile.') }
      }
      const payload = {
        id: session.user.id,
        updated_at: new Date().toISOString(),
        ...updates,
      }
      const { data, error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' }).select().single()
      if (!error) setProfile(data)
      return { data, error }
    },
  }), [session, profile, loading, recoveryPending])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
