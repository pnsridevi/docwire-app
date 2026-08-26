// Palette matches DocWire_demo_V1.html's :root CSS variables exactly —
// see the demo's <style> block if these ever need re-verifying against it.

export const colors = {
  bg: '#F8F8F8',
  surface: '#FFFFFF',
  surface2: '#F1F1EF',
  border: '#D6D5D2',
  text: '#262524',
  textDim: '#68645C',
  textFaint: '#93908A',
  orange: '#E56515',
  orangeDeep: '#B84F12',
  tint: '#FEF1E5',
  grey: '#CDCDCB',
  danger: '#B23A1E',
  // Demo's sidebar colors — not currently used now that SideNav uses
  // surface/orange instead, kept here in case that changes later.
  sidebar: '#FBA45C',
  sidebarActive: '#E56515',
};

// Colors per document/task status, for the Pill component.
// Pulled directly from the demo's .status CSS rules (DocWire_demo_V1.html
// lines 81-88), not invented — e.g. .status.pending, .status.rework, etc.
// 'filed' has no demo precedent (it's a status this app added per
// Architecture Section 6.2, which the demo doesn't have) — mapped to the
// demo's other neutral/inactive treatment (.status.low / .status.onetime)
// since it's conceptually the same "nothing pending" state.
export function statusStyle(status: string): { background: string; color: string } {
  switch (status) {
    case 'reviewed':
    case 'completed':
    case 'accounted':
      return { background: colors.tint, color: '#8A4009' };
    case 'pending':
    case 'in_progress':
      return { background: colors.tint, color: colors.orangeDeep };
    case 'rework':
      return { background: '#FBE7E1', color: colors.danger };
    case 'filed':
    default:
      return { background: colors.surface2, color: colors.textDim };
  }
}