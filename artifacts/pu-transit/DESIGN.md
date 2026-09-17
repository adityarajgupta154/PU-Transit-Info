---
name: "PU Transit"
description: "A Metro typographic tile system for glanceable, truthful campus bus status."
colors:
  pu-blue: "#0A76D6"
  cool-grey-ground: "#F6F7FB"
  near-black-ink: "#0F1B2D"
  white-ink: "#FFFFFF"
  fault-crimson: "#AE2338"
  slate-border: "#7F8DA3"
  muted-ink: "#506077"
  ended-field: "rgba(15, 27, 45, 0.10)"
typography:
  display:
    fontFamily: "Work Sans Variable, Work Sans, system-ui, sans-serif"
    fontSize: "4rem / 6rem"
    fontWeight: 200
    lineHeight: 0.95
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Work Sans Variable, Work Sans, system-ui, sans-serif"
    fontSize: "2.5rem / 3.5rem"
    fontWeight: 200
    lineHeight: 0.95
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Work Sans Variable, Work Sans, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 200
    lineHeight: 0.95
    letterSpacing: "-0.03em"
  body:
    fontFamily: "Work Sans Variable, Work Sans, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Work Sans Variable, Work Sans, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  none: "0rem"
spacing:
  unit: "0.25rem"
  tight: "0.5rem"
  standard: "1rem"
  tile-inline: "1.25rem"
  section: "2rem"
  page-desktop: "3rem"
components:
  button-primary:
    backgroundColor: "{colors.pu-blue}"
    textColor: "{colors.white-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "1rem 1.25rem"
    height: "min 3.5rem"
  button-outline:
    backgroundColor: "{colors.white-ink}"
    textColor: "{colors.near-black-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "1rem 1.25rem"
    height: "min 3.5rem"
  button-destructive:
    backgroundColor: "{colors.fault-crimson}"
    textColor: "{colors.white-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "1rem 1.25rem"
    height: "min 3.5rem"
  input:
    backgroundColor: "{colors.white-ink}"
    textColor: "{colors.near-black-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "0 1rem"
    height: "3.5rem"
  state-live:
    backgroundColor: "{colors.pu-blue}"
    textColor: "{colors.white-ink}"
    typography: "{typography.headline}"
    rounded: "{rounded.none}"
    padding: "0.75rem 1.25rem"
    height: "min 6rem"
  state-waiting:
    backgroundColor: "{colors.white-ink}"
    textColor: "{colors.near-black-ink}"
    typography: "{typography.headline}"
    rounded: "{rounded.none}"
    padding: "0.75rem 1.25rem"
    height: "min 6rem"
  state-fault:
    backgroundColor: "{colors.fault-crimson}"
    textColor: "{colors.white-ink}"
    typography: "{typography.headline}"
    rounded: "{rounded.none}"
    padding: "0.75rem 1.25rem"
    height: "min 6rem"
---

# Design System: PU Transit

## Overview

**Creative North Star: "The Living Number Plate"**

PU Transit is a Metro typographic-tile world built for a fast outdoor glance. A cool-grey plate carries near-black type; large, light words and solid state fields make one bus, one state, and one age more prominent than interface chrome. PU blue is the one committed color, flooding live truth, primary action, current selection, route line, and the app bar. The system rejects dashboards, cards, decorative headings, gradients, shadows, and ornamental layering.

Truth is visible rather than reassuring: a tracking claim always travels with its age, and each state has a distinct field treatment. Motion is physical and brief—a pressed tile tilts in 120ms, page content makes one 600ms turnstile sweep, and accepted live samples flip on the X axis for 600ms with the Metro exponential curve (`cubic-bezier(0.1, 0.9, 0.2, 1)`). Reduced-motion mode removes these three transforms while retaining immediate color changes.

**Key Characteristics:**
- Cool-grey ground with one dominant PU-blue signal.
- Giant, light, mostly lowercase Work Sans headlines.
- Square solid fields, deep gutters, and no card chrome.
- Text, age, and shape communicate state together.
- Lucide outline icons and a responsive Metro app bar.

## Current owner direction (13 Sep 2026)

The surface remains the **PU Transit web app**; native driver tracking is
later. Driver-facing UI is intended to support Hindi and Gujarati, pending
native-speaker review. Keep driver labels short and operational until that
review is complete. PU blue is pinned to `#0A76D6`; never replace it with
indigo or another framework accent.

