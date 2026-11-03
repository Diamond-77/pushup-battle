// When a bot's push-ups land during a battle. The server decided the total and uses the same tiring
// curve (0.86 per minute) to know the bot's count at any moment, so a knockout matches on both sides.
// Each rep is nudged a little so the rhythm isn't machine-even.

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function botRepTimes(total: number, seconds: number, seed: number): number[] {
  const r = rng(seed);
  const k = Math.log(0.86) / 60;
  const full = 1 - Math.exp(k * seconds);
  const times: number[] = [];
  for (let i = 1; i <= total; i++) {
    const t = Math.log(1 - (i / total) * full) / k; // when the curve reaches i reps
    const jitter = (r() - 0.5) * 0.7;
    times.push(Math.max(0.4, Math.min(seconds - 0.4, t + jitter)) * 1000);
  }
  return times.sort((a, b) => a - b);
}
