# Proton Mail layout, applied to GFS Contract Agent

Sources: Proton's open-source web client `ProtonMail/WebClients` (`packages/colors/themes/dist/snow.theme.css`,
`packages/styles/scss/lib/_config.scss`, `base/_typo.scss`, `base/_fonts.scss`, `base/custom-properties/_init.scss`,
`_optionals.scss`, `layout/_structure.scss`, `layout/_navigation.scss`, `layout/_toolbar.scss`, `base/forms/_field.scss`,
`packages/atoms/src/Button/ButtonLike.scss`, `applications/mail/src/app/components/list/ItemColumnLayout.tsx`),
and Proton's support page on inbox layouts (proton.me/support/change-inbox-layout).

## What Proton does, and what we take

| Proton Mail | GFS Contract Agent |
| --- | --- |
| Sidebar 250px: logo, one primary "New message" button, system folders with counts, then labels | Sidebar 250px: logo, one primary **Check mail** button (imports recent inbox emails with PDFs), folders by state with real counts (Inbox, Needs attention, Processing, Draft saved, Failed, Skipped), then Activity and Settings, Microsoft 365 status at the bottom |
| Header 60px with the search field aligned to the conversation column, settings and account on the right | Top bar 60px: document search (`/` focuses it), refresh, settings, account menu |
| Column layout: conversation list (35%, resizable) beside the reading pane | Document list (400px, drag to resize, remembered per browser) beside the reading pane; `/documents/[id]` keeps the list in place |
| Row: unread dot, sender (bold when unread) + date on line 1, subject on line 2, icons; unread rows white, read rows lowered (#f8f8f6), selected row solid interaction colour with white text, hover actions replace the date | Same row anatomy: "unread" means the document needs the owner (needs attention or failed); hover actions are Open draft in Outlook and Retry where they apply |
| Navigation current item: hover-grey background, bold text; unread count as a small primary badge | Same; only "Needs attention" shows the badge, other counts are plain |
| Settings: own sub-navigation of sections beside the content | Settings sub-navigation (scroll-spy) beside the sections |
| Empty reading pane: calm text, no illustration | Counts of what waits, keyboard hints, the signature prompt when missing |
| Below the large breakpoint the list and the message are separate screens | Below 1024px: list, or the open document with a back link |

Deliberately not taken: Proton's purple (replaced by blue, see below), dark themes, labels and folders the user can create, conversation grouping, the drawer/context bar, row view.

## Tokens: Proton value → our value

Font: Proton ships **Inter / InterVariable**; we load Inter (variable) via `next/font/google`. Weights 400 / 600 / 700.
Type: body **14px / 20px**; text sizes sm 12, rg 14, lg 16, xl 18, 2xl 20; headings h1 36, h2 28, h3 20, h4 18, h5 17, h6 16.
Radii: base 8 → **sm 4, md 8, lg 12, xl 16, xxl 24**; buttons and fields use md. Fields and buttons **36px** tall, field padding 16px, focus = focus colour border + 3px ring at 20%.
Shadows: norm `0 1px 4px rgb(0 0 0/.1)`, raised `0 4px 12px rgb(0 0 0/.1)`, lifted `0 8px 24px rgb(0 0 0/.16)`.
Layout: header 60, sidebar 250, navigation item 36, toolbar button 36, field 36, conversation column 35% (ours 400px).

Purple → blue. `#6D4AFF` and `#2563EB` have the same relative luminance (≈0.154, 5.2:1 on white), so the swap keeps every
contrast Proton has. Tints and shades use Proton's own steps: minor-2 ≈ 10% and minor-1 ≈ 20% of the colour over white,
major-1/2/3 = 90/80/70% of the colour.

| Token | Proton (Snow) | Ours |
| --- | --- | --- |
| primary-minor-2 | #f0edff | #e9effd |
| primary-minor-1 | #e2dbff | #d3e0fb |
| primary / interaction-norm / focus-outline | #6d4aff | #2563eb |
| primary-major-1 (hover) | #6243e6 | #2159d4 |
| primary-major-2 (active) | #573bcc | #1e4fbc |
| primary-major-3 | #4c34b3 | #1a45a5 |
| focus-ring | rgb(109 74 255 / .2) | rgb(37 99 235 / .2) |
| text-norm / weak / hint / disabled | #0c0c14 / #5c5958 / #8f8d8a / #c2bfbc | same |
| background-norm / weak / strong / lowered | #ffffff / #f5f4f2 / #e5e4e1 / #f8f8f6 | same |
| border-norm / border-weak | #d1cfcd / #eae7e4 | same |
| field-norm / field-hover | #adaba8 / #8f8d8a | same |
| interaction-weak (minor-2, minor-1, base, major-1) | #f9f8f7, #f5f3f2, #eae7e4, #dedbd9 | same |
| interaction-default-hover / active | rgb(194 193 192/.2) / rgb(194 192 190/.35) | same |
| signal-success / -warning / -danger / -info | #1ea885 / #ff9900 / #dc3251 / #239ece | same (dots, icons) |
| signal minor-2 (soft backgrounds) | #e9f6f3 / #fff5e6 / #fcebee | same |
| status text on white | — | success #18866a (Proton major-2, 4.5:1), danger #c62d49 (major-1, 5.3:1), warning #d94c00 (major-3, 4.2:1 — Proton's darkest warning shade; used at 12–14px semibold) |

## Logo

Drop the new logo in `public/brand/`:

- `public/brand/logo.svg` — the full logo (mark and name). Used in the sidebar and on the sign-in page, max 168×28 px.
- `public/brand/logo-mark.svg` — optional square mark, used beside the "GFS / Contract Agent" text when no full logo exists.

They are picked up on the next request (no code change). Until then the built-in mark is used: a signature stroke on the
brand blue. Motion: on hover the mark lifts by 1px (and tilts 3° for the built-in mark) in 200ms; while **Check mail** runs
the signature stroke writes itself out in a loop (an uploaded logo gently fades, a full logo shows a thin sweep under it),
and it stops when the check ends. Reduced motion shows the logo still.
