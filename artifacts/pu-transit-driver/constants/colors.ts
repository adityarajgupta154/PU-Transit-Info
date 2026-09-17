/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#0F1B2D',
    tint: '#0A76D6',

    // Core surfaces
    background: '#F6F7FB',
    foreground: '#0F1B2D',

    // Cards / elevated surfaces
    card: '#FFFFFF',
    cardForeground: '#0F1B2D',

    // Primary action color (buttons, links, active states)
    primary: '#0A76D6',
    primaryForeground: '#FFFFFF',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#f0f0f0',
    secondaryForeground: '#1a1a1a',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#f0f0f0',
    mutedForeground: '#506077',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#f0f0f0',
    accentForeground: '#1a1a1a',

    // Destructive actions (delete, error states)
    destructive: '#AE2338',
    destructiveForeground: '#FFFFFF',
    success: '#167443',

    // Borders and input outlines
    border: '#7F8DA3',
    input: '#7F8DA3',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 0,
};

export default colors;
