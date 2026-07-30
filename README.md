<div align="center">

# 🛒 Flipkart Lister

### *Drives Flipkart Seller Hub end to end — images, every tab, every variant, straight to QC.*

[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Playwright](https://img.shields.io/badge/Playwright-1.44-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev)
[![Gemini](https://img.shields.io/badge/Gemini-2.5_Flash--Lite-4285F4?logo=google&logoColor=white)](https://ai.google.dev)
[![Express](https://img.shields.io/badge/Express-4.19-000000?logo=express&logoColor=white)](https://expressjs.com)
[![Tailwind](https://img.shields.io/badge/Tailwind-3.4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Built end-to-end by a PM-Builder · React + Node + Playwright + Gemini · Runs 100% locally**

</div>

---

## 📖 Table of Contents

- [🎯 About](#-about)
- [✨ Highlights](#-highlights)
- [🚀 Quick Start](#-quick-start)
- [🗂️ Project Layout](#️-project-layout)
- [🛠️ Tech Stack](#️-tech-stack)
- [🔐 Auth & Login Flow](#-auth--login-flow)
- [🧑‍🤝‍🧑 Roles & RBAC](#-roles--rbac)
- [🧠 Application State — WS + Path Store](#-application-state--ws--path-store)
- [📄 Pages](#-pages)
- [🧩 Components](#-components)
- [🤖 AI Copywriting](#-ai-copywriting)
- [🧪 The Form Layer — Every Trap, Encoded](#-the-form-layer--every-trap-encoded)
- [🪝 Hooks & Utilities](#-hooks--utilities)
- [🛤️ End-to-End Flow](#️-end-to-end-flow)
- [⚠️ Known Limitations](#️-known-limitations)
- [🗺️ Roadmap](#️-roadmap)
- [🤝 Contributing](#-contributing)
- [📜 License](#-license)
- [👤 Author](#-author)

---

## 🎯 About

**Problem.** Flipkart's "Add a Single Listing" form is a five-tab, 70-field marathon. Five images that must be uploaded strictly one at a time. Four tabs that only save when you *leave* them. A variant matrix at the bottom of the last tab where every variant repeats the entire field set — its own SKU, price, package dimensions, description, keywords. Listing one product with two sizes is ~25 minutes of careful clicking, and one wrong dropdown means a QC rejection days later.

**Solution.** A local agent that holds one **path** per product — the vertical, brand, SKU pattern, shared field values, and the variant list — then drives the whole form itself. Attach a front image, hit *Run*, and it selects the vertical, clears the brand check, uploads all five images in order, fills every tab, adds each variant, fills the matrix, re-reads it, and stops on a validated draft. Copy is written per variant by Gemini, sized to that variant, with brand names stripped.

**Why it matters.** Turns ~25 minutes of error-prone clicking into ~90 seconds of watching. Every trap that silently corrupts data — the pill fields that swallow a whole description as one keyword, the dropdown cells that look like text boxes, the matrix that drops your package weight on the first save — is encoded once instead of being rediscovered on every listing.

**What I built (as PM + Builder).**
- **Mapped the real form by hand first** — drove a complete Table Cover listing on a live seller account through to QC before writing a line of automation, and wrote down every behaviour that broke the obvious approach.
- **Designed around the save model.** There is no save button; switching tabs is the save. The whole executor is structured as tab transitions with a read-back after each one.
- **Made field addressing survive the form.** Fields shift as you fill them, so nothing is addressed by index — every field is found by its visible label, stamped, then driven with real events.
- **Encoded the variant image rule** the seller actually uses: Seating-Capacity variants reuse the parent's photos, Colour and Pack-of variants each need their own front image, slots 2–5 are reused either way.
- **Kept the irreversible step behind a switch.** Runs stop on a validated draft by default; *Send to QC* is an explicit opt-in.

---

## ✨ Highlights

> Mapped by hand. Encoded once. Run forever.

- 🧭 **Whole-form automation.** Vertical → brand check → 5 images → Price/Stock → Product Description → Additional Description → variant matrix → QC. Not a recorded click-track — a purpose-built driver that knows what each tab means.
- 🖼️ **One image in, five out.** The seller supplies only the Front View. Slots 2–5 are uploaded once per path and reused for every listing on it.
- 🧬 **Variant-aware image prompting.** Seating-Capacity variants reuse the parent's photos; Colour and Pack-of variants are detected and prompted for their own front image.
- 📐 **Per-variant copy.** A 60×90 six-seater gets its own description, keywords and features sized to it — never a copy-paste of the 40×60.
- 🚫 **Brand-name scrubbing.** Flipkart QC rejects brand mentions in description and keyword fields, so brand words are forbidden in the prompt *and* stripped from the output afterwards.
- 🆔 **Collision-free SKUs.** Pattern-based (`TC_BT/{X}`, `TC_60*90_BT/{X}`) with a persistent ledger. Model Number mirrors the SKU; Model Name stays the keyword-rich title.
- 🔁 **Read-back verification.** The variant matrix silently drops values on its first save — so every row is re-read after saving and repaired before the run continues.
- 🛑 **Irreversible actions are opt-in.** Default run ends on a validated draft with every tab green. Sending to QC is a separate, deliberate tick.
- 📡 **Live WebSocket log** with per-tab `filled/total` and error counts pulled straight off Flipkart's own tab bar.
- 🔐 **Local-first.** Session lives in a Chromium profile dir, secrets in `.env`, photos never leave the device.

---

## 🚀 Quick Start

```bash
git clone https://github.com/yatinbhalla/Flipkart-listing
cd Flipkart-listing
npm install
npm run install:browsers     # downloads Chromium for Playwright (~150 MB)
cp .env.example .env         # fill in GEMINI_API_KEY
npm start                    # opens http://localhost:5174
```

Get a free Gemini API key at <https://aistudio.google.com/app/apikey>. The `flash-lite` model gives ~1500 calls/day on the free tier — far more than a listing workload needs.

Ports are 3002 / 5174 rather than 3001 / 5173, so this runs alongside the [Meesho Lister](https://github.com/yatinbhalla/Meesho-listing) without a clash.

The first run opens Chromium and waits for you to log into Seller Hub by hand — Flipkart OTPs new sessions, which can't be automated. After that the persistent profile keeps you signed in.

---

## 🗂️ Project Layout

```text
Flipkart-listing/
├── 📁 src/
│   ├── 📁 server/                    Express + WebSocket backend (port 3002)
│   │   ├── index.js                  Express bootstrap + WS server + run lock + seed
│   │   ├── store.js                  Path persistence + SKU dedup ledger
│   │   ├── seed.js                   The Table Cover path, transcribed from the verified manual listing
│   │   └── 📁 routes/
│   │       ├── paths.js              CRUD + shared-image (slots 2–5) upload
│   │       ├── run.js                Resolve SKUs → AI copy → drive the form → verify → QC
│   │       └── uploads.js            Per-run Front View images
│   │
│   ├── 📁 browser/                   Playwright agents (run in Node)
│   │   ├── session.js                Persistent profile, manual-first login
│   │   ├── form.js                   Field primitives — label addressing, dropdowns, pill fields, tab-switch saves
│   │   ├── variants.js               The per-variant matrix table on the Variant tab
│   │   └── listing.js                The full flow, tab by tab
│   │
│   ├── 📁 ai/                        Gemini integration
│   │   ├── client.js                 Shared call wrapper · model fallback · JSON mode
│   │   └── content.js                Per-variant description / keywords / features · brand scrubbing
│   │
│   └── 📁 client/                    React 18 + Vite + Tailwind (port 5174)
│       ├── App.jsx                   Path selector + layout + tab-status panel
│       ├── 📁 components/            RunPanel, SharedImages, LiveLog
│       └── 📁 hooks/                 useWebSocket (auto-reconnect)
│
├── 📁 content/                       Reference notes from the manual listing
│   ├── APP_REQUIREMENTS.md           Seller's rules — SKU patterns, image reuse, variant image rules
│   └── TC_BT_40X60.md                Reusable brand-free copy for the PVC table cover
│
├── 📁 data/                          Gitignored
│   ├── 📁 paths/<id>/
│   │   ├── config.json               Vertical · brand · shared fields · variants
│   │   └── shared_images/            img2–img5 — reused for every listing on the path
│   ├── used_skus.json                SKU dedup ledger
│   ├── runs/                         Ephemeral per-run Front View images
│   └── .browser-profile/             Chromium profile = Flipkart session
│
└── 📄 .env / .env.example            Credentials (real .env is gitignored)
```

---

## 🛠️ Tech Stack

| Layer | Stack | Why |
|---|---|---|
| **Frontend** | React 18 · Vite · Tailwind CSS | Hot reload, near-zero config, Flipkart blue/yellow baked into Tailwind |
| **Backend** | Node 18 · Express · `ws` | Same-server WebSocket so the SPA can stream long-running automation logs |
| **Browser Automation** | Playwright (Chromium, headed) | Persistent profiles, real keyboard events for pill fields, `setInputFiles` for the shared image input |
| **AI** | `@google/generative-ai` · `gemini-2.5-flash-lite` | Generous free tier, JSON-mode output, one call per variant |
| **Storage** | Local JSON files | Zero database setup; per-user data stays on disk |
| **Process orchestration** | `concurrently` for `npm start` | Spawns Express + Vite in one command |

---

## 🔐 Auth & Login Flow

```
              First-ever run
                    │
                    ▼
       ┌─────────────────────────────┐
       │  launchPersistentContext()  │  → creates data/.browser-profile/
       └─────────────┬───────────────┘
                     ▼
        page.goto(seller.flipkart.com)
                     │
       Logged in? ◄──┴──► No
            │              │
            │              ▼
            │     Wait up to 5 min for manual login
            │     (Flipkart OTPs new sessions — not automatable)
            │              │
            └──────────────┤
                           ▼
                  Session cookies + LocalStorage
                  persisted in browser profile dir
                           │
              Next launch: skip login automatically
```

**Manual-first by design.** Unlike the Meesho lister, there is no auto-login attempt. Flipkart sends an OTP to the registered number on any new session, so scripted credential entry buys nothing — the profile directory is what actually saves time on run two onwards.

**Session reuse.** The Playwright context is cached in-process, so back-to-back runs share one browser and skip the login check entirely.

---

## 🧑‍🤝‍🧑 Roles & RBAC

**This is a single-user desktop tool.** No multi-tenant model, no role hierarchy, no auth middleware. The only "role" is the OS user running `npm start`.

**Why no RBAC?** The app runs locally and never accepts inbound network traffic — every Express route is bound to `localhost:3002`. Adding RBAC would be ceremony without benefit. Fork it for a team deployment and the auth layer slots in between the `cors`/`express.json` middleware and the route handlers.

---

## 🧠 Application State — WS + Path Store

State is **lifted to `App.jsx`** and shared through two mechanisms:

```jsx
// App.jsx — state owned by App:
//   paths        — fetched on mount and after every mutation
//   selectedId   — chosen in the path dropdown
//   running      — set on run start, cleared by the 'run-finished' WS event

// useWebSocket() returns:
//   lines        — the rolling activity log (capped at 400)
//   events       — latest payload per event name ('tabs', 'run-finished', 'needs-attention')
```

**Why the socket carries events as well as log lines.** A run is a single long HTTP request that returns immediately; everything meaningful happens afterwards. Tab statuses, completion, and the needs-attention case all arrive as typed events so the UI can react structurally rather than by scraping log text. The socket auto-reconnects, so restarting the server mid-run doesn't leave a dead UI.

**Path store.** Paths live as plain JSON on disk (`data/paths/<id>/config.json`) and are read fresh on every API call — edit a config by hand and the next run picks it up without a restart.

---

## 📄 Pages

Single-screen app — everything the daily workflow needs is on one view.

| Region | Purpose |
|---|---|
| **Path header** | Which product template is loaded — vertical, brand, variant count |
| **Front View picker** | One slot per variant that needs its own image; variants that reuse the parent's photos are labelled and skipped |
| **Copy & SKU preview** | Allocates SKUs and generates copy *without* touching the browser, so it can be read before anything is written to Flipkart |
| **Run controls** | The QC opt-in and the run button, with readiness gating |
| **Sidebar** | Reused-image uploader, live activity log, per-tab status pulled off Flipkart's tab bar |

---

## 🧩 Components

| Component | Responsibility |
|---|---|
| `RunPanel` | Per-variant front-image upload, copy/SKU preview with expandable descriptions and keyword pills, QC opt-in, readiness-gated run button |
| `SharedImages` | Uploads slots 2–5 once per path, with a ready/missing badge |
| `LiveLog` | Colour-coded by message type, auto-scrolls, `clear` button |
| `App` | Path selection, run lifecycle, tab-status panel fed by the `tabs` WS event |

---

## 🤖 AI Copywriting

One Gemini call **per variant**, routed through the shared client.

```
generateCopy(path, variant) →
   Single Gemini call · responseMimeType: 'application/json'
   Returns: { description, searchKeywords[], keyFeatures[], modelName }
```

- **Per variant, not per path.** The prompt carries that variant's size and seating capacity, so a 60×90 six-seater listing reads differently from the 40×60 and carries its own size keywords.
- **SEO + GEO shaped.** Plain factual sentences that answer what a buyer actually asks — what it protects against, who it's for, how to clean it — plus a short spec list. No hyperbole, no invented certifications.
- **Brand scrubbing runs twice.** Brand names are forbidden in the prompt, then stripped from the returned text with a word-boundary regex covering the seller's own brand and every marketplace name. Flipkart QC rejects brand mentions in these fields, and a prompt instruction alone is not a guarantee.
- **Fails loudly.** Incomplete output raises rather than silently listing a product with an empty description.

### Shared client (`src/ai/client.js`)

```
callGeminiJSON(prompt, { temperature, log }) →
   • Model fallback chain (lite first for free-tier quota)
   • Retry on 429 with server-suggested delay
   • MODEL_NOT_ACCESSIBLE detection — auto-advances to next model
   • JSON-mode with defensive code-fence stripping
```

---

## 🧪 The Form Layer — Every Trap, Encoded

This is the part worth reading. Each rule below exists because the obvious approach silently produced wrong data on a real listing.

| Trap | What actually happens | How it's handled |
|---|---|---|
| **No save button** | Switching tabs *is* the save. A tab's `(filled/total)` counter and error badge stay stale until you leave it. | Every save is a tab transition followed by a read-back of the tab bar. |
| **Indexes drift** | Multi-value fields remove their `<input>` once they hold a value; whole fields vanish based on other answers (handling fees disappear when Shipping provider = Flipkart, Importer Details when Country of Origin = India). | Fields are found by visible label, stamped with a unique attribute, then driven by locator. Duplicate labels (two `Color` fields) are disambiguated by occurrence. |
| **Pill fields swallow text** | Dispatching `change` or `blur` commits the whole raw box as one pill — this once dumped a 1700-character description into Search Keywords as a single keyword. | Real `Enter` keypress per value, container re-clicked between values, `change`/`blur` never dispatched. |
| **Fake text boxes** | Many matrix columns that render as plain boxes are dropdowns. Writing to the inner input looks like it worked but the cell still reads "Select" and nothing submits. | Those columns go through the dropdown-button path, never the input. |
| **Grouped numerics clobber** | Package Length/Breadth/Height/Weight share one React state object; writing all four in one pass keeps only the last. | Written one at a time with a settle between each. |
| **The matrix drops values** | On the first save, Procurement SLA, Stock and all four package dimensions came back empty. | Every variant row is re-read after saving and repaired before the run proceeds. |
| **The window doesn't scroll** | `document.body.scrollHeight` is 0; the form scrolls inside `section[class*=ContentSection]`. | All scrolling targets that container. |
| **Images are sequential** | All five slots share one `#upload-image` input. Slot N+1 can't start until slot N's `POST /napi/scf/uploadImage` returns. | Each upload awaits its own response before the next begins. |
| **Generated title ≠ Model Name** | The customer-facing title is generated by Flipkart from the tagged attributes and can't be typed. "Generate Title" stays disabled until the Product Description tab has saved once. | Model Name is treated as a separate attribute; the title is left to Flipkart. |
| **Express SLA is in hours** | With Procurement type = express, the SLA field is hours, not days — the matrix renders it as "2 HR". | Documented on the seeded path so a 2-day intent isn't shipped as a 2-hour promise. |

---

## 🪝 Hooks & Utilities

| Util | Purpose |
|---|---|
| `useWebSocket()` | Auto-reconnecting WS subscriber. Returns `{ lines, events, clear }`; separates typed events from log lines |
| `rowFor(page, label, occurrence)` | Finds a field by its visible label (mandatory `*` stripped), stamps it, returns a Playwright locator |
| `setPills(page, label, values)` | Pill-field writer — click container, type, real Enter, repeat; never fires `change`/`blur` |
| `pick` / `pickMulti` | Single and multi-select dropdown pickers; `pickMulti` closes with Escape since multi-selects stay open |
| `saveAndInspect(page, tab)` | Bounce to another tab and back, then return every tab's `filled/total` and error count |
| `readErrors(page)` | Scrapes the inline validation messages currently rendered on a tab |
| `allocateSku(pattern)` | Fills `{X}` with an unused 5-digit number, checked against the persistent ledger |
| `repairVariantRow(page, i, v)` | Re-enters the known-flaky matrix cells that came back empty after a save |
| `variantNeedsImage(variant)` | The Colour / Pack-of vs Seating-Capacity image rule, enforced server-side as well as in the UI |

---

## 🛤️ End-to-End Flow

### Preparing a path (once per product)

```
Edit data/paths/<id>/config.json  (or PUT /api/paths/:id)
      ↓
Vertical · brand · SKU pattern · shared field values · variant list
      ↓
Upload slots 2–5 once  →  POST /api/paths/:id/images
      ↓
Path shows "ready" in the UI
```

### Running a listing (daily use)

```
Attach Front View per variant that needs one → POST /api/uploads/front
      ↓
Preview  →  POST /api/run/preview
      • Allocate a unique SKU per variant (Model Number mirrors it)
      • Gemini writes description / keywords / features per variant
      • Nothing has touched Flipkart yet — read it, then decide
      ↓
Run  →  POST /api/run  (returns immediately; progress over WS)
      ↓
Chromium opens / reuses session → already signed in
      ↓
selectVertical → selectBrand → 5 images in order
      ↓
Price/Stock  →  Product Description  →  Additional Description
   (each tab switch saves the previous one)
      ↓
For each extra variant: addVariant on its axis, fill its matrix row
      ↓
Save the matrix, re-read every row, repair anything Flipkart dropped
      ↓
verifyReady()  →  broadcast tab statuses
      ↓
   sendToQc off  →  stop on a validated draft, browser stays open
   sendToQc on   →  click Send to QC, confirm the success banner
```

---

## ⚠️ Known Limitations

| Area | Limitation | Mitigation / Roadmap |
|---|---|---|
| **Replay not yet run live** | The form mechanics were validated by driving a real listing to QC by hand, but the Playwright executor has not yet completed an unattended end-to-end run against Flipkart. | Run the first one with *Send to QC* off and watch it. Every step is logged over WS. |
| **Per-variant image upload** | Colour / Pack-of variants have their own image strip on the Variant tab. The run collects and validates those images but currently uploads only the parent's. | Seating-Capacity paths are unaffected. Wiring the variant strip is the next task on the roadmap. |
| **One vertical proven** | Only Table Cover has been driven end to end. Other verticals have different mandatory attributes on the Product Description tab. | The field primitives are generic; `listing.js` names Table Cover's fields explicitly and would need a per-vertical map. |
| **No path editor in the UI** | Paths are edited as JSON on disk or via the API. | Roadmap — the Meesho lister's PathConfig screen is the model. |
| **Selector fragility** | Image-slot clicking and the form panel rely on class-prefix selectors from Flipkart's styled-components build, which change on redeploys. | Label-based addressing covers most of the form; the class-prefix selectors are isolated to a handful of constants at the top of `form.js`. |
| **Single-user, local only** | No multi-tenant deployment, no team paths, no cloud sync. | Intentional — keeps photos and the seller session on-device. |
| **Browser stays open after a run** | The persistent context is reused, so Chromium stays up between runs. | Intended behaviour for reviewing drafts; a close button is on the roadmap. |
| **English-only AI copy** | Gemini prompts request Indian English — no Hindi or regional variants yet. | Roadmap: locale-aware prompt templates. |

---

## 🗺️ Roadmap

- [ ] **Per-variant image upload** — drive the Variant tab's own image strip for Colour and Pack-of variants.
- [ ] **Per-vertical field maps** — declare each vertical's mandatory attributes as data so new categories don't need code.
- [ ] **In-app path editor** — create and edit paths without touching JSON.
- [ ] **Bulk mode** — N front images → N listings in one session, sharing the browser and the shared-image uploads.
- [ ] **QC outcome tracking** — poll Listings-in-Progress and surface rejections against the listing that caused them.
- [ ] **AI-assisted selector recovery** — port the Meesho lister's self-healing navigator so class-prefix changes heal themselves.
- [ ] **MCP server wrapper** — expose run/preview as MCP tools so an agent can drive listings directly.

---

## 🤝 Contributing

**Open to collaborators.** Pull requests, issues, and feature ideas are welcome.

If you'd like to contribute:

1. **Fork** the repo and create a feature branch (`git checkout -b feat/your-idea`).
2. **Check the build and the offline pieces** before pushing — neither needs a Flipkart account:
   ```bash
   npm run build                   # client builds clean
   node src/server/index.js        # boots, seeds the demo path, serves /api/health
   ```
3. **Open a PR** describing what you built, why, and what trade-offs you considered.

**Especially keen on contributions in:**
- Per-vertical field maps for categories beyond Table Cover.
- Driving the Variant tab's per-variant image strip.
- Selector-recovery strategies for styled-components class churn.
- MCP / agent integration so this can be driven by external LLMs.

**Have an idea but don't want to code it?** Open an issue with the use case and a screenshot. Concrete user stories > clever code.

---

## 📜 License

[PolyForm Noncommercial License 1.0.0](LICENSE.md) — **free for any noncommercial use**: personal projects, learning, hobby use, research, and nonprofit/educational/government use. Fork it, modify it, share it.

**Commercial use is not permitted** under this license — you can't use it in a business to make or save money, ship it inside a paid product, or run it for an enterprise without a separate commercial license. Want to use it commercially? [Reach out](mailto:yatinbhalla42@gmail.com).

(And don't sue me when Flipkart changes their UI — the software is provided "as is".)

---

## 👤 Author

**Yatin Bhalla** · Product Manager & AI Builder

[![LinkedIn](https://img.shields.io/badge/LinkedIn-Yatin%20Bhalla-0A66C2?logo=linkedin&logoColor=white)](https://linkedin.com/in/yatinbhalla42)
[![Gmail](https://img.shields.io/badge/Gmail-yatinbhalla42%40gmail.com-EA4335?logo=gmail&logoColor=white)](mailto:yatinbhalla42@gmail.com)
[![X](https://img.shields.io/badge/X-@yatinbhalla42-000000?logo=x&logoColor=white)](https://x.com/yatinbhalla42)

<sub>If this project saved you time, a ⭐ on the repo makes my day. If it didn't — tell me why, and I'll fix it.</sub>
