/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import { useState, type FormEvent } from 'react'

type LoginScreenProps = {
  supabaseConfigured: boolean
  message?: string
  messageIsError?: boolean
  isSigningIn?: boolean
  onEmailSignIn: (email: string, password: string) => void | Promise<void>
}

export function LoginScreen({
  supabaseConfigured,
  message,
  messageIsError = false,
  isSigningIn = false,
  onEmailSignIn,
}: LoginScreenProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    void onEmailSignIn(email, password)
  }

  return (
    <div className="loginScreen loginScreen--ims">
      <div className="loginCard loginCard--ims">
        <h1 className="loginTitle loginTitle--ims">Whiterock Field Salesman</h1>
        <p className="loginSubtitle loginSubtitle--ims">Visits, tracking &amp; CRM</p>

        {!supabaseConfigured ? (
          <p className="loginConfigWarn">
            Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in your deployment environment and
            rebuild.
          </p>
        ) : null}

        {message ? (
          <p className={`loginMessage loginMessage--ims${messageIsError ? ' loginMessage--imsError' : ' loginMessage--imsInfo'}`}>
            {message}
          </p>
        ) : null}

        {supabaseConfigured ? (
          <form className="loginEmailForm" onSubmit={handleSubmit}>
            <label className="loginFieldLabel">
              Email
              <input
                className="loginFieldInput"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                placeholder="you@company.com"
              />
            </label>
            <label className="loginFieldLabel">
              Password
              <input
                className="loginFieldInput"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                placeholder="••••••••"
              />
            </label>
            <p className="loginPasswordHint">Accounts are created by an admin in Settings. Use the email and password they gave you.</p>
            <button type="submit" className="loginSubmitBtn" disabled={isSigningIn}>
              {isSigningIn ? 'Signing in...' : 'Sign in'}
            </button>
            <p className="loginSignupHint">New users are added in <strong>Settings</strong> by an admin (email + role + password).</p>
          </form>
        ) : null}
      </div>
    </div>
  )
}
