import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type Profile = { id: string; username: string; avatar_url: string | null };

// Current session plus the matching profiles row (null until the user picks a username).
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
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

  return { session, profile, setProfile, loading };
}

export function AuthScreen() {
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage(null);
    const { data, error } =
      mode === "signup"
        ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
        : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      const m = error.message.toLowerCase();
      setMessage(
        m.includes("rate limit")
          ? "Too many sign-up emails right now. Ask the app owner to turn off email confirmation in Supabase, then try again."
          : m.includes("not confirmed")
            ? "This account's email isn't confirmed yet. Ask the app owner to confirm it in Supabase, then log in."
            : error.message,
      );
    } else if (mode === "signup" && !data.session) setMessage("Check your email to confirm your account, then log in.");
  };

  return (
    <div className="auth">
      <div className="auth-card glass">
        <div className="brand">PUSHUP BATTLE</div>
        <h2>{mode === "signup" ? "Create account" : "Welcome back"}</h2>
        {!supabase && <p className="form-msg error">Supabase env vars are missing.</p>}
        <form onSubmit={submit}>
          <input type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
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
          <button className="big-btn small wide" disabled={busy}>
            {busy ? "…" : mode === "signup" ? "Sign up" : "Log in"}
          </button>
        </form>
        {message && <p className="form-msg">{message}</p>}
        <button className="link-btn" onClick={() => setMode(mode === "signup" ? "login" : "signup")}>
          {mode === "signup" ? "Already have an account? Log in" : "New here? Create an account"}
        </button>
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
