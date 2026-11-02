import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type Profile = { id: string; username: string; avatar_url: string | null };

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
      .select("id, username, avatar_url")
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
  if (m.includes("already registered")) return "This email already has an account. Log in instead.";
  return message;
}

export function AuthScreen() {
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "check-email">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [canResend, setCanResend] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const redirectTo = window.location.origin;

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
        <div className="auth-card glass">
          <div className="brand">PUSHUP BATTLE</div>
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

  const title = mode === "signup" ? "Create account" : mode === "login" ? "Welcome back" : "Reset password";
  const action = mode === "signup" ? "Sign up" : mode === "login" ? "Log in" : "Send reset link";

  return (
    <div className="auth">
      <div className="auth-card glass">
        <div className="brand">PUSHUP BATTLE</div>
        <h2>{title}</h2>
        {!supabase && <p className="form-msg error">Supabase env vars are missing.</p>}
        <form onSubmit={submit}>
          <input type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {mode !== "forgot" && (
            <div className="pw-wrap">
              <input
                type={showPw ? "text" : "password"}
                placeholder="Password (6+ characters)"
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
            </div>
          )}
          <button className="big-btn small wide" disabled={busy}>
            {busy ? "…" : action}
          </button>
        </form>
        {message && <p className="form-msg">{message}</p>}
        {canResend && resendButton}
        {mode === "login" && (
          <button className="link-btn" onClick={go("forgot")}>
            Forgot password?
          </button>
        )}
        <button className="link-btn" onClick={go(mode === "signup" ? "login" : "signup")}>
          {mode === "signup" ? "Already have an account? Log in" : "New here? Create an account"}
        </button>
      </div>
    </div>
  );
}

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
      <div className="auth-card glass">
        <div className="brand">PUSHUP BATTLE</div>
        <h2>Choose a new password</h2>
        <form onSubmit={submit}>
          <input type="password" placeholder="New password (6+ characters)" autoComplete="new-password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="big-btn small wide" disabled={busy}>
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
      .select("id, username, avatar_url")
      .single();
    setBusy(false);
    if (error) setMessage(error.code === "23505" ? "That name is taken, try another." : error.message);
    else onDone(data);
  };

  return (
    <div className="auth">
      <div className="auth-card glass">
        <div className="brand">PUSHUP BATTLE</div>
        <h2>Pick your player name</h2>
        <form onSubmit={submit}>
          <input placeholder="Player name" maxLength={20} minLength={2} value={username} onChange={(e) => setUsername(e.target.value)} required />
          <button className="big-btn small wide" disabled={busy}>
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
