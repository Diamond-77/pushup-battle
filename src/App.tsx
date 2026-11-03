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
import PlayerPage from "./PlayerPage";
import ClanMembersPage from "./ClanMembersPage";
import { START_RESPECT, MODES, FIELDS, type FieldId } from "./config";
import { supabase } from "./supabase";
// Three.js is big, so the palace loads in its own chunk after the app shows.
const Palace3D = lazy(() => import("./palace/Palace3D"));
import { useMatch } from "./useMatch";
import { usePushupLog } from "./stats";
import { useChallenges, untilText } from "./challenges";
import { ChallengeButton, openChallenges } from "./ChallengeUI";
import { useAppBadge } from "./badge";
import { setAmbienceOn, setMusicOn, setMusicScene, useSoundPrefs } from "./music";
import { effectsOn, setEffectsOn } from "./sound";

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
  const [viewPlayer, setViewPlayer] = useState<string | null>(null); // a player's profile page
  const [viewMembers, setViewMembers] = useState<Clan | null>(null); // a clan's rank tree page
  const [editingProfile, setEditingProfile] = useState(false);
  useEffect(() => { setViewPlayer(null); setViewMembers(null); setEditingProfile(false); }, [tab]);
  const [field, setField] = useState<FieldId>("brawl"); // selected battlefield on the Battle page
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
  const [kingClan, setKingClan] = useState<Clan | null | undefined>(undefined); // the throne holder's clan
  const shown = tab === "clan" ? preview : tab === "throne" && kingClan !== undefined ? kingClan : myClan;
  // open the Clan tab on your own clan
  useEffect(() => {
    if (myClan) setPreview(myClan);
  }, [myClan?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Theme music + weather sounds on the menu pages (silent in battles and training)
  // On the Battle page each battlefield has its own theme; elsewhere the clan's.
  const sound = useSoundPrefs();
  const [fxOn, setFxOn] = useState(effectsOn);
  const [soundMenu, setSoundMenu] = useState(false);
  useEffect(() => {
    if (!menu) return setMusicScene(null, null);
    const weather = tab === "battle" ? FIELDS.find((f) => f.id === field)!.weather : shown?.weather ?? "day";
    setMusicScene(tab === "battle" ? field : shown?.id ?? "lone", weather);
  }, [menu, tab, field, shown?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scheduled challenges: the mailbox on Home, a red ping on the dock and a notice on every page (not in battle)
  const ch = useChallenges(profile.id);
  useAppBadge(ch.ping);
  const seenNotes = useRef(new Set<string>());
  const [note, setNote] = useState<{ key: string; text: string; avatar: string | null } | null>(null);
  useEffect(() => {
    if (inMatch || note) return;
    for (const c of ch.list) {
      const ms = c.when.getTime() - ch.now;
      const mode = MODES[c.mode].name;
      const n =
        c.myTurn ? { key: `ask-${c.id}-${c.proposer}-${c.at}-${c.mode}`, text: c.proposer === c.from_user && !c.mine ? `${c.other.username} challenged you to ${mode}!` : `${c.other.username} changed your challenge. Your answer?` } :
        c.justAccepted ? { key: `acc-${c.id}`, text: `${c.other.username} accepted your ${mode} challenge!` } :
        c.status === "accepted" && c.theyIn && !c.iIn ? { key: `here-${c.id}`, text: `${c.other.username} is here and waiting for your ${mode} battle!` } :
        c.status === "accepted" && !c.iIn && ms <= 5 * 60000 && c.window !== "over" ? { key: `soon-${c.id}`, text: `Your ${mode} vs ${c.other.username} starts ${untilText(ms)}. Check in!` } :
        c.status === "accepted" && !c.iIn && ms <= 60 * 60000 && ms > 50 * 60000 ? { key: `hour-${c.id}`, text: `Reminder: ${mode} vs ${c.other.username} ${untilText(ms)}.` } :
        null;
      if (n && !seenNotes.current.has(n.key)) {
        seenNotes.current.add(n.key);
        setNote({ ...n, avatar: c.other.avatar_url });
        countdownSound();
        break;
      }
    }
  }, [ch.list, ch.now, inMatch, note]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 9000); return () => clearTimeout(t); }, [note]);

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
  // Training reps also go to the lifetime push-up count (battle reps are counted by the server).
  const pushupLog = usePushupLog();
  useEffect(() => { if (tab !== "train") pushupLog.flush(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const repTarget = useRef<() => void>(() => {});
  repTarget.current = inMatch ? m.addMyRep : () => {
    if (tab !== "train") return;
    setPracticeReps((r) => r + 1);
    pushupLog.add();
  };
  const devDesktop = !!profile.legendary && typeof window !== "undefined" && window.matchMedia("(pointer: fine) and (hover: hover) and (min-width: 900px)").matches && !("ontouchstart" in window);
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
                    {m.payout ? `${m.payout.delta > 0 ? "+" : ""}${m.payout.delta} Respect` : m.reportError ? `Couldn't send your score: ${m.reportError}` : "Counting Respect…"}
                  </div>
                )}
                <button className="game-btn wood big" onClick={backToLobby}>
                  Back to lobby
                </button>
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
          <Training reps={practiceReps} onReset={() => setPracticeReps(0)} onBattle={() => setTab("battle")} onEarned={refreshProfile} />
          </>
        )}
        {!inMatch && tab === "home" && <HomePage profile={profile} clan={myClan} onBattle={() => setTab("battle")} onTrain={() => setTab("train")}
          challenges={<ChallengeButton list={ch.list} now={ch.now} online={lobby.players} onStart={(p, mode) => lobby.challenge(p, mode)} onChanged={ch.refresh} onPlayer={setViewPlayer} />} />}
        {menu && !viewPlayer && !(tab === "profile" && !editingProfile) && (
          <Suspense fallback={null}>
            {tab === "battle" ? (
              <Palace3D seed={field} arena={field} weather={FIELDS.find((f) => f.id === field)!.weather} />
            ) : (
              <Palace3D seed={shown?.name ?? "Lone Warrior"} weather={shown?.weather ?? "day"} style={shown?.palace} />
            )}
          </Suspense>
        )}
        {!inMatch && tab === "throne" && <ThronePage clanRespect={clan.respect} myId={profile.id} onPlayer={setViewPlayer} onKingClan={setKingClan} />}
        {!inMatch && tab === "clan" && <ClanPage clan={clan} preview={preview} onPreview={setPreview} onMembers={setViewMembers} />}
        {!inMatch && tab === "battle" && (
          <LobbyPage
            players={lobby.players}
            status={lobby.status}
            notice={lobby.notice}
            onChallenge={lobby.challenge}
            onFindMatch={lobby.findMatch}
            onCancel={lobby.cancel}
            field={field}
            onField={setField}
            respect={respect}
            onTrain={() => setTab("train")}
            onPlayer={setViewPlayer}
          />
        )}
        {!inMatch && tab === "profile" && (editingProfile ? (
          <ProfilePage profile={profile} email={email} onChange={onProfile} membership={clan.membership} onDone={() => setEditingProfile(false)} />
        ) : (
          <PlayerPage key={profile.avatar_url + (profile.bio ?? "") + profile.username} id={profile.id} myId={profile.id} onEdit={() => setEditingProfile(true)} onPlayer={setViewPlayer} />
        ))}

        {menu && viewMembers && !viewPlayer && <ClanMembersPage clan={viewMembers} onBack={() => setViewMembers(null)} onPlayer={setViewPlayer} />}
        {menu && viewPlayer && <PlayerPage id={viewPlayer} myId={profile.id} onBack={() => setViewPlayer(null)} onPlayer={setViewPlayer} />}
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

        {menu && (
          <div className="topbar">
            <button className="respect-chip" onClick={() => setTab("throne")} aria-label="Your Respect">
              <span className="respect-coin">R</span>
              <b>{respect}</b>
              <span className="respect-chip-word">Respect</span>
            </button>
            <button className={`music-btn ${sound.music ? "on" : ""}`} onClick={() => setSoundMenu(true)} aria-label="Sound settings">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" />
                {!sound.music && <path d="M3 3l18 18" />}
              </svg>
            </button>
          </div>
        )}
        {soundMenu && (
          <div className="modal-back sound-back" onClick={() => setSoundMenu(false)}>
            <div className="modal panel sound-menu" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">Sound</div>
              {([
                ["Music", "Clan and battlefield themes", sound.music, () => setMusicOn(!sound.music)],
                ["Weather", "Rain, wind, birds, crickets", sound.ambience, () => setAmbienceOn(!sound.ambience)],
                ["Game sounds", "Reps, countdown, victory, the announcer", fxOn, () => { setEffectsOn(!fxOn); setFxOn(!fxOn); }],
              ] as const).map(([name, sub, on, flip]) => (
                <button key={name} className={`sound-row ${on ? "on" : ""}`} onClick={flip}>
                  <div><b>{name}</b><span>{sub}</span></div>
                  <i className="switch" />
                </button>
              ))}
              <button className="game-btn wood" onClick={() => setSoundMenu(false)}>Done</button>
            </div>
          </div>
        )}
        {/* Developer test button: only on the developer account, only on a desktop computer */}
        {devDesktop && ((inMatch && m.phase === "match") || (!inMatch && tab === "train")) && (
          <div className="test-btns"><button onClick={onRep}>+1 me</button></div>
        )}
        {note && !inMatch && (
          <button className="challenge-note" onClick={() => { setNote(null); setViewPlayer(null); setTab("home"); openChallenges(); }}>
            <Avatar url={note.avatar} color="opp" size={38} />
            <span>{note.text}</span>
            <b>Open</b>
          </button>
        )}
        <Dock tab={tab} onTab={setTab} locked={inMatch} ping={ch.ping} />
        {showGuide && !inMatch && <Guide onDone={() => setShowGuide(false)} />}
      </PoseCounter>
    </main>
  );
}
