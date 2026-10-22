# DSH mobile layout (draft)

A minimal Web client plugin that makes the existing DSH Web shell usable on
phones. It changes **layout only**.

It deliberately does **not** implement a remote portal, QR pairing, a tunnel,
a separate phone UI, or a custom keyboard. The phone's own Android/iOS IME
(nine-key, T9, pinyin or full) remains in charge of text input.

> Draft status: this package is not bundled into the Web image yet. Install it
> into a test profile, run the matrix below, then decide whether to add it to
> the Web profile. The image still ships the stock desktop shell.

## What it does

- A fixed **Mobile / Desktop** button (top-right, safe-area aware).
- Three persisted modes:
  - `auto`: mobile when `max-width: 1023px`, desktop otherwise;
  - `mobile`: drawer layout on any width;
  - `desktop`: stock layout on any width.
- `?layout=auto|mobile|desktop` URL override for recovery if the button is
  unreachable; the value is persisted to `localStorage`.
- On mobile:
  - sidebar becomes a left drawer over a full-width conversation;
  - safe-area padding for status bar / notch / gesture bar;
  - viewport meta gains `viewport-fit=cover` and
    `interactive-widget=resizes-content`;
  - composer stays above the soft keyboard (`visualViewport` lift as a
    fallback for engines that ignore `interactive-widget`, including iOS);
  - text fields use a 16px floor to avoid iOS focus zoom;
  - horizontal overscroll is contained.
- On desktop, the injected CSS is inert and the original viewport meta is
  restored.

## Evaluation result

The current DSH Web shell is desktop-first and its viewport meta is only
`width=device-width, initial-scale=1`. On Chrome for Android the keyboard
therefore uses the default `resizes-visual` model: the layout viewport does not
shrink, the browser pans the page to reveal the focused composer, and the top
bar / composer appear to jump.

`dsh-pocket` 2.12.0 improves the narrow layout (drawer, safe area, 16px inputs)
but its port predates the `interactive-widget=resizes-content` and
`visualViewport` composer-lift work in `dsh-web-mobile` 3.2.x. It is also
GPL-2.0, so it is not a good fit for bundling into this Apache-2.0
distribution.

`dsh-web-mobile` 3.2.1 is MIT and contains the complete fix, but it is a
16.5k-line general mobile shell with file sharing, session logs, stats, pets,
wallpapers and third-party compatibility. That is far more than "layout only".

This plugin is the minimal subset:

| Capability | Adopted here | Source |
| --- | --- | --- |
| `interactive-widget=resizes-content` | yes | `dsh-web-mobile` behavior, reimplemented |
| stable `visualViewport` height | yes, CSS variable | reimplemented |
| composer lift | yes, small fallback | reimplemented |
| drawer / full-width / safe area | yes, minimal CSS | reimplemented |
| 16px input floor | yes | `dsh-web-mobile` behavior |
| manual layout switch | yes | new |
| file sharing, session logs, stats, pets, wallpapers, explorer, terminal keybar | no | out of scope |
| custom nine-key keyboard | no | system IME |
| QR / tunnel / portal | no | explicitly out of scope |

The result is roughly a 10–15% behavioral subset of `dsh-web-mobile`; the
remaining code there is ecosystem compatibility and edge-case repair.

## Nine-key input

No keyboard is implemented. The composer is the host's normal editing surface,
so Gboard's nine-key/T9, pinyin nine-key, handwriting and full keyboard all
continue to work. The plugin only keeps that surface visible and prevents the
old viewport pan.

If "nine-key" ever means an **in-app keypad**, that is a separate input-method
project: candidates, composition, clipboard, accessibility and IME policy. It
is not part of this layout plugin.

## Install for testing

From a checkout:

```sh
dsh plugin --profile web add /absolute/path/to/plugins/mobile-layout
```

Restart `dsh web`, then open the Web UI. The button appears at the top-right.
Use `?layout=auto` to return to automatic mode.

This package has no runtime dependencies and no build step. It is a browser
plugin plus an inert host entry.

## Test matrix

| # | Environment | Action | Expected |
| --- | --- | --- | --- |
| 1 | Desktop Chromium, ≥1024px | Load with no stored mode | Desktop layout, button says `Mobile` |
| 2 | Desktop Chromium | Click `Mobile` | Drawer layout, full-width conversation, button says `Desktop` |
| 3 | Desktop Chromium | Reload | Forced mobile mode persists |
| 4 | Desktop Chromium | `?layout=auto`, reload | Auto mode returns to desktop |
| 5 | Android Chrome, 390×844 | Load with `auto` | Mobile layout, no horizontal page scroll |
| 6 | Android Chrome | Open drawer; tap conversation; tap backdrop | Drawer opens, closes on outside tap, conversation stays usable |
| 7 | Android Chrome, Gboard nine-key | Focus composer | Composer stays above keyboard; top bar does not leave the screen |
| 8 | Android Chrome, pinyin nine-key | Type, commit candidates, send | No lost characters, no send during composition |
| 9 | Android Chrome | Toggle `Desktop` while keyboard is open | Stock desktop layout, keyboard state remains sane |
| 10 | Android Chrome | Rotate portrait ↔ landscape | Drawer width, safe area and composer remain usable |
| 11 | Android Chrome, notched device | Load mobile | Header below status bar, composer above gesture bar |
| 12 | iOS Safari | Focus composer | Composer lifted above the keyboard / form assistant |
| 13 | iOS Safari | Toggle modes, reload | Mode persists; no focus zoom from sub-16px fields |
| 14 | Desktop | Resize below/above 1024px in `auto` | Mode follows the breakpoint only in `auto` |
| 15 | Any | Uninstall plugin / reload | Stock viewport meta and layout restored |

Record the host DSH version, browser version, device and pass/fail for each
row. Native Android keyboard behavior must be verified on a real device, not
only in a desktop Chromium mobile emulator.

## Known limits

- CSS targets the current host's stable hooks
  (`data-shell-overlay`, `data-sidebar-collapsed`, `_composerSeat`) and is
  expected to need review on DSH upgrades.
- The drawer has no gesture support; the header toggle and backdrop tap are the
  controls.
- There is no right-side panel or file-explorer redesign.
- The button is intentionally always visible; it is the escape hatch from a
  forced layout.

## License

Apache-2.0. The behavior is informed by the MIT-licensed `dsh-web-mobile`
project; no source files were copied.
