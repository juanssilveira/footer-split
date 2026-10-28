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

Rate limits only appear on a Claude subscription or a gateway with a spend limit. Once one turns yellow or red, it also shows the time left until it resets, rounded down to whole days, hours or minutes: `📅 92% (2d)`, `🕔 85% (1h)`, `🕔 95% (40m)`. The last minute shows as `1m`. The `(shift+tab to cycle)` hint is dropped to save space.

When the line is too wide for the terminal, gray items drop out first, then yellow, then red, rightmost first within each color. The last item left is cut instead of dropped.

## Install

In a Claude Code session, run:

```
/plugin install footersplit --marketplace juanssilveira/footersplit
```

Answer `y` to add the marketplace, then pick a scope.

## Usage

- `/toggle <item>` cycles an item through auto (the table above), hidden and always shown. Items: `ctx`, `5h`, `weekly`, `spend`, `cost`. Items that are always shown on auto just switch between shown and hidden. The choice is kept across sessions.
- `/toggle` on its own lists every item with its current mode.

The table shows the default thresholds. To change them, set the three footersplit rows (🧠, 🕔 and 📅) in `/config`, or on the screen that comes up when you install. Each row takes three percentages: where the item appears, turns yellow and turns red, like `10 40 60`. Repeat a number to skip a color: `0 90 90` keeps 🕔 gray until it turns red at 90%. A value that isn't three numbers from 0 to 100 in that order falls back to the default. The values are saved in settings.json under `pluginConfigs`, so plugin updates keep them.

The labels are set in `LABELS` at the top of `hooks/register.tsx`.

## Limitations

- The permission-mode label (`⏵⏵ auto mode on`) is drawn by Claude Code itself and cannot be changed by a mod. While it shows, items drop out sooner to leave room for it.
- Mods are an early-access Claude Code feature, and the API may change between releases. Built and tested on Claude Code 2.1.310.

## Development

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## License

MIT
