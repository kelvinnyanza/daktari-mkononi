# Daktari Mkononi — Design System (patient mobile app)

Direction: **calm & trustworthy, like a modern, clean clinic.** Soft teal, lots
of white space, gentle rounded corners, clear large type, simple line icons. No
stock photos of people; "illustrations" are soft tinted circles with an icon.

- Tokens: [`apps/mobile/src/theme/theme.ts`](../apps/mobile/src/theme/theme.ts)
  (+ raw [`palette.ts`](../apps/mobile/src/theme/palette.ts), [`fonts.ts`](../apps/mobile/src/theme/fonts.ts))
- Components: [`apps/mobile/src/ui/`](../apps/mobile/src/ui/index.ts) — import from `src/ui`
- Live preview (dev builds only): `daktari://dev/style-preview`
- Logo geometry: [`apps/mobile/scripts/brand-assets.mjs`](../apps/mobile/scripts/brand-assets.mjs) (generates every SVG/PNG in `apps/mobile/assets/brand/`)

## Brand

**Name lockup:** logo mark + "Daktari" (ink `#17201E`) "Mkononi" (teal
`#0F7366`), Nunito Sans Bold. Horizontal in headers; stacked with the tagline
*"Daktari wako, mkononi mwako"* / *"Your doctor, in your hand"* on login and
splash-like moments. The lockup reads to screen readers as one image,
"Daktari Mkononi".

**Mark:** a white phone resting in a cupped mint hand, with a teal health cross
on its screen ("a doctor in your hand"), on a teal rounded tile. Original
geometry: rectangles plus one curve. It has no lettering and borrows no
established symbol (no caduceus, no serpent, no red cross).

- The geometry lives in `scripts/brand-assets.mjs`; `pnpm --filter @daktari/mobile brand:assets`
  writes the SVGs and all PNGs (resvg, dev-only): in-app mark @1x/2x/3x, app icon
  (square, full-bleed), Android adaptive foreground (66% safe zone) + monochrome
  themed icon, splash image (white background) and web favicon. The app ships
  PNGs because RN has no SVG renderer (react-native-svg would be a new native module).
- App icon / splash changes only reach users through a **new EAS build**.
- Minimum size 24dp. Keep clear space of ¼ of the mark's width around it.
  Never recolour, rotate, outline or add effects. On teal backgrounds, use the
  tile as is: the mark already carries its own tile.

## Colour

Components never use raw hex values. They read **semantic roles** from
`useTheme().colors`, which is what makes a dark theme a second `ThemeColors`
object rather than a screen-by-screen rewrite. `theme.test.ts` checks every pairing.

| Role | Hex | Use | Contrast |
|---|---|---|---|
| `primary` | `#0F7366` | primary buttons, links, active states | 5.7:1 on white |
| `primaryPressed` | `#0B5E54` | pressed primary | 7.7:1 |
| `primarySoft` / `onPrimarySoft` | `#E3F3F0` / `#0B5E54` | tonal (secondary) buttons, selected chips, highlight cards | 6.7:1 |
| `accent` | `#8FD9C6` | mint, decorative only (logo hand). **Never text.** | — |
| `background` | `#F6F9F8` | screen background (soft, not grey) | — |
| `surface` | `#FFFFFF` | cards, sheets, inputs | — |
| `surfaceMuted` | `#EEF3F2` | grouped/inset areas, pressed rows | — |
| `border` | `#D9E1DF` | decorative hairlines | — |
| `borderStrong` | `#84928F` | input/chip outlines | 3.2:1 (non-text ≥ 3) |
| `text` | `#17201E` | body and headings | 16.6:1 |
| `textSecondary` | `#4E5B58` | supporting text | 7.1:1 |
| `textDisabled` | `#66736F` | disabled labels | 4.2:1 on disabled fill |
| `focus` | `#17201E` | keyboard/switch focus ring | 16:1 vs page |
| success | fg `#1C6B3A` / bg `#E7F5EC` | paid, completed | 5.8:1 |
| warning | fg `#7A4A00` / bg `#FFF5E0` | awaiting payment, time running out | 6.9:1 |
| danger | fg `#B42318` / bg `#FEEDEB` | errors, failed, destructive buttons | 5.8:1 (6.6 on white) |
| info | fg `#1D5A96` / bg `#EAF2FB` | confirmed, neutral notices | 6.3:1 |
| neutral | fg `#4E5B58` / bg `#EEF3F2` | cancelled, refunded | 6.3:1 |
| **emergency** | `#B91C1C` + white | **112 / 115 only** | 6.5:1 |

