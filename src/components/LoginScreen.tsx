type LoginScreenProps = {
  supabaseConfigured: boolean
  message?: string
  onGoogleSignIn: () => void
  onOfflineDemo?: () => void
}

export function LoginScreen({ supabaseConfigured, message, onGoogleSignIn, onOfflineDemo }: LoginScreenProps) {
  return (
    <div className="loginScreen">
      <div className="loginCard">
        <h1 className="loginTitle">Field Sales</h1>
        <p className="loginSubtitle">
          {supabaseConfigured
            ? 'Sign in with the Google account that matches an email your admin added in Settings. No password — Google only.'
            : 'Supabase is not configured. Use offline demo or add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'}
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
        {onOfflineDemo ? (
          <button type="button" className="secondary loginOfflineBtn" onClick={onOfflineDemo}>
            Continue offline (demo)
          </button>
        ) : null}
      </div>
    </div>
  )
}
