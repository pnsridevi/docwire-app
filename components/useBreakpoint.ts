import { useWindowDimensions } from 'react-native';

// Single source of truth for responsive tiers.
//
// This replaces the old pairing in components/UI.tsx of useIsWide()
// (768px) and useGridColumns() (1024px) — two independently-tuned
// thresholds read off the same useWindowDimensions() value. That pairing
// is what created the tablet dead zone: at a width like 900px, isWide()
// had already flipped true (so SideNav + desktop chrome rendered) but
// useGridColumns() hadn't (so the grid still laid out as a single column),
// because nothing named the region between 768 and 1024 as its own tier —
// each hook just carried its own cutoff.
//
// Tiers, defined once:
//   phone   < 768    — BottomTabBar, single-column grid
//   tablet  768–1023 — SideNav (desktop chrome fits), still single-column
//                       grid (not enough width for two comfortable cards)
//   desktop >= 1024   — SideNav, two-column grid
export type Breakpoint = 'phone' | 'tablet' | 'desktop';

const TABLET_MIN = 768; // was WIDE_BREAKPOINT in components/UI.tsx
const DESKTOP_MIN = 1024; // was GRID_BREAKPOINT in components/UI.tsx

export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  if (width >= DESKTOP_MIN) return 'desktop';
  if (width >= TABLET_MIN) return 'tablet';
  return 'phone';
}

// --- Derived convenience values ---
// Both of these are computed FROM useBreakpoint() — there is no second
// independent width check anywhere now, so the two can't drift apart again.

// True for 'tablet' and 'desktop'. Replaces useIsWide(). Anything deciding
// SideNav-vs-BottomTabBar, or whether to center content to
// CONTENT_MAX_WIDTH, reads this.
export function useIsWide(): boolean {
  return useBreakpoint() !== 'phone';
}

// 1 on phone/tablet, 2 on desktop. Replaces useGridColumns(). Prefer
// <ResponsiveGrid> over calling this directly in a screen — it already
// does this internally, along with the padForGrid/spacer/remount handling
// every screen used to hand-roll.
export function useGridColumns(): 1 | 2 {
  return useBreakpoint() === 'desktop' ? 2 : 1;
}

export const CONTENT_MAX_WIDTH = 1250; // widened from the original 1080, then eased back slightly from 1400 — narrows the margin on wide screens without going as wide as edge-to-edge

// When a grid has an odd number of items, the last row's single card gets
// pushed to one side by `columnWrapperStyle: { justifyContent: 'space-between' }`,
// leaving a visible dead gap on the other side. Padding the data with an
// invisible spacer keeps the grid visually balanced. Returns null for
// spacer slots — <ResponsiveGrid> renders those as an empty, borderless
// view sized to match a real card.
//
// Moved here from components/UI.tsx (still re-exported there so nothing
// importing it from UI.tsx breaks) since it's grid/breakpoint logic, not a
// generic UI primitive. Screens migrated onto <ResponsiveGrid> won't need
// to call this themselves at all — it's called internally.
export function padForGrid<T>(data: T[], columns: number): (T | null)[] {
  if (columns < 2) return data;
  const remainder = data.length % columns;
  if (remainder === 0) return data;
  return [...data, ...Array(columns - remainder).fill(null)];
}