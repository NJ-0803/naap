# Naap

**naap** — नाप — Hindi for *measure*.

Log meals by text or voice on Telegram. Get macros back in under a second.

```
you  ▸  2 chapati, one katori aloo capsicum sabji, 150g tandoori chicken

bot  ▸  Logged to lunch
        + roti 2 piece            → 267 kcal  P10
        + aloo capsicum 1 katori  → 150 kcal  P2
        + tandoori chicken 150 g  → 330 kcal  P41

        kcal      747 / 1900 ████░░░░░░  39%  −1153
        protein    53 /  130 ████░░░░░░  41%  −77
```

Runs entirely on free tiers. **$0/month**, however many people use it.

## The one design rule

**The model parses language. It never does arithmetic.**

| Layer | Job |
|---|---|
| Groq | "2 chapati and a katori of dal" → `[{name, qty, unit}]` |
| Postgres | Per-100g values and portion conversions |
| TypeScript | Every multiplication, every total, every comparison |

Language models are good at language and unreliable at multiplying decimals. So
no calorie in the database is ever produced by one — the model's only output is
structure, and code does the rest. Everything trustworthy about this system
follows from that split.

## Speed

The same task, measured:

| | Tokens per message | Response |
|---|---|---|
| Agent-framework version | ~98,000 | 40–80s |
| **Naap** | **~540** | **~800ms** |

The difference isn't the model — it's that this asks one small question instead
of re-sending 94 KB of tool schemas on every internal step.

## What it understands

Plain language, no commands to learn.

| You say | It does |
|---|---|
| `2 rotis and a katori of dal` | Logs it, replies with the day so far |
| `200g chicken breast` | Grams are the most accurate input |
| `how much protein do I have left` | Reads the ledger — no logging |
| `71.4` | A bare number is a weigh-in, never food |
| `undo` | Removes the last entry |
| `show me sunday` | That day's summary |
| `bread + chicken = 560 cals` | Already did the maths — logs the total as-is, no lookup |

Portion words are built in: `piece`, `katori`, `bowl`, `cup`, `tbsp`, `tsp`,
`scoop`, `slice`, `glass`. One roti is 45 g, one katori is 150 g.

## The food table

295 seeded foods: home cooking staples — roti, dal, rajma, chole, paneer,
curd, idli, dosa, poha, ghee — where generic nutrition databases are weakest,
a full Indian restaurant menu's worth of dishes — chaat (pani puri, bhel puri,
pav bhaji), curries (butter chicken, kadai paneer, rogan josh, vindaloo),
tandoori grill, biryani, dosa/paratha/naan variants, momos, and sweets — the
packaged and franchise foods people actually log day to day — McDonald's,
Domino's, KFC, Subway, Starbucks, Maggi, Lay's, Kurkure, Parle-G, Bournvita,
Amul, Oreo, Dairy Milk, Haldiram's — and a full fruit, dried-fruit, and nut
table — mango, guava, pomegranate, dates, cashews, pistachios, walnuts, and
more. Every number is sourced from an official nutrition page, package label,
or standard food-composition data, never estimated.

Foods are **global or per-user**. Correcting "roti" for yourself shadows the
global row without changing it for anyone else.

## Correctness

Three defects from the previous build are prevented structurally here, not
patched afterwards:

- **Double-logged meals.** Telegram retries webhooks it thinks failed. Every
  `update_id` is claimed in a primary-key insert before anything is written, so
  a retry cannot duplicate a meal.
- **A 44,000-calorie entry.** Pure fat is 9 kcal/g — the ceiling for any food.
  Anything above it is a unit mix-up and is refused, not stored.
- **Meals filed under the wrong date.** The day comes from the clock in the
  user's timezone. Nothing infers a date from conversation.

`scripts/ledger.test.ts` covers all three.

## Setup

Requires free accounts at [Neon](https://neon.tech), [Groq](https://console.groq.com),
and a Telegram bot from [@BotFather](https://t.me/BotFather). No cards.

```bash
git clone https://github.com/NJ-0803/naap.git
cd naap
npm install
cp .env.example .env.local     # fill in the three keys
npm run db:push                # create tables
npm run seed:foods             # load the 46 global foods
```

Deploy to Vercel, then point Telegram at it:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<your-app>.vercel.app/api/telegram" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Message your bot. That's the whole setup.

## Optional: Claude

Leave `ANTHROPIC_API_KEY` unset and everything above works, free, forever. Set
it only to unlock photo calorie estimation and richer weekly reports — the two
things open models on a free tier can't do well.

## Layout

```
app/api/telegram/route.ts   the webhook — the entire hot path
lib/parse.ts                one Groq call, five intents
lib/ledger.ts               the macro engine; all arithmetic
lib/db.ts                   queries, idempotency, per-user food shadowing
db/schema.sql               multi-tenant schema
db/foods.seed.json          the 46-food global table
scripts/ledger.test.ts      regression tests
```

## Licence

MIT
