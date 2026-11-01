import { useCallback, useRef, useState } from "react";
import { AuthScreen, ProfileSetup, useAuth, type Profile } from "./auth";
import Dock, { type Tab } from "./Dock";
import Avatar from "./Avatar";
import Hud from "./Hud";
import { useLobby } from "./lobby";
import LobbyPage from "./LobbyPage";
import PoseCounter from "./PoseCounter";
import ProfilePage from "./ProfilePage";
import { useMatch } from "./useMatch";

export default function App() {
  const { session, profile, setProfile, loading } = useAuth();

  if (loading) return <main className="app"><div className="auth"><div className="brand">PUSHUP BATTLE</div></div></main>;
  if (!session) return <main className="app"><AuthScreen /></main>;
  if (!profile) return <main className="app"><ProfileSetup userId={session.user.id} onDone={setProfile} /></main>;
  return <Game profile={profile} email={session.user.email} onProfile={setProfile} />;
}

function Game({ profile, email, onProfile }: { profile: Profile; email?: string; onProfile: (p: Profile) => void }) {
  const [tab, setTab] = useState<Tab>("home");
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [practiceReps, setPracticeReps] = useState(0);

  const me = { id: profile.id, name: profile.username, avatar: profile.avatar_url };
  const lobby = useLobby(me);
  const m = useMatch(lobby.match, profile.id);
  const inMatch = lobby.match !== null;

  // Reps go to the match while one is running, otherwise to the practice counter on Home.
  const repTarget = useRef<() => void>(() => {});
  repTarget.current = inMatch ? m.addMyRep : () => tab === "home" && setPracticeReps((r) => r + 1);
  const onRep = useCallback(() => repTarget.current(), []);

  const backToLobby = () => {
    lobby.leaveMatch();
    setTab("friends");
  };

  return (
    <main className="app">
      <PoseCounter facing={facing} counting={inMatch ? m.phase === "match" : tab === "home"} onRep={onRep}>
        {inMatch && (
          <>
            <Hud
              myReps={m.myReps}
              oppReps={m.oppReps}
              me={{ name: me.name, avatar: me.avatar }}
              opp={{ name: lobby.match!.opponent.name, avatar: lobby.match!.opponent.avatar }}
              secondsLeft={m.secondsLeft}
            />
            {m.phase === "waiting" && (
              <div className="stage-center">
                <div className="toast">Waiting for {lobby.match!.opponent.name}…</div>
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
              <div className="stage-center">
                <div className={`result-card glass ${m.result}`}>
                  <div className="result-title">{m.result === "win" ? "You win!" : m.result === "lose" ? "You lose" : "Draw"}</div>
                  <div className="result-score">
                    <span className="me">{m.myReps}</span>
                    <span className="dash">–</span>
                    <span className="opp">{m.oppReps}</span>
                  </div>
                  <button className="big-btn small" onClick={backToLobby}>
                    Back to lobby
                  </button>
                </div>
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

        {!inMatch && tab === "home" && (
          <div className="practice glass">
            <div className="practice-label">PRACTICE</div>
            <div className="practice-reps">{practiceReps}</div>
            <div className="practice-actions">
              <button className="pill ghost" onClick={() => setPracticeReps(0)}>
                Reset
              </button>
              <button className="pill" onClick={() => setTab("friends")}>
                Battle a friend
              </button>
            </div>
          </div>
        )}
        {!inMatch && tab === "friends" && (
          <LobbyPage
            players={lobby.players}
            status={lobby.status}
            notice={lobby.notice}
            onChallenge={lobby.challenge}
            onFindMatch={lobby.findMatch}
            onCancel={lobby.cancel}
          />
        )}
        {!inMatch && tab === "profile" && <ProfilePage profile={profile} email={email} onChange={onProfile} />}

        {lobby.incoming && !inMatch && (
          <div className="modal-back">
            <div className="modal glass">
              <Avatar url={lobby.incoming.avatar} color="opp" size={72} />
              <div className="modal-title">{lobby.incoming.name} challenges you!</div>
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

        <Dock tab={tab} onTab={setTab} onFlip={() => setFacing((f) => (f === "user" ? "environment" : "user"))} locked={inMatch} />
      </PoseCounter>
    </main>
  );
}
