import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AuthScreen, NewPasswordScreen, ProfileSetup, useAuth, type Profile } from "./auth";
import Dock, { type Tab } from "./Dock";
import Avatar from "./Avatar";
import Hud from "./Hud";
import { useLobby } from "./lobby";
import LobbyPage from "./LobbyPage";
import PoseCounter from "./PoseCounter";
import ProfilePage from "./ProfilePage";
import { ClanPage, HomePage, ThronePage } from "./Pages";
import { CLANS, type Clan } from "./clans";
import { useClan } from "./useClan";
import { countdownSound, defeatSound, drawSound, goSound, repSound, victoryCall, victorySound } from "./sound";
import Guide, { guideDone } from "./Guide";
import Training from "./Training";
import { START_RESPECT, MODES, type ModeId } from "./config";
import { supabase } from "./supabase";
// Three.js is big, so the palace loads in its own chunk after the app shows.
const Palace3D = lazy(() => import("./palace/Palace3D"));
import { useMatch } from "./useMatch";

export default function App() {
  const { session, profile, setProfile, loading, recovering, doneRecovering } = useAuth();

  if (loading) return <main className="app"><div className="auth"><div className="brand">PUSHUP BATTLE</div></div></main>;
  if (recovering) return <main className="app"><NewPasswordScreen onDone={doneRecovering} /></main>;
  if (!session)
    return (
      <main className="app">
        <div className="screen">
          <Suspense fallback={null}><Palace3D seed="Soraran Gate" weather="sunset" style={CLANS[1].palace} /></Suspense>
          <AuthScreen />
        </div>
      </main>
    );
  if (!profile) return <main className="app"><ProfileSetup userId={session.user.id} onDone={setProfile} /></main>;
  return <Game profile={profile} email={session.user.email} onProfile={setProfile} />;
}

