# footersplit

A Claude Code mod that turns the hint line under the prompt into a compact usage line: what you have used on the left, the usual hints on the right.

```
🧠 23% • 🕔 62% • $1.24                                   esc to interrupt
```

## What it shows

| Item | Meaning | Hidden below | Gray | Yellow | Red |
|------|---------|--------------|------|--------|-----|
| 🧠 | Context window used | 10% | 10–39% | 40–59% | 60%+ |
| 🕔 | 5-hour rate limit | never | 0–69% | 70–89% | 90%+ |
| 📅 | Weekly rate limit | 60% | 60–79% | 80–89% | 90%+ |
| 💳 | Gateway spend limit | never | always | — | — |
| `$` | Session cost | never | always | — | — |

Rate limits only appear on a Claude subscription or a gateway with a spend limit. The `(shift+tab to cycle)` hint is dropped to save space.

## Install

In a Claude Code session, run:

```
/plugin install footersplit --marketplace juanssilveira/footersplit
```

Answer `y` to add the marketplace, then pick a scope.

## Usage

- `/toggle <item>` cycles an item through auto (the table above), hidden and always shown. Items: `ctx`, `5h`, `weekly`, `spend`, `cost`. Items that are always shown on auto just switch between shown and hidden. The choice is kept across sessions.

To change the colors' thresholds or the labels, edit `THRESHOLDS` and `LABELS` at the top of `hooks/register.tsx`.

## Limitations

- The permission-mode label (`⏵⏵ auto mode on`) is drawn by Claude Code itself and cannot be changed by a mod.
- Mods are an early-access Claude Code feature, and the API may change between releases. Built and tested on Claude Code 2.1.310.

## Development

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## License

MIT