## Colors

The light palette behaves like transit signage: cool grey and near-black establish the plate, PU blue declares action or current truth, and crimson is reserved for faults and destructive consequences.

### Primary
- **PU Blue:** The only dominant accent. Flood live states, selected choices, primary actions, text selection, route lines, and the entire app bar with it; always use white ink on the field.

### Secondary
- **Fault Crimson:** Use with white ink for offline, conflict, lost GPS, invalid states, and destructive actions.

### Neutral
- **Cool-Grey Ground:** The permanent page plate and plain grouping field.
- **Near-Black Ink:** Primary text, structural waiting outlines, stop stamps, and light-ground focus rings.
- **White Ink:** Text on PU blue and crimson, waiting and input fills, and map control surfaces.
- **Slate Border:** The 2px input, card, divider, and secondary-field outline.
- **Muted Ink:** Secondary explanations and disabled map-control text.
- **Ended Field:** A 10% near-black wash over the light ground for ended or unavailable fields.

### Named Rules
**The One Blue Rule.** PU blue means live truth, the primary action, the current selection, route line, or app bar; do not spend it on decoration.

**The State Stamp Rule.** Live is PU blue with white ink; waiting is white with a 2px near-black outline; faults are crimson with white ink; ended is a 10% near-black wash.

## Typography

**Display Font:** Work Sans Variable (self-hosted through `@fontsource-variable/work-sans`, with Work Sans, system-ui, sans-serif fallbacks)  
**Body Font:** Work Sans Variable (with the same fallbacks)

**Character:** One sans family carries both monumental signage and plain operational language. Weight, scale, and field color—not a decorative display face—create hierarchy.

### Hierarchy
- **Display** (200, 4rem phone / 6rem from 768px, 0.95 line-height, -0.03em): Page headlines and bus-number panoramas.
- **Headline** (200, 2.5rem phone / 3.5rem from 768px, 0.95 line-height, -0.03em): Major blocks and state words.
- **Title** (200, 1.75rem, 0.95 line-height, -0.03em): Bus rows and compact typographic tiles.
- **Body** (400, 1.125rem, 1.4 line-height): Instructions, operational copy, labels, and controls.
- **Label** (400, 1.125rem, lowercase): One plain label above each field.

### Named Rules
**The Lowercase Signal Rule.** Set interface headlines and labels in lowercase; preserve the natural case of bus registrations, account identifiers, and other data.

**The Panorama Rule.** Bus-number headlines may deliberately stay on one line and clip at the right edge. Every other headline wraps with balanced text and may break long words.

**The Tabular Truth Rule.** Use tabular numerals for ages, times, route indexes, GPS values, and changing counts so updates do not shift the layout.

## Layout

Phone pages use 1.25rem side gutters, a 3.5rem blue brand band above the page, and a fixed 5rem bottom app bar including the safe-area inset. At 768px, the brand moves to the top of a static 7rem left rail and page gutters increase to 2rem; desktop pages commonly use 3rem gutters. The shared spacing unit is 0.25rem, with 0.5rem control gaps, 1–1.5rem internal tile spacing, and 2–2.5rem between major blocks.

Student and driver desktops split into a 40% command column and a flexible result or checklist region. Admin forms and lists become balanced two-column grids at 1024px. On phones, content stays linear, selected bus detail replaces results, and touch actions remain visible with targets of at least 44px; standard tile buttons are at least 3.5rem tall.

The app bar carries the round badge asset, “PU Transit,” the tagline “Find your bus. Every day.”, and circled outline icons. It is bottom-fixed with a separate top brand band on phones and a left rail on desktop; pages do not repeat the identity as an eyebrow.

## Elevation & Depth

The system is flat by construction. Every shadow token is `none`; there are no gradients, raised cards, blur layers, or ambient shadows. Hierarchy comes from scale, solid color floods, 2px outlines and separators, open light gutters, and brief perspective motion during interaction.

### Named Rules
**The Flat Ground Rule.** Never add a shadow or gradient to separate a surface; use a solid state field, an outline, a divider, or space.

## Shapes

Tiles, fields, popups, controls, status stamps, map markers, and section fields use zero corner radius. The recurring round silhouettes are the 44px circled app-bar icon and the source badge itself; neither licenses rounded container chrome. Borders are structural: waiting tiles use 2px near-black, while inputs and secondary white fields use 2px slate.

