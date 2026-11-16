/**
 * Sizes of the panels in mm, with their eye distance, padding and the text box that
 * every line of the panel has to fit (DESIGN "Типографика", tokens PANEL). The panels
 * build from these numbers and tests/kit/ui/fit.test.ts checks every product string
 * against the same numbers, so the test and the drawing cannot disagree.
 *
 * Where the panel of DESIGN cannot hold its own lines at line height 1.35 (the run card
 * with the line under its button, the plan board with six lines), the panel grows down,
 * as DESIGN "Экраны и адаптивность" allows, and the growth is written here.
 */
import { LAYOUT, PANEL, TEXT } from '../../tokens/tokens';

const mm = (m: number): number => Math.round(m * 1000);

/** Eye distance of the card at the hand (−14°, 0.50 m, 6 cm over the slab). */
export const HAND_EYE = Math.round(Math.hypot(LAYOUT.handCard.dist, 0.32 - LAYOUT.handCard.y - 0.15) * 1000) / 1000;

export const SIZE = {
  board: {
    eye: PANEL.stationBoard.eyeDist,
    w: mm(PANEL.stationBoard.size.w),
    h: mm(PANEL.stationBoard.size.h),
    wLarge: mm(PANEL.stationBoard.large.w),
    hLarge: mm(PANEL.stationBoard.large.h),
    rim: 4,
    pad: 8,
    padLarge: 6.5,
    gap: 2.5,
    progress: 6,
    /** The plan board holds six lines and no counter: it grows 2 cm (2.8 cm in large text). */
    planGrow: mm(PANEL.stationPlan.size.h - PANEL.stationBoard.size.h),
    planGrowLarge: mm(PANEL.stationPlan.large.h - PANEL.stationBoard.large.h),
  },
  chip: { eye: PANEL.stationChip.eyeDist, w: mm(PANEL.stationChip.size.w), h: mm(PANEL.stationChip.size.h), pad: 6 },
  rail: { eye: PANEL.captionRail.eyeDist, w: mm(PANEL.captionRail.size.w), h: mm(PANEL.captionRail.size.h), hLarge: mm(PANEL.captionRail.large.h), padX: 10, padY: 5 },
  runCard: {
    eye: PANEL.runCard.eyeDist,
    w: mm(PANEL.runCard.size.w),
    pad: 6,
    gap: 4,
    /**
     * DESIGN gives 13 cm (14.5 in large text) for two lines and the buttons; the line
     * under "Run it live" adds a row, so the card is 15.6 cm (17.6 in large text).
     * The buttons are set in `read`, which keeps both in one row in large text too.
     */
    h: mm(PANEL.runCard.size.h),
    hLarge: mm(PANEL.runCard.large.h),
  },
  callCard: { eye: HAND_EYE, w: 260, h: 90, pad: 8 },
  askCard: { eye: PANEL.askCard.eyeDist, w: mm(PANEL.askCard.size.w), h: mm(PANEL.askCard.size.h), hLarge: mm(PANEL.askCard.large.h), pad: 10, strip: 6, bar: 4 },
  confirmCard: { eye: 0.55, w: 300, h: 120, pad: 10 },
  codeCard: { eye: PANEL.codeCard.eyeDist, w: mm(PANEL.codeCard.size.w), h: mm(PANEL.codeCard.size.h), pad: 8 },
  slipSheet: { eye: TEXT.HELD, w: mm(PANEL.slipSheet.size.w), h: mm(PANEL.slipSheet.size.h), hLarge: mm(PANEL.slipSheet.large.h), pad: 5 },
  workSheet: { eye: PANEL.workSheet.eyeDist, w: mm(PANEL.workSheet.size.w), h: mm(PANEL.workSheet.size.h), wLarge: mm(PANEL.workSheet.large.w), hLarge: mm(PANEL.workSheet.large.h), pad: 5 },
  sourcePage: { eye: PANEL.sourcePage.eyeDist, w: mm(PANEL.sourcePage.size.w), h: mm(PANEL.sourcePage.size.h), pad: 10, nav: 54 },
  reading: { eye: PANEL.readingLine.eyeDist, w: mm(PANEL.readingLine.size.w), h: mm(PANEL.readingLine.size.h), hLarge: mm(PANEL.readingLine.large.h), pad: 8 },
  note: { eye: 0.45, w: 180, pad: 10 },
  pair: { eye: 0.6, w: 380, pad: 10 },
  table: { eye: 0.5, w: 170, row: 30, pad: 8 },
  wish: { eye: 0.55, w: 300, pad: 8 },
  settings: { eye: 0.55, w: 280, pad: 10 },
  pad: { eye: 0.5, key: 44, gap: 4, pad: 10 },
  essay: { eye: PANEL.sourcePage.eyeDist, w: mm(PANEL.sourcePage.size.w), h: mm(PANEL.sourcePage.size.h), pad: 10, nav: 54 },
  bars: { eye: 0.65, w: 260, pad: 10 },
  rules: { eye: 0.6, w: 300, pad: 10 },
  classErrors: { eye: 0.6, w: 360, pad: 10 },
} as const;
