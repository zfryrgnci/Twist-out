# 🌀 Twist Out

**Untangle puzzler — drag pins until no strand crosses another.**

**▶️ [Play it live in your browser](https://zfryrgnci.github.io/Twist-out/)** — a fully playable untangle puzzler built with pure HTML5 Canvas. Works on desktop and mobile.

---

## About

Every level ships with a `par` move count and a solver-verified solved layout, so no level can be unsolvable and none is accidentally trivial.

The one interaction decision worth writing down: a grabbed pin keeps the offset it had from the finger at the moment it was grabbed, rather than snapping to the finger's centre. Snapping feels like the pin jumps out from under you, and on a phone the finger then covers the exact spot you are trying to judge.

---

## Tech

| | |
|---|---|
| Language | `Kotlin` |
| Rendering | `HTML5 Canvas` — one canvas, nothing layered over it |
| Shell | Native Android `WebView` |
| Ads | Google Mobile Ads SDK (interstitial + rewarded) |
| Package | `com.refaz.twistout` |
| Min / Target SDK | 24 / 36 |

**One canvas, nothing on top of it** — that is deliberate across this whole
portfolio. A sibling game once shipped completely unplayable because an invisible
positioned element sat over the canvas and swallowed every tap, while its entire
test suite passed. If the only thing the player can touch is the canvas, that
failure cannot happen.
