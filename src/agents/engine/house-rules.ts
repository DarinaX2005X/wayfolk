/**
 * The house rules of every deliverable: what separates work a strong studio would hand over
 * from tidy generated work. One block per deliverable kind goes into the prompt of every
 * step that writes it (write-code, write-section, make-plan) and of the review that reads
 * it. What code can read in the result is also checked by code (checks/code/house.ts for
 * pages, checks/prose.ts for text, plan items in steps.ts) and sent back like any other
 * failed check.
 */
import type { DeliverableKind } from '../types';

const WEB = `House rules for pages and apps (code checks the ones marked *):
- Start from this subject's own object: for a bakery its loaves, counter and the day's bake; for a habit app the grid of days being ticked; for a plan the timeline. Draw it with inline SVG or CSS and give it the largest share of the first screen. If the page would still work for another business after swapping the name, it has no idea yet.
- One dominant element per screen, one supporting group, the rest quiet. Strong contrast of scale: display type 56 to 120 px, heavy (600 to 800) and tight (letter-spacing about -0.02em, line-height near 1), beside 16 to 18 px body text with line-height 1.5 and lines under 70 characters.
- Sections differ in shape and density because their content differs: an airy opening, a dense list, one large statement, a structured block. Not every section in the same card; cards only for distinct objects. Give the background a material or a field of colour from the subject instead of one flat fill everywhere.
- Type: one sans with character from the system stack (for example "Avenir Next", "Segoe UI Variable Display", "Helvetica Neue", system-ui, sans-serif), tuned weight and tracking, tabular figures for prices and numbers. *No serif display or editorial look, *no Playfair Display, Instrument Serif or Space Grotesk, no monospace for ordinary labels.
- Colour from the subject and its mood: one signature hue that will be remembered, neutrals tinted toward it (not pure white, black or flat grey), the accent kept for the main action and the result. No AI purple or blue-purple gradients, no neon glow, *no gradient text.
- *Every link and button has designed hover, press (:active) and visible :focus-visible states. Buttons are named by their action with a verb ("Call to order a cake", "Add habit").
- *A real phone layout at 390 px with a media query: recomposed, the main object still large, the action within reach. *A viewport meta tag.
- Copy: plain complete sentences in the subject's own words. *No eyebrow or kicker label above a heading (no small uppercase line over the title), *no full stop at the end of a heading, *no dashes as prose punctuation (rewrite the sentence; ranges like 7:00 to 3:00 are fine), *no exclamation marks, no hype words (magic, seamless, effortless, revolutionary), no subtitle under every heading.
- *No emojis as icons, no invented reviews, testimonials, customers, logos, ratings or numbers; only facts from the goal and the materials.
- Decoration must mean something: no dotted leader lines, decorative left stripes, numbered eyebrows or ornament for its own sake.`;

const DOCUMENT = `House rules for writing (code checks the ones marked *):
- Plain complete sentences with concrete actors, objects and numbers, the way a person explains it out loud.
- *No "it's not X, it's Y" or "not just X but Y" formulas, no chopped two- or three-word fragments in a row, no metaphors nobody says aloud.
- *No hype words (magic, seamless, effortless, revolutionary, game-changing, unlock, supercharge), no unsupported superlatives.
- *Headings without a final full stop, *no exclamation marks, *no dashes as prose punctuation (rewrite the sentence instead).
- No filler: every sentence carries a fact, a reason or a consequence.`;

const PLAN = `House rules for plans (code checks the ones marked *):
- *Every item has one owner from the team, a start and an end date, and a done-when: one sentence that says how anyone can tell it is finished.
- Items are concrete work with a visible result ("Send the launch newsletter to the waiting list"), not filler like "Kick-off", "Sync" or "Follow up" without an object.
- Dependencies follow the real order of the work; money only where the goal or materials give amounts.
- *Task names have no exclamation marks and no hype words.`;

export const HOUSE_RULES: Record<DeliverableKind, string> = { site: WEB, document: DOCUMENT, plan: PLAN };

export function houseRules(kind: DeliverableKind): string {
  return HOUSE_RULES[kind];
}
