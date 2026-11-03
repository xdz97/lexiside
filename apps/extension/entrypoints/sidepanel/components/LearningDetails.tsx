import { Box, Chip, Stack, Typography } from '@mui/material';

interface LearningDetailsProps {
  definitionEn?: string;
  meaningInContext?: string;
  collocations?: string[];
  usage?: string;
}

export function LearningDetails({
  definitionEn = '',
  meaningInContext = '',
  collocations = [],
  usage = '',
}: LearningDetailsProps) {
  return (
    <Stack spacing={1}>
      {definitionEn && (
        <Box>
          <Typography variant="caption" color="text.secondary">英文释义</Typography>
          <Typography lang="en" variant="body2" tabIndex={-1} data-lexi-lookup-text="definition" sx={{ userSelect: 'text' }}>{definitionEn}</Typography>
        </Box>
      )}
      {meaningInContext && (
        <Box>
          <Typography variant="caption" color="text.secondary">当前语境</Typography>
          <Typography variant="body2">{meaningInContext}</Typography>
        </Box>
      )}
      {collocations.length > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary">常见搭配</Typography>
          <Stack direction="row" sx={{ mt: 0.5, gap: 0.5, flexWrap: 'wrap' }}>
            {collocations.map((collocation) => (
              <Chip key={collocation} label={collocation} size="small" variant="outlined" tabIndex={-1} data-lexi-lookup-text="collocation" sx={{ userSelect: 'text', '& .MuiChip-label': { userSelect: 'text' } }} />
            ))}
          </Stack>
        </Box>
      )}
      {usage && (
        <Box>
          <Typography variant="caption" color="text.secondary">用法说明</Typography>
          <Typography variant="body2">{usage}</Typography>
        </Box>
      )}
    </Stack>
  );
}
