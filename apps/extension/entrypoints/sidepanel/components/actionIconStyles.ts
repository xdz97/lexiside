export const actionIconSx = {
  border: 1,
  borderColor: 'primary.main',
  bgcolor: 'action.selected',
  color: 'primary.main',
  '&:hover': { bgcolor: 'action.selected' },
} as const;

export const quietActionIconSx = {
  border: 1,
  borderColor: 'divider',
  bgcolor: 'background.paper',
  color: 'text.secondary',
  '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
} as const;