Clipping is an intentional panorama device only when the headline component's clip option is set, chiefly for bus numbers. Otherwise, content wraps and remains readable at narrow widths.

## Components

### Buttons
- **Shape:** Square tile, at least 3.5rem tall, with 1.25rem horizontal and 1rem vertical padding.
- **Primary:** PU-blue field with white ink for the screen's main action.
- **Hover / Focus:** Color stays stable; keyboard focus is a 3px currentColor outline offset by 3px—near-black on the plate and white on blue. Pressing tilts the tile with `perspective(600px) rotateX(4deg) scale(0.985)` over 120ms.
- **Secondary:** White with a 2px near-black outline.
- **Destructive:** Crimson with white ink, used only after the consequence is explained.
- **Disabled:** Keep semantic color but reduce the whole tile to 40% opacity.

### Chips
- **Style:** Selection tiles are square solid blocks, not pills; selected is PU blue with white ink and unselected is white with a 2px near-black outline.
- **State:** Pair `aria-pressed` with the visual flood. Never repeat the same selected state in a second badge or label.

### Cards / Containers
- **Corner Style:** Square.
- **Background:** Use the cool-grey ground, a semantic solid tile, or no field at all.
- **Shadow Strategy:** None.
- **Border:** Only a semantic 2px outline or row divider.
- **Internal Padding:** Usually 1–1.5rem.

### Inputs / Fields
- **Style:** A 3.5rem-high white box with a 2px slate outline, near-black 1.25rem text, blue caret, and 1rem horizontal padding; the label sits once above it.
- **Focus:** The global 3px currentColor outline with 3px offset.
- **Error / Disabled:** `aria-invalid` turns the outline crimson; put errors below in crimson text. Disabled fields retain their treatment at 40% opacity.

### Navigation
- **Style:** Lucide single-stroke icons sit inside 44px white circles on the blue app bar. Inactive stamps are transparent with white outlines and white icons; active stamps are white discs with blue icons. Navigation sits at the bottom on phones and in a 7rem left rail from 768px.
- **Identity asset:** The round `public/logo.png` badge appears at 36px in the phone brand band and 56px at the desktop rail top. It is a 256px raster cut from the owner's 12 September 2026 app screenshot because no vector original exists; this records the shipped asset, not permission to enlarge it.

### Live State Tile
- One state word, one age, and one Lucide glyph occupy a minimum 6rem-high state field. Each accepted server sample re-keys the tile and flips it from `rotateX(-90deg)` to `rotateX(0deg)` over 600ms; the age uses tabular numerals and updates every second.
- State semantics are never labelled twice. A short hint may explain the consequence, but it must not add a second status badge.

### Pivot
- Admin sections are large lowercase near-black words in a horizontal, scrollable tablist. The selected tab is near-black; unselected tabs use 55% near-black and rise to 80% on hover. Arrow keys move selection and focus.

### Map Chrome
- Leaflet zoom bars, attribution, popups, and close controls are deliberately restyled as square white/near-black Metro chrome with no shadows; interactive controls are 44px. The OpenFreeMap positron basemap keeps the PU-blue route and live stamp as the saturated map marks.
- These overrides remain unlayered on purpose because Leaflet injects its own unlayered stylesheet later, and layered rules would lose equal-specificity ties.

## Do's and Don'ts

### Do:
- **Do** use PU blue only for live truth, the primary action, the current selection, route line, or app bar.
- **Do** show a tracking state's age and textual name; color is never the sole signal.
- **Do** let bus-number headlines clip at the right edge while balancing and wrapping other headlines.
- **Do** provide one visible label per state or field, not two competing labels.
- **Do** explain the consequence and ask for confirmation before end, delete, force-end, import, or another irreversible action.
- **Do** use Lucide outline icons, visible focus, at least 44px touch targets, and a textual non-map route equivalent.

### Don't:
- **Don't** add cards, rounded surface corners, shadows, gradients, or decorative elevation.
- **Don't** use kickers or eyebrows; the university name belongs only in the app bar wordmark.
- **Don't** use glyph characters, emoji, icon fonts, or a system display face in place of the self-hosted Work Sans and Lucide vocabulary.
- **Don't** animate turnstiles, flips, or press transforms when reduced motion is requested.
- **Don't** imply that a bus is live without a fresh, server-accepted sample.