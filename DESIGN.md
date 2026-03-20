# Design System — Magnum SSH Dash

## Product Context
- **What this is:** Web-based multi-session CLI/SSH control panel for macOS localhost
- **Who it's for:** Developers and Sysadmins managing remote servers
- **Space/industry:** Developer Tools / Terminal Emulators
- **Project type:** Web application (SPA)

## Aesthetic Direction
- **Direction:** Retro-Futuristic + Industrial/Utilitarian
- **Decoration level:** Intentional — subtle glow effects, terminal-inspired elements
- **Mood:** Professional yet nostalgic, terminal-authentic with modern polish
- **Reference:** Termius, Blink Shell, GitHub Dark

## Typography
- **Display/Hero:** DM Sans Bold — clean, modern, developer-friendly
- **Body:** DM Sans Regular — excellent readability at all sizes
- **UI/Labels:** DM Sans Medium — buttons, tabs, navigation
- **Data/Tables:** JetBrains Mono — tabular-nums support, code aesthetic
- **Terminal:** JetBrains Mono — authentic terminal feel
- **Loading:** System fonts as fallback
- **Scale:**
  - Hero: 28px / 700
  - H1: 24px / 700
  - H2: 20px / 600
  - Body: 16px / 400
  - Small: 14px / 400
  - Caption: 12px / 400
  - Mono: 13px / 400

## Color
- **Approach:** Balanced — accent as primary design tool, semantic colors meaningful

### Dark Mode (Default)
| Token | Hex | Usage |
|-------|-----|-------|
| accent | #00E5CC | Primary actions, links, highlights |
| accent-dim | rgba(0,229,204,0.15) | Accent backgrounds, hover states |
| success | #00D67D | Connected status, success states |
| warning | #FFB800 | Connecting status, warnings |
| error | #FF4757 | Disconnected, errors, delete actions |
| bg-primary | #0D1117 | Page background |
| bg-secondary | #161B22 | Cards, panels, navigation |
| bg-tertiary | #21262D | Inputs, wells, subtle divisions |
| border | #30363D | Borders, dividers |
| text-primary | #E6EDF3 | Main text |
| text-secondary | #8B949E | Supporting text, labels |
| text-muted | #6E7681 | Disabled, placeholder |

### Light Mode
| Token | Hex | Usage |
|-------|-----|-------|
| accent | #00A896 | Darker teal for light backgrounds |
| bg-primary | #FFFFFF | Page background |
| bg-secondary | #F6F8FA | Cards, panels |
| bg-tertiary | #EAEEF2 | Inputs, wells |
| border | #D0D7DE | Borders |
| text-primary | #1F2328 | Main text |
| text-secondary | #656D76 | Supporting text |
| text-muted | #8C959F | Disabled, placeholder |

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable — not cramped, not overly spacious
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64)

## Layout
- **Approach:** Hybrid — app-style for main UI, responsive for sessions
- **Grid:** Single column for mobile, flexible for desktop
- **Max content width:** 480px (mobile-optimized)
- **Border radius:**
  - sm: 6px (inputs, small elements)
  - md: 8px (buttons, cards)
  - lg: 12px (modals, panels)
  - full: 9999px (pills, badges)

## Motion
- **Approach:** Minimal-functional — transitions aid comprehension, not decoration
- **Easing:** ease-out (enter), ease-in (exit), ease-in-out (move)
- **Duration:**
  - micro: 50-100ms (hover, focus)
  - short: 150-250ms (tabs, toggles)
  - medium: 250-400ms (modals, panels)

## Component Specifications

### Session Card
- Background: var(--bg-card)
- Border: 1px solid var(--border)
- Border-radius: 12px
- Padding: 16px
- Status dot: 10px circle with glow effect

### Navigation
- Fixed bottom bar
- Height: 56px + safe-area-inset
- 4 items: Sessions, Snippets, Keys, Settings
- Active state: accent color
- Touch targets: minimum 44x44px

### Quick Connect Bar
- Full-width input
- monospace font (JetBrains Mono)
- Placeholder: user@host:port
- 44px height

### Terminal
- Black background (#000)
- Color-coded prompt:
  - accent: prompt (user@host)
  - success: username
  - info: path
- Blinking cursor animation

### Floating Action Button (FAB)
- Size: 56x56px
- Border-radius: 16px
- Position: bottom-right, 80px from nav
- Shadow: accent glow

## Mobile Considerations
- Safe area insets for notched devices
- minimum-scale=1.0 for iOS (prevent zoom on input focus)
- touch-action: manipulation (remove 300ms delay)
- overscroll-behavior: none (prevent pull-to-refresh conflicts)

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-19 | Initial design system created | Termius-inspired mobile UX for SSH app |