**Emergency rule:** 112/115 always uses the solid `emergencyBg` with white
bold text (`EmergencyStrip`, `EmergencyCallCard`). It is a separate role from
`danger`, so softening error styling can never soften the emergency UI. A dark
theme must keep these values. Never use 999, 911 or 114.

## Typography: Nunito Sans

Nunito Sans (SIL OFL) is an open humanist sans with a generous x-height, so
it stays legible on low-DPI budget panels. Its moderate width fits long
Swahili words better than wide geometric faces. Only three weights ship
(Regular 400, SemiBold 600, Bold 700; ≈113 KB each), imported per weight
(`@expo-google-fonts/nunito-sans/400Regular`), never from the package root,
which would bundle all 16 files.

**No new EAS build is needed for the font.** It is loaded at runtime by
`expo-font`, which is already in the native build, from bundled assets (no
network). The root layout holds the first frame until fonts load (tens of
ms) and falls back to the system font on error.

| Variant | Size / line | Weight | Use |
|---|---|---|---|
| `display` | 28 / 36 | Bold | greeting, top-level screen titles |
| `title` | 22 / 30 | Bold | section titles, sheet titles |
| `heading` | 18 / 26 | SemiBold | card titles, header bar title |
| `body` | 16 / 24 | Regular | all reading text (minimum for paragraphs) |
| `bodyStrong` | 16 / 24 | SemiBold | names, values, list titles |
| `label` | 15 / 22 | SemiBold | field labels, small buttons, chips |
| `caption` | 13 / 18 | Regular | metadata only, never for instructions |
| `button` | 16 / 22 | Bold | buttons |

Always use `<Text variant tone>` from `src/ui`, never RN `Text` with ad-hoc
sizes. Custom fonts on Android ignore `fontWeight`, so each variant sets its
own family.

## Spacing, radius, elevation, layout

- **Space (4dp grid):** `space[1]=4, [2]=8, [3]=12, [4]=16, [5]=20, [6]=24,
  [8]=32, [10]=40, [12]=48, [16]=64`. Use 24 between sections on a screen,
  12–16 inside a card, and 8 between related items.
- **Radius:** `sm 8` · `md 12` (buttons, inputs, rows) · `lg 16` (cards,
  banners) · `xl 24` (sheet) · `pill` (pills, avatars, icon buttons).
- **Elevation:** `none`, `sm` (cards: a 1dp soft shadow plus a hairline
  border), `md` (bottom sheet). Nothing heavier.
- **Layout:** touch target **48dp minimum** (buttons are 52). Gutter 16dp on
  phones and 32dp on tablets (≥ 600dp wide). Content is capped at **640dp**
  and centred on tablets (`Screen` does this for you).

## Components (`src/ui`)

