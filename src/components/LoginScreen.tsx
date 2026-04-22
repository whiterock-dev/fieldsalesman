/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import { useState, type FormEvent } from 'react'
import { clampTenDigitMobileInput } from '../lib/mobilePhone'

type LoginScreenProps = {
  supabaseConfigured: boolean
  message?: string
  messageIsError?: boolean
  isSigningIn?: boolean
  onEmailSignIn: (email: string, password: string) => void | Promise<void>
  forgotPasswordMessage?: string
  forgotPasswordMessageIsError?: boolean
  isForgotPasswordBusy?: boolean
  onForgotPasswordSendOtp: (mobile: string) => Promise<boolean>
  onForgotPasswordVerifyOtp: (mobile: string, otp: string) => Promise<boolean>
  onForgotPasswordReset: (mobile: string, otp: string, newPassword: string) => Promise<boolean>
}

export function LoginScreen({
  supabaseConfigured,
  message,
  messageIsError = false,
  isSigningIn = false,
  onEmailSignIn,
  forgotPasswordMessage,
  forgotPasswordMessageIsError = false,
  isForgotPasswordBusy = false,
  onForgotPasswordSendOtp,
  onForgotPasswordVerifyOtp,
  onForgotPasswordReset,
}: LoginScreenProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [forgotStep, setForgotStep] = useState<'mobile' | 'otp' | 'reset' | 'done'>('mobile')
  const [forgotMobile, setForgotMobile] = useState('')
  const [forgotOtp, setForgotOtp] = useState('')
  const [forgotNewPassword, setForgotNewPassword] = useState('')
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    void onEmailSignIn(email, password)
  }

  const openForgotPassword = () => {
    setShowForgotPassword(true)
    setForgotStep('mobile')
    setForgotOtp('')
    setForgotNewPassword('')
    setForgotConfirmPassword('')
  }

  const closeForgotPassword = () => {
    setShowForgotPassword(false)
    setForgotStep('mobile')
    setForgotOtp('')
    setForgotNewPassword('')
    setForgotConfirmPassword('')
  }

  const handleForgotSendOtp = async (e: FormEvent) => {
    e.preventDefault()
    const ok = await onForgotPasswordSendOtp(forgotMobile)
    if (ok) setForgotStep('otp')
  }

  const handleForgotVerifyOtp = async (e: FormEvent) => {
    e.preventDefault()
    const ok = await onForgotPasswordVerifyOtp(forgotMobile, forgotOtp)
    if (ok) setForgotStep('reset')
  }

  const handleForgotReset = async (e: FormEvent) => {
    e.preventDefault()
    if (forgotNewPassword !== forgotConfirmPassword) return
    const ok = await onForgotPasswordReset(forgotMobile, forgotOtp, forgotNewPassword)
    if (ok) setForgotStep('done')
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

        {forgotPasswordMessage ? (
          <p
            className={`loginMessage loginMessage--ims${forgotPasswordMessageIsError ? ' loginMessage--imsError' : ' loginMessage--imsInfo'}`}
          >
            {forgotPasswordMessage}
          </p>
        ) : null}

        {supabaseConfigured && showForgotPassword ? (
          <div className="loginForgotFlow">
            {forgotStep === 'mobile' ? (
              <form className="loginEmailForm" onSubmit={handleForgotSendOtp}>
                <label className="loginFieldLabel">
                  Registered mobile number
                  <input
                    className="loginFieldInput"
                    type="tel"
                    value={forgotMobile}
                    onChange={(ev) => setForgotMobile(clampTenDigitMobileInput(ev.target.value))}
                    placeholder="9876543210"
                    autoComplete="tel"
                    required
                  />
                </label>
                <button type="submit" className="loginSubmitBtn" disabled={isForgotPasswordBusy}>
                  {isForgotPasswordBusy ? 'Sending OTP...' : 'Send OTP on WhatsApp'}
                </button>
              </form>
            ) : null}

            {forgotStep === 'otp' ? (
              <form className="loginEmailForm" onSubmit={handleForgotVerifyOtp}>
                <label className="loginFieldLabel">
                  Enter OTP
                  <input
                    className="loginFieldInput"
                    type="text"
                    inputMode="numeric"
                    value={forgotOtp}
                    onChange={(ev) => setForgotOtp(ev.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6-digit code"
                    required
                    maxLength={6}
                  />
                </label>
                <button type="submit" className="loginSubmitBtn" disabled={isForgotPasswordBusy || forgotOtp.length !== 6}>
                  {isForgotPasswordBusy ? 'Verifying...' : 'Verify OTP'}
                </button>
              </form>
            ) : null}

            {forgotStep === 'reset' ? (
              <form className="loginEmailForm" onSubmit={handleForgotReset}>
                <label className="loginFieldLabel">
                  New password
                  <input
                    className="loginFieldInput"
                    type="password"
                    autoComplete="new-password"
                    value={forgotNewPassword}
                    onChange={(ev) => setForgotNewPassword(ev.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </label>
                <label className="loginFieldLabel">
                  Confirm new password
                  <input
                    className="loginFieldInput"
                    type="password"
                    autoComplete="new-password"
                    value={forgotConfirmPassword}
                    onChange={(ev) => setForgotConfirmPassword(ev.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </label>
                <button
                  type="submit"
                  className="loginSubmitBtn"
                  disabled={isForgotPasswordBusy || forgotNewPassword.length < 6 || forgotNewPassword !== forgotConfirmPassword}
                >
                  {isForgotPasswordBusy ? 'Resetting...' : 'Reset password'}
                </button>
              </form>
            ) : null}

            {forgotStep === 'done' ? (
              <div className="loginForgotSuccess">Password reset successful. You can sign in with your new password.</div>
            ) : null}

            <button type="button" className="forgotPasswordLink" onClick={closeForgotPassword}>
              Back to sign in
            </button>
          </div>
        ) : null}

        {supabaseConfigured && !showForgotPassword ? (
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
            <button type="button" className="forgotPasswordLink" onClick={openForgotPassword}>
              Forgot password?
            </button>
            <p className="loginSignupHint">New users are added in <strong>Settings</strong> by an admin (email + role + password).</p>
          </form>
        ) : null}
      </div>
    </div>
  )
}
