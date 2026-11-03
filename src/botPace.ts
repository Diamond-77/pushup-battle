// When a bot's push-ups land during a battle. The server already decided the total; this spreads it
// over the battle like a real person: quicker at the start, slowing down, short rests, uneven rhythm.

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function botRepTimes(total: number, seconds: number, seed: number): number[] {
  const r = rng(seed);
  if (total <= 0) return [];
  // weight of each second: tiring (0.86 per minute) plus a few rests
  const w: number[] = [];
  let rest = 0;
  for (let t = 0; t < seconds; t++) {
    if (rest > 0) { rest--; w.push(0.05); continue; }
    if (t > 8 && r() < 0.025) rest = 2 + Math.floor(r() * 5); // catch breath for a few seconds
    w.push(Math.pow(0.86, t / 60) * (0.7 + r() * 0.6));
  }
  const sum = w.reduce((a, b) => a + b, 0);
  // the i-th rep lands where the running weight passes (i + jitter) / total
  const times: number[] = [];
  let acc = 0, t = 0;
  const end = seconds - 1.2; // finish a moment before the bell
  for (let i = 0; i < total; i++) {
    const target = ((i + 0.3 + r() * 0.5) / total) * sum;
    while (t < w.length && acc + w[t] < target) { acc += w[t]; t++; }
    const within = w[t] ? (target - acc) / w[t] : 0;
    times.push(Math.min(end, 1.5 + (t + within) * ((end - 1.5) / seconds)) * 1000);
  }
  return times.sort((a, b) => a - b);
}
