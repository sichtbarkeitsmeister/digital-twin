# Design Guide (UI System + Chatbot Layout)

This document is the **single source of truth** for UI decisions in this project.
It codifies the designer’s requirements and the intended chatbot layout.

---

## Brand Foundation

### Colors (brand)

- **Deep Indigo (primary dark)**: `#2E2E50`
  - Use for: backgrounds, body text on light surfaces, headings, UI chrome.
- **Mint (accent)**: `#64FDC2`
  - Use for: highlights, primary actions, focus states, active indicators.
  - **Rule**: Mint is used **only in combination with the dark color** (mint-on-dark or dark-on-mint).

### Usage rules (non-negotiable)

- **Never** place mint text on a light background; reserve mint for **dark surfaces**.
- Prefer mint as an **accent**, not a fill-everywhere color.
- Keep color meaning consistent:
  - Mint = active/confirm/primary emphasis
  - Red/amber (non-brand) = error/warning only (used sparingly)

### Suggested semantic tokens

Use semantic tokens in code so we can adjust later without redesigning components.

- **Background**
  - `bg/base`: deep indigo background or near-black tinted with deep indigo
  - `bg/surface`: slightly lighter than base (cards, panels)
  - `bg/elevated`: one step lighter than surface (menus, popovers)
- **Text**
  - `text/primary`: near-white on dark backgrounds
  - `text/secondary`: muted gray on dark backgrounds
  - `text/heading`: near-white, stronger weight
- **Accent**
  - `accent/primary`: mint
  - `accent/primary-foreground`: deep indigo (for text/icons on mint fills)
- **Borders**
  - `border/subtle`: low-contrast on dark
  - `border/accent`: mint (for focus/active outlines on dark)

---

## Typography

### Font

- **Poppins** for everything.
- Headings: **bold** (600–700)
- Body: **regular** (400)
- Subtle/meta text: **thin/light** (200–300) when legible.

### Type scale (recommended)

- **H1**: 32–40px, 700, tight leading
- **H2**: 24–28px, 700
- **H3**: 18–20px, 600
- **Body**: 14–16px, 400
- **Small**: 12–13px, 300–400

### Copy tone

- Short, action-oriented labels.
- Prefer sentence case: “New chat”, not “NEW CHAT”.
- Empty states: one clear line + one supportive line + 2–3 suggested actions.

---

## Shape Language (rounded corners)

Designer request: **more rounded corners**.

### Radius scale (recommended)

- **Small controls** (inputs, chips): 12px
- **Buttons**: 14px
- **Cards/panels**: 16–20px
- **Modals/popovers**: 20px

Rule: Use consistent radii per component type; avoid mixing many radii in one view.

---

## Spacing & Layout

### Spacing

- Use an **8px grid** (8/16/24/32…).
- Dense areas (chat list, message groups) can use 6/12px but stay consistent.

### Layout

- Prefer generous breathing room on desktop; don’t over-pack.
- Keep primary actions reachable: top-right for global actions, bottom for composer.

---

## Components (visual rules)

### Buttons

- **Primary**: mint background with deep indigo text/icons.
- **Secondary**: deep indigo surface with subtle border, near-white text.
- **Ghost**: transparent with hover surface.
- **Focus**: visible ring using mint on dark surfaces.

### Inputs

- Dark surface + subtle border.
- Placeholder text is muted; value text is primary.
- Focus state: border or ring in mint.

### Cards / Tiles

- Dark surface with subtle border.
- Slight gradient or soft highlight is allowed, but keep it understated.
- Use mint only for small indicators, icons, or primary CTA buttons on the tile.

### Shadows

- Use shadows sparingly on dark UI.
- Prefer “lift” via slightly lighter surface + subtle border over heavy shadows.

---

## Accessibility (must-have)

- Maintain readable contrast for all text.
- Ensure interactive elements have:
  - clear hover state
  - clear focus state (mint ring on dark)
  - minimum hit area ~40px (mobile), ~36px (desktop)

---

## AI Chatbot — Target Layout (matching the provided screenshot)

The desired UI resembles a **modern dark workspace**:
left sidebar navigation, a top-right utility area, a central main area with an “empty state”, and a bottom composer.

### Global structure

- **Left Sidebar (fixed)**
  - App name/logo at top.
  - Primary nav: Chat, Archived, Library (or equivalent).
  - “Workspaces” section with items (optional).
  - Bottom area: plan/status/upgrade/secondary links (optional).
- **Top Bar (main content header)**
  - Right-aligned small actions: “Configuration”, “Export” (and potentially user avatar).
  - Keep it subtle; don’t compete with main content.
- **Main Content**
  - When no messages / new chat:
    - Centered hero with short headline (e.g., “Ready to create something new?”)
    - A minimal brand orb/illustration centered above or near the heading
    - 2–3 pill buttons (quick actions)
    - A text input/composer area near the bottom
    - Optional suggestion tiles/cards below the composer (3-up on desktop)
  - When conversation exists:
    - Scrollable message list
    - Sticky composer at bottom

### Chat view rules

- **Message bubbles**
  - Keep shapes rounded (16–20px).
  - Assistant messages: dark surface bubble.
  - User messages: slightly different shade or outline; do **not** use mint fill for long blocks.
  - Mint is reserved for:
    - small icons
    - active state indicators
    - primary action buttons
    - focus rings
- **Composer**
  - Full-width input with rounded container.
  - Send button is the primary action (mint).
  - Support optional attachments/settings icons as subtle ghost buttons.

### Suggested breakpoints

- **Desktop**
  - Sidebar: 260–300px
  - Main max-width: 900–1100px (centered)
- **Tablet**
  - Sidebar collapsible (icon-only or overlay)
- **Mobile**
  - Sidebar becomes a drawer; composer remains sticky.

---

## Do / Don’t

- **Do**: lead with deep indigo; use mint as an accent on dark.
- **Do**: keep corners noticeably rounded across the app.
- **Do**: use Poppins bold for headings; regular/thin for body/meta.
- **Don’t**: use mint on light backgrounds or as a constant background fill.
- **Don’t**: mix many radii, borders, and heavy shadows in one screen.

---

## Implementation notes (for when we code)

- Prefer semantic tokens (CSS variables) rather than hard-coding hex values everywhere.
- Centralize radius via a single variable (e.g. `--radius`) and scale from it.
- Import Poppins once globally and rely on Tailwind/utility classes for weights.
