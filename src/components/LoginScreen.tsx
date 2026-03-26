import { useState, type FormEvent } from 'react'
import { PASSWORD_POLICY_HINT } from '../lib/passwordPolicy'

type LoginScreenProps = {
  supabaseConfigured: boolean
  message?: string
  messageIsError?: boolean
  onEmailSignIn: (email: string, password: string) => void | Promise<void>
  onEmailSignUp: (email: string, password: string) => void | Promise<void>
}

export function LoginScreen({
  supabaseConfigured,
  message,
  messageIsError = false,
  onEmailSignIn,
  onEmailSignUp,
}: LoginScreenProps) {
  const [mode, setMode] = useState<'sign_in' | 'sign_up'>('sign_in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (mode === 'sign_up') void onEmailSignUp(email, password)
    else void onEmailSignIn(email, password)
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
                autoComplete={mode === 'sign_up' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                placeholder="••••••••"
              />
            </label>
            <p className="loginPasswordHint">{PASSWORD_POLICY_HINT}</p>
            <button type="submit" className="loginSubmitBtn">
              {mode === 'sign_up' ? 'Create account' : 'Sign in'}
            </button>
            <button
              type="button"
              className="loginModeLink"
              onClick={() => setMode((m) => (m === 'sign_in' ? 'sign_up' : 'sign_in'))}
            >
              {mode === 'sign_in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
            </button>
            {mode === 'sign_up' ? (
              <p className="loginSignupHint">
                If this email is <strong>already registered</strong>, switch to{' '}
                <button type="button" className="loginInlineLink" onClick={() => setMode('sign_in')}>
                  Sign in
                </button>
                —do not create again.
              </p>
            ) : null}
          </form>
        ) : null}
      </div>
    </div>
  )
}
