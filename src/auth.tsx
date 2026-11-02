import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, authUrlError } from "./supabase";

// title / legendary can only be set by the developer in the database (supabase/titles.sql)
// respect is only changed by the server (supabase/economy.sql)
export type Profile = { id: string; username: string; avatar_url: string | null; title?: string | null; legendary?: boolean; respect?: number };

// Current session plus the matching profiles row (null until the user picks a username).
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false); // opened from a "reset password" email

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase) return;
    if (!session) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        setProfile(data);
        setLoading(false);
      });
  }, [session?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return { session, profile, setProfile, loading, recovering, doneRecovering: () => setRecovering(false) };
}

const RESEND_COOLDOWN_S = 60;

function friendlyError(message: string) {
  const m = message.toLowerCase();
  if (m.includes("rate limit")) return "Too many emails sent. Please wait a few minutes and try again.";
  if (m.includes("not confirmed")) return "Your email isn't confirmed yet. Tap the link in the email we sent, or resend it below.";
  if (m.includes("invalid login")) return "Wrong email or password.";
  if (m.includes("provider is not enabled")) return "Google sign-in isn't switched on yet. Use email for now.";
  if (m.includes("already registered")) return "This email already has an account. Log in instead.";
  return message;
}

export function AuthScreen() {
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "check-email">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(
    authUrlError ? "Google sign-in failed: " + authUrlError.replace(/\+/g, " ") : null,
  );
  const [canResend, setCanResend] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const redirectTo = window.location.origin + "/";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage(null);
    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
      if (error) setMessage(friendlyError(error.message));
      else if (!data.session) {
        setMode("check-email");
        setCooldown(RESEND_COOLDOWN_S);
      }
    } else if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage(friendlyError(error.message));
        setCanResend(error.message.toLowerCase().includes("not confirmed"));
      }
    } else if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      setMessage(error ? friendlyError(error.message) : "If that email has an account, a reset link is on its way.");
    }
    setBusy(false);
  };

  const resend = async () => {
    if (!supabase || cooldown > 0) return;
    const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: redirectTo } });
    setMessage(error ? friendlyError(error.message) : "Sent again. Check your inbox and spam folder.");
    if (!error) setCooldown(RESEND_COOLDOWN_S);
  };

  // Google sign-in: no confirmation email needed.
  const google = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) setMessage(friendlyError(error.message));
  };

  const go = (m: typeof mode) => () => {
    setMode(m);
    setMessage(null);
    setCanResend(false);
  };

  const resendButton = (
    <button className="pill ghost" onClick={resend} disabled={cooldown > 0}>
      {cooldown > 0 ? `Resend email in ${cooldown}s` : "Resend confirmation email"}
    </button>
  );

  if (mode === "check-email") {
    return (
      <div className="auth">
        <AuthHero />
        <div className="auth-card glass">
          <h2>Check your email</h2>
          <p className="form-msg">
            We sent a confirmation link to <b>{email}</b>. Tap it on this device to finish signing up.
          </p>
          {resendButton}
          {message && <p className="form-msg">{message}</p>}
          <button className="link-btn" onClick={go("login")}>
            Already confirmed? Log in
          </button>
        </div>
      </div>
    );
  }

  const action = mode === "signup" ? "Create account" : mode === "login" ? "Log in" : "Send reset link";

  return (
    <div className="auth">
      <AuthHero />
      <div className="auth-card glass">
        {mode === "forgot" ? (
          <div className="auth-head">
            <h2>Reset password</h2>
            <p className="muted">Enter your email and we'll send you a link to choose a new one.</p>
          </div>
        ) : (
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "on" : ""} onClick={go("signup")}>
              Sign up
            </button>
            <button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "on" : ""} onClick={go("login")}>
              Log in
            </button>
          </div>
        )}
        {!supabase && <p className="form-msg error">Supabase env vars are missing.</p>}

        {mode !== "forgot" && (
          <>
            <button className="google-btn" onClick={google}>
              <GoogleLogo />
              Continue with Google
            </button>
            <div className="divider">
              <span>or with email</span>
            </div>
          </>
        )}

        <form onSubmit={submit}>
          <label className="in">
            <MailIcon />
            <input type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          {mode !== "forgot" && (
            <label className="in">
              <LockIcon />
              <input
                type={showPw ? "text" : "password"}
                placeholder={mode === "signup" ? "Password (6+ characters)" : "Password"}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button type="button" className="pw-eye" aria-label={showPw ? "Hide password" : "Show password"} onClick={() => setShowPw((v) => !v)}>
                <svg viewBox="0 0 24 24">
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                  {showPw && <path d="M4 4l16 16" />}
                </svg>
              </button>
            </label>
          )}
          {mode === "login" && (
            <button type="button" className="link-btn right" onClick={go("forgot")}>
              Forgot password?
            </button>
          )}
          <button className="game-btn red wide" disabled={busy}>
            {busy ? "…" : action}
          </button>
        </form>

        {message && <p className="form-msg">{message}</p>}
        {canResend && resendButton}
        {mode === "forgot" && (
          <button className="link-btn" onClick={go("login")}>
            Back to log in
          </button>
        )}
        <p className="fine">
          By continuing you agree to our <a href="/privacy.html">privacy policy</a>.
        </p>
      </div>
    </div>
  );
}

function AuthHero() {
  return (
    <div className="auth-hero">
      <img src="/icon-192.png" alt="" className="auth-logo" />
      <div className="brush-title hero-title">Pushup Battle</div>
      <p className="tagline">Train. Earn Respect. Claim the Throne.</p>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  );
}

const MailIcon = () => (
  <svg className="in-icon" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></svg>
);
const LockIcon = () => (
  <svg className="in-icon" viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>
);

// Opened from a "reset password" email link: choose a new password.
export function NewPasswordScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setMessage(friendlyError(error.message));
    else onDone();
  };

  return (
    <div className="auth">
      <AuthHero />
      <div className="auth-card glass">
        <h2>Choose a new password</h2>
        <form onSubmit={submit}>
          <input type="password" placeholder="New password (6+ characters)" autoComplete="new-password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="game-btn red wide" disabled={busy}>
            {busy ? "…" : "Save password"}
          </button>
        </form>
        {message && <p className="form-msg error">{message}</p>}
      </div>
    </div>
  );
}

// Shown once after the first login: pick the name other players will see.
export function ProfileSetup({ userId, onDone }: { userId: string; onDone: (p: Profile) => void }) {
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("profiles")
      .insert({ id: userId, username: username.trim() })
      .select("*")
      .single();
    setBusy(false);
    if (error) setMessage(error.code === "23505" ? "That name is taken, try another." : error.message);
    else onDone(data);
  };

  return (
    <div className="auth">
      <AuthHero />
      <div className="auth-card glass">
        <h2>Pick your player name</h2>
        <form onSubmit={submit}>
          <input placeholder="Player name" maxLength={20} minLength={2} value={username} onChange={(e) => setUsername(e.target.value)} required />
          <button className="game-btn red wide" disabled={busy}>
            {busy ? "…" : "Let's go"}
          </button>
        </form>
        {message && <p className="form-msg error">{message}</p>}
        <button className="link-btn" onClick={() => supabase?.auth.signOut()}>
          Log out
        </button>
      </div>
    </div>
  );
}