function Game({ profile, email, onProfile }: { profile: Profile; email?: string; onProfile: (p: Profile) => void }) {
  const [tab, setTab] = useState<Tab>("home");
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [practiceReps, setPracticeReps] = useState(0);
  const [showGuide, setShowGuide] = useState(() => !guideDone());

  const clan = useClan(profile.id);
  const myClan = clan.membership?.clan ?? null;
  const respect = profile.respect ?? START_RESPECT;
  const me = { id: profile.id, name: profile.username, avatar: profile.avatar_url, title: profile.title ?? null, legendary: !!profile.legendary, clan: myClan?.id ?? null, respect };
  const [mode, setMode] = useState<ModeId>("brawl");
  // Respect only changes on the server, so re-read the profile after a battle or a training claim.
  const refreshProfile = useCallback(async () => {
    const { data } = (await supabase?.from("profiles").select("*").eq("id", profile.id).maybeSingle()) ?? {};
    if (data) onProfile(data);
    clan.refresh();
  }, [profile.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // pay out battles the opponent walked away from
  useEffect(() => {
    supabase?.rpc("settle_my_matches").then(({ error }) => { if (!error) refreshProfile(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const lobby = useLobby(me);
  const m = useMatch(lobby.match, profile.id, refreshProfile);
  const inMatch = lobby.match !== null;
  const menu = !inMatch && tab !== "train"; // a full page covers the camera
  const [preview, setPreview] = useState<Clan>(CLANS[0]);
  // Background palace: the clan being browsed on the Clan tab, otherwise your own clan's (lone warriors get a clear day)
  const shown = tab === "clan" ? preview : myClan;
  // open the Clan tab on your own clan
  useEffect(() => {
    if (myClan) setPreview(myClan);
  }, [myClan?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sounds for the countdown and the result
  useEffect(() => {
    if (m.phase === "countdown") (m.countdown > 0 ? countdownSound : goSound)();
  }, [m.phase, m.countdown]);
  useEffect(() => {
    if (m.phase === "result") {
      ({ win: victorySound, lose: defeatSound, draw: drawSound })[m.result]();
      if (m.result === "win") victoryCall();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.phase]);

  // Reps go to the match while one is running, otherwise to the practice counter on Home.
  const repTarget = useRef<() => void>(() => {});
  repTarget.current = inMatch ? m.addMyRep : () => tab === "train" && setPracticeReps((r) => r + 1);
  const onRep = useCallback(() => {
    repSound();
    repTarget.current();
  }, []);

  const backToLobby = () => {
    lobby.leaveMatch();
    setTab("battle");
  };
  const flip = () => setFacing((f) => (f === "user" ? "environment" : "user"));

  return (
    <main className="app">
      <PoseCounter paused={menu} lockBody={inMatch && (m.phase === "countdown" || m.phase === "match")} facing={facing} counting={inMatch ? m.phase === "match" : tab === "train"} onRep={onRep}>
        {inMatch && (
          <>
            <Hud
              myReps={m.myReps}
              oppReps={m.oppReps}
              me={{ name: me.name, avatar: me.avatar, legendary: me.legendary }}
              opp={{ name: lobby.match!.opponent.name, avatar: lobby.match!.opponent.avatar, legendary: lobby.match!.opponent.legendary }}
              secondsLeft={m.secondsLeft}
              barStep={m.mode.barStep}
            />
            <div className="mode-tag">{m.mode.name} · bet {m.mode.bet}</div>
            {m.phase === "waiting" && (
              <div className="stage-center">
                <div className="toast">Waiting for {lobby.match!.opponent.name}…</div>
              </div>
            )}
            {m.phase === "cancelled" && (
              <div className="stage-center">
                <div className="modal panel">
                  <div className="modal-title">Battle cancelled</div>
                  <p className="modal-text">{m.cancelReason}</p>
                  <button className="game-btn wood" onClick={backToLobby}>Back to lobby</button>
                </div>
              </div>
            )}
            {m.phase === "countdown" && (
              <div className="stage-center">
                <div key={m.countdown} className="countdown">
                  {m.countdown > 0 ? m.countdown : "GO"}
                </div>
              </div>
            )}
            {m.phase === "result" && (
              <div className={`result-full ${m.result}`}>
                <div className="result-rays" />
                <div className="result-word">{m.result === "win" ? "Victory" : m.result === "lose" ? "Defeat" : "Draw"}</div>
                <div className="result-score">
                  <span className="me">{m.myReps}</span>
                  <span className="dash">–</span>
                  <span className="opp">{m.oppReps}</span>
                </div>
                <div className="result-names">
                  <span>{me.name}</span>
                  <span>{lobby.match!.opponent.name}</span>
                </div>
                {m.ranked && (
                  <div className={`result-respect ${m.payout && m.payout.delta < 0 ? "minus" : ""}`}>
                    {m.payout ? `${m.payout.delta > 0 ? "+" : ""}${m.payout.delta} Respect` : "Counting Respect…"}
                  </div>
                )}
                <button className="game-btn wood big" onClick={backToLobby}>
                  Back to lobby
                </button>
              </div>
            )}
            {/* Debug (desktop only): fake a rep without doing a push-up */}
            {m.phase === "match" && (
              <div className="test-btns">
                <button onClick={m.addMyRep}>+1 me</button>
              </div>
            )}
          </>
        )}

        {!inMatch && tab === "train" && (
          <>
          <button className="flip-btn" aria-label="Flip camera" onClick={flip}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6M18 3v4h-4M6 21v-4h4" />
            </svg>
          </button>
          <Training reps={practiceReps} respect={respect} onReset={() => setPracticeReps(0)} onBattle={() => setTab("battle")} onEarned={refreshProfile} />
          </>
        )}
        {!inMatch && tab === "home" && <HomePage profile={profile} clan={myClan} onBattle={() => setTab("battle")} onTrain={() => setTab("train")} />}
        {menu && (
          <Suspense fallback={null}>
            <Palace3D seed={shown?.name ?? "Lone Warrior"} weather={shown?.weather ?? "day"} style={shown?.palace} />
          </Suspense>
        )}
        {!inMatch && tab === "throne" && <ThronePage clanRespect={clan.respect} myId={profile.id} />}
        {!inMatch && tab === "clan" && <ClanPage clan={clan} preview={preview} onPreview={setPreview} />}
        {!inMatch && tab === "battle" && (
          <LobbyPage
            players={lobby.players}
            status={lobby.status}
            notice={lobby.notice}
            onChallenge={lobby.challenge}
            onFindMatch={lobby.findMatch}
            onCancel={lobby.cancel}
            mode={mode}
            onMode={setMode}
            respect={respect}
            onTrain={() => setTab("train")}
          />
        )}
        {!inMatch && tab === "profile" && <ProfilePage profile={profile} email={email} onChange={onProfile} membership={clan.membership} />}

        {lobby.incoming && !inMatch && (
          <div className="modal-back">
            <div className="modal glass">
              <Avatar url={lobby.incoming.avatar} color="opp" size={72} legendary={lobby.incoming.legendary} />
              <div className="modal-title">{lobby.incoming.name} challenges you!</div>
              <div className="modal-text">{MODES[lobby.incoming.mode].name} · {MODES[lobby.incoming.mode].seconds / 60} min · bet {MODES[lobby.incoming.mode].bet} Respect</div>
              <div className="row">
                <button className="pill ghost" onClick={lobby.decline}>
                  Decline
                </button>
                <button className="pill" onClick={lobby.accept}>
                  Accept
                </button>
              </div>
            </div>
          </div>
        )}

        <Dock tab={tab} onTab={setTab} locked={inMatch} />
        {showGuide && !inMatch && <Guide onDone={() => setShowGuide(false)} />}
      </PoseCounter>
    </main>
  );
}
