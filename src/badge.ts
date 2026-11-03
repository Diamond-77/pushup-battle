import { useEffect } from "react";

// A red count on the app icon (installed app), the tab title and the tab icon.
const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
let plainIcon: string | null = null;
const TITLE = "Pushup Battle";

function drawIcon(count: number) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  plainIcon ??= link.href;
  if (count <= 0) { link.href = plainIcon; return; }
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    if (!g) return;
    g.drawImage(img, 0, 0, 64, 64);
    g.fillStyle = "#ff3b30";
    g.beginPath(); g.arc(46, 18, 17, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff"; g.font = "bold 24px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(count > 9 ? "9+" : String(count), 46, 19);
    link.href = c.toDataURL("image/png");
  };
  img.src = plainIcon;
}

export function useAppBadge(count: number) {
  useEffect(() => {
    document.title = count > 0 ? `(${count}) ${TITLE}` : TITLE;
    drawIcon(count);
    try { (count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.())?.catch(() => {}); } catch { /* not supported */ }
  }, [count]);
}

// iPhone only shows the icon badge after the player allows notifications (asked once, on a tap).
export function askBadgePermission() {
  try {
    if ("Notification" in window && Notification.permission === "default" && "setAppBadge" in nav) Notification.requestPermission().catch(() => {});
  } catch { /* ignore */ }
}
