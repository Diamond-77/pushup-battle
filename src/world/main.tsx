import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import WorldMap from "./WorldMap";
import { AuthScreen, NewPasswordScreen, ProfileSetup, useAuth } from "../auth";
import { supabase } from "../supabase";

// Stand-alone test page for the open world (world.html), kept apart from the live app.
// Same accounts as the game: sign in with email and your username shows over your head,
// and other signed-in players walk around with you. Without Supabase (the offline preview) you're a guest.
// Needs VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (and optionally VITE_YOUTUBE_API_KEY for song search) on Preview builds.
function World() {
  const { session, profile, setProfile, loading, recovering, doneRecovering } = useAuth();
  if (!supabase) return <WorldMap me={null} />;
  if (loading) return <main className="app"><div className="auth"><div className="brand">PUSHUP BATTLE</div></div></main>;
  if (recovering) return <main className="app"><NewPasswordScreen onDone={doneRecovering} /></main>;
  if (!session) return <main className="app"><div className="screen"><AuthScreen emailOnly /></div></main>;
  if (!profile) return <main className="app"><ProfileSetup userId={session.user.id} onDone={setProfile} /></main>;
  return <WorldMap me={{ id: profile.id, name: profile.username }} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <World />
  </StrictMode>,
);
