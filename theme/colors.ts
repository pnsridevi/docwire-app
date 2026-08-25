export const colors = {
  bg: '#F8F8F8',
  surface: '#FFFFFF',
  surface2: '#F1F1EF',
  border: '#D6D5D2',
  sidebar: '#FBA45C',
  text: '#262524',
  textDim: '#68645C',
  textFaint: '#93908A',
  orange: '#E56515',
  orangeDeep: '#B84F12',
  tint: '#FEF1E5',
  danger: '#B23A1E',
};

export function statusStyle(status: string) {
  if (status === 'pending') return { color: colors.orangeDeep, background: colors.tint };
  if (status === 'accounted') return { color: '#8A4009', background: colors.tint };
  if (status === 'reviewed') return { color: '#8A4009', background: colors.tint };
  if (status === 'rework') return { color: colors.danger, background: '#FBE7E1' };
  return { color: colors.textDim, background: colors.surface2 };
}
