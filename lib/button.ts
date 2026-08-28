/**
 * Button styles, as tokens.
 *
 * Every button in the app draws from here. The rule this enforces: a control
 * that invents its own colours drifts out of the theme the moment the theme
 * moves — which is exactly how "ออกจากระบบ" and "ติดตั้งแอป" ended up as bare
 * white boxes on a page where nothing else is a bare white box.
 *
 * These are class strings rather than a <Button> component on purpose: the
 * codebase already renders buttons through forms, links and Server Action
 * `action=` props, and a wrapper component would have to re-expose all of that
 * surface. A shared string composes with any of them.
 *
 * Gold is not here. It belongs to the price readout, so no control uses it.
 */

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 disabled:pointer-events-none";

export const BUTTON_SIZE = {
  sm: "px-3 py-1.5",
  md: "px-4 py-2.5",
  lg: "px-5 py-2.5",
} as const;

/** The one action a screen most wants you to take. At most one per view. */
export const btnPrimary = `${BASE} ${BUTTON_SIZE.md} bg-brand text-white hover:bg-brand-dark`;

/** Everything else that is still a real action. */
export const btnSecondary = `${BASE} ${BUTTON_SIZE.md} border border-black/15 bg-white text-ink hover:border-brand/50 hover:text-brand`;

/** Low-emphasis, sits inside dense rows. */
export const btnGhost = `${BASE} ${BUTTON_SIZE.sm} text-ink/70 hover:bg-black/[.05] hover:text-ink`;

/** Removes something. Red type on a light ground, not a solid red slab: a
 *  destructive control should be findable, not the loudest thing on screen. */
export const btnDanger = `${BASE} ${BUTTON_SIZE.md} border border-red-600/30 bg-white text-red-700 hover:bg-red-50`;

/** Small variants, for controls that sit inside cards and list rows. */
export const btnPrimarySm = `${BASE} ${BUTTON_SIZE.sm} bg-brand text-white hover:bg-brand-dark`;
export const btnSecondarySm = `${BASE} ${BUTTON_SIZE.sm} border border-black/15 bg-white text-ink hover:border-brand/50 hover:text-brand`;
