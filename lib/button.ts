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

/**
 * Everything else that is still a real action.
 *
 * Red outline, not a neutral grey one. A bare white box with a black hairline
 * belongs to no theme in particular, which is how "ออกจากระบบ" and "ติดตั้งแอป"
 * came to look like they had been pasted in from another site. Tying the
 * secondary to the brand means the whole app reads as one palette, and it is
 * the pattern Thai shoppers already know from Shopee's outlined controls.
 */
export const btnSecondary = `${BASE} ${BUTTON_SIZE.md} border border-brand/35 bg-white text-brand hover:bg-brand hover:text-white`;

/** Low-emphasis, sits inside dense rows. */
export const btnGhost = `${BASE} ${BUTTON_SIZE.sm} text-ink/70 hover:bg-black/[.05] hover:text-ink`;

/**
 * Removes something, or ends it.
 *
 * The palette has one hue, so danger cannot be a different colour from the
 * brand — it has to be a different weight. Solid brand-dark is the heaviest
 * control in the app and nothing else uses it, so "ลบ" and "ยกเลิกประกาศ" can
 * never be mistaken for the ordinary action next to them. The raw red-600 this
 * replaces was a fourth red on a three-red palette.
 */
export const btnDanger = `${BASE} ${BUTTON_SIZE.md} bg-brand-dark text-white hover:bg-ink`;

/** Small variants, for controls that sit inside cards and list rows. */
export const btnPrimarySm = `${BASE} ${BUTTON_SIZE.sm} bg-brand text-white hover:bg-brand-dark`;
export const btnSecondarySm = `${BASE} ${BUTTON_SIZE.sm} border border-brand/35 bg-white text-brand hover:bg-brand hover:text-white`;
export const btnDangerSm = `${BASE} ${BUTTON_SIZE.sm} bg-brand-dark text-white hover:bg-ink`;

/**
 * A control that has to sit inside a line of running text.
 *
 * The footer is one caption-sized line; a padded button in it would set the
 * line height on its own and undo the point of shrinking the footer. This is
 * still a token rather than inline classes, so the brand colour moves with the
 * theme like everything else.
 */
export const btnLink = "inline font-medium text-brand underline-offset-4 hover:underline disabled:opacity-60 disabled:pointer-events-none";

/**
 * The one control that is allowed to be white.
 *
 * Google's sign-in branding requires their own colours and their own mark, so
 * this is an exception granted by someone else's rules rather than a gap in
 * ours. It lives here so it is visible as a decision, not discovered later as
 * another stray white box.
 */
export const btnGoogle = `${BASE} w-full px-4 py-3 border border-black/15 bg-white text-ink hover:bg-black/[.04]`;
