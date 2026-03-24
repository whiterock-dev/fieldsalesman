type LoginScreenProps = {
  supabaseConfigured: boolean
  message?: string
  onGoogleSignIn: () => void
}

export function LoginScreen({ supabaseConfigured, message, onGoogleSignIn }: LoginScreenProps) {
  return (
    <div className="loginScreen">
      <div className="loginCard">
        <h1 className="loginTitle">Field Sales</h1>
        <p className="loginSubtitle">
          {supabaseConfigured
            ? 'Sign in with the Google account that matches an email your admin added in Settings. No password — Google only.'
            : 'This app requires Supabase. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your deployment environment and rebuild.'}
        </p>
        {message ? <p className="loginMessage">{message}</p> : null}
        {supabaseConfigured ? (
          <button type="button" className="loginGoogleBtn" onClick={onGoogleSignIn}>
            <span className="loginGoogleIcon" aria-hidden>
              G
            </span>
            Continue with Google
          </button>
        ) : null}
      </div>
    </div>
  )
}