| Component | Notes |
|---|---|
| `Screen` | safe area + background + optional `header` + scrolling capped column + optional sticky `footer` (primary action within thumb reach). Also `Section`, `Stack`, `useResponsive()`. |
| `Header` | `onBack` adds a 48dp back button labelled "Rudi nyuma" / "Go back"; `large` for tab screens; titles wrap and are never truncated. |
| `Button` | `primary` · `secondary` (tonal) · `ghost` · `danger`; `size md/sm`; `icon`; `loading` (spinner, label kept, presses blocked); `disabled`. Full width by default. Labels wrap. |
| `IconButton` | 48×48; **`accessibilityLabel` is required by type**. Pass a `t()` string so it is read in Swahili or English. |
| `Card` | `tone default/muted/primary`; with `onPress` it becomes one tap target (then pass `accessibilityLabel`). |
| `Input` | visible label above, `hint` below, `error` replaces the hint (red border + icon, announced politely), `leadingIcon`, `disabled`. No jump between states. |
| `ListItem` | leading · title/subtitle · `meta` (pills, price; wraps) · trailing · chevron. ≥ 64dp tall. |
| `Badge`, `AppointmentStatusPill`, `PaymentStatusPill` | icon + text; status is never shown by colour alone. Status→tone mapping is defined once (`APPOINTMENT_STATUS_STYLE`, `PAYMENT_STATUS_STYLE`). |
| `Avatar` | initials (honorifics dropped), stable calm tint per name, decorative. No photos. |
| `ChipGroup` | single-select, radio semantics, wraps, 48dp. |
| `EmptyState` | soft illustration + short line + **one** action. |
| `ErrorState` | `kind="offline"` → "Hakuna mtandao" + retry; `kind="error"` → generic or the API's bilingual message. |
| `Skeleton*` | one shared native-driver pulse; static when "remove animations" is on; hidden for the first 150ms; announced once via `SkeletonGroup`. |
| `Banner` | `info/success/warning/danger`, optional title and action. |
| `EmergencyStrip`, `EmergencyCallCard` | solid red; the card has "Piga 112" / "Piga 115" call buttons (`tel:`). |
| `BottomSheet` | RN `Modal` plus one 220ms slide; closes on backdrop tap, close button and Android back; capped width on tablets. |
| `Logo`, `LogoMark` | see Brand. |
| `Icon` | Feather line icons (`@expo/vector-icons`, 56 KB font, preloaded). Decorative and hidden from screen readers. |

## Rules — do / don't

**Do**
- Use `Screen` + `Header` on every screen; one primary `Button` per screen.
- Put every string through `t()`, including accessibility labels. Add both `sw` and `en`.
- Test with the **longest Swahili strings** and with system font size at **1.3×
  or larger**. Text must wrap rather than clip.
- Let content set height: `minHeight`, never `height`, around text.
- Pair every status colour with an icon and words.
- Use `Banner` for in-flow messages and `ErrorState`/`EmptyState` for whole-area states.

**Don't**
- Don't use raw hex values or numbers in screens. Use roles and `space[n]`.
- Don't set fixed `width` on text containers, and don't use `numberOfLines` on
  instructions, names or prices.
- Don't use `maxFontSizeMultiplier` on content text. (The logotype and
  initials avatars are fixed artwork; the text beside them scales.)
- Don't restyle, tint or soften 112/115 emergency UI, and don't use
  `danger` for it.
- Don't add animation libraries. Use subtle `Animated` with the native driver
  only, and respect "remove animations".
- Don't use photos of people or stock imagery.

## Accessibility checklist (per screen)

1. Every tappable element is ≥ 48dp and has a role. Icon-only buttons have a `t()` label.
2. Focus ring is visible (keyboard/D-pad on tablets); pressed state is visible.
3. The screen title is a `header` and reads correctly with TalkBack in both languages.
4. At 1.3× font size and in Swahili: nothing is clipped, overlapping or truncated.
5. Contrast: only use role pairings covered by `theme.test.ts`.

## Dark theme (later)

Add `darkColors: ThemeColors` in `theme.ts` and wrap the app in
`<ThemeProvider value={darkTheme}>`. Every component reads colours through
`useTheme()` / `createStyles()`, which caches one StyleSheet per theme. Add
the dark pairings to `theme.test.ts`. Emergency values stay the same.

## Migration note

UI Phase 1 step 2 moved every patient screen onto `src/ui`; the legacy
`src/components/ui.tsx` kit and the old `colors`/`typography` tokens are gone.
`src/theme/tokens.ts` keeps only `contrastRatio`.
