export const colors = {
  background: '#F6F5F2',
  navy: '#202C46',
  brand: '#526B8A',
  peach: '#F1D9CE',
  lavender: '#E9E7F1',
  white: '#FFFFFF',
  muted: '#687083',
  border: '#E3E1DC',
};
// Shared with the staff portal's report palette.
export function reportStatusTone(status: string) {
  const value = status.toLowerCase().replace(/_/g, ' ');
  if (value.includes('resolved')) return { text: '#216E71', background: '#DFF3F2' };
  if (value.includes('rejected')) return { text: '#A13832', background: '#F9E7E5' };
  if (value.includes('approved')) return { text: '#315F91', background: '#E7EFF9' };
  if (value.includes('in progress')) return { text: '#6D5685', background: '#EEE8F4' };
  return { text: '#8A5912', background: '#FFF1DA' };
}
