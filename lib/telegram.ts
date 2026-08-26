const API = (method: string) =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

export async function sendMessage(chatId: number, text: string): Promise<void> {
  await fetch(API("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_notification: false,
    }),
  });
}

/** Download a Telegram file (voice note, photo) as bytes. */
export async function fetchFile(fileId: string): Promise<Uint8Array | null> {
  const meta = await fetch(API("getFile") + `?file_id=${fileId}`).then((r) => r.json());
  const path = meta?.result?.file_path;
  if (!path) return null;
  const bin = await fetch(
    `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${path}`
  );
  return new Uint8Array(await bin.arrayBuffer());
}

const BAR_FULL = "█";
const BAR_EMPTY = "░";

function bar(pct: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return BAR_FULL.repeat(filled) + BAR_EMPTY.repeat(width - filled);
}

/** The day block, rendered as monospace so the columns line up on a phone. */
export function renderDay(
  totals: Record<string, number>,
  targets: Record<string, number>
): string {
  const rows: string[] = [];
  const units: Record<string, string> = {
    kcal: "", protein: "g", carbs: "g", fat: "g", fiber: "g",
  };
  for (const key of ["kcal", "protein", "carbs", "fat", "fiber"]) {
    const got = totals[key] ?? 0;
    const target = targets[key] ?? 0;
    const pct = target ? (got / target) * 100 : 0;
    const left = target - got;
    const sign = left < 0 ? "+" : "−";
    rows.push(
      `${key.padEnd(8)}${String(Math.round(got)).padStart(5)} /${String(
        Math.round(target)
      ).padStart(5)}${units[key].padEnd(2)} ${bar(pct)} ${String(
        Math.round(pct)
      ).padStart(3)}%  ${sign}${Math.abs(Math.round(left))}`
    );
  }
  return `<pre>${rows.join("\n")}</pre>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
