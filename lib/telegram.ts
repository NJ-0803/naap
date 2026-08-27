const API = (method: string) =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

/** Send a rendered card. Telegram fetches the URL itself, so nothing is uploaded. */
export async function sendPhoto(chatId: number, url: string, caption?: string): Promise<boolean> {
  const res = await fetch(API("sendPhoto"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, photo: url, caption, parse_mode: "HTML" }),
  });
  const body = await res.json().catch(() => ({ ok: false }));
  return Boolean(body?.ok);
}

/**
 * The buttons that live above the text field.
 *
 * `is_persistent` keeps them on screen instead of collapsing after one use, so
 * the dashboard is always one tap away — a user should never have to remember
 * that a command called /web exists.
 */
export const KEYBOARD = {
  keyboard: [
    [{ text: "📊 Dashboard" }, { text: "🔥 Streak" }],
    [{ text: "🍽 Today" }, { text: "🏆 Table" }],
    [{ text: "🧾 Items" }],
  ],
  is_persistent: true,
  resize_keyboard: true,
  input_field_placeholder: "2 rotis and a katori of dal…",
};

export async function sendMessage(
  chatId: number,
  text: string,
  withKeyboard = false
): Promise<void> {
  await fetch(API("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_notification: false,
      ...(withKeyboard ? { reply_markup: KEYBOARD } : {}),
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
