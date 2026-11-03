import type { ReactNode } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, ButtonBase, Chip, Stack, Typography } from '@mui/material';
import { ArrowLeft, ChevronDown, ChevronRight, Database, MousePointer2, Sparkles, Volume2 } from 'lucide-react';

export type SettingsPage = 'general' | 'ai' | 'speech' | 'data';
export interface SettingsCategory {
  id: SettingsPage; title: string; description: string; summary: string;
  badge?: string; attention?: boolean;
}
const icons = { general: MousePointer2, ai: Sparkles, speech: Volume2, data: Database };

export function SettingsOverview({ categories, onOpen }: { categories: SettingsCategory[]; onOpen: (page: SettingsPage) => void }) {
  return <Stack spacing={2}>
    <Box>
      <Typography component="h2" id="settings-home-title" tabIndex={-1} sx={{ fontSize: 20, fontWeight: 650 }}>设置</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>按需调整，常规选项自动保存。</Typography>
    </Box>
    <Stack component="nav" aria-label="设置分类" spacing={1}>
      {categories.map((category) => {
        const Icon = icons[category.id];
        return <ButtonBase key={category.id} onClick={() => onOpen(category.id)} sx={{
          width: '100%', p: 1.75, textAlign: 'left', justifyContent: 'flex-start', border: 1,
          borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', gap: 1.5,
          '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.main' },
        }}>
          <Box sx={{ width: 36, height: 36, flexShrink: 0, bgcolor: 'action.selected', color: 'primary.main', borderRadius: 1.5, display: 'grid', placeItems: 'center' }}><Icon size={19} aria-hidden="true" /></Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" useFlexGap spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 0.5 }}>
              <Typography component="span" sx={{ fontSize: 14, fontWeight: 600 }}>{category.title}</Typography>
              {category.badge && <Chip size="small" variant="outlined" color={category.attention ? 'warning' : 'default'} label={category.badge} sx={{ height: 24, fontSize: 12 }} />}
            </Stack>
            <Typography variant="caption" component="div" color="text.secondary">{category.description}</Typography>
            <Typography variant="caption" component="div" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>{category.summary}</Typography>
          </Box>
          <ChevronRight size={17} aria-hidden="true" style={{ flexShrink: 0 }} />
        </ButtonBase>;
      })}
    </Stack>
    <Typography variant="caption" color="text.secondary">API Key 单独保存；数据与隐私中可查看备份和存储状态。</Typography>
  </Stack>;
}

export function SettingsHeader({ title, description, onBack }: { title: string; description: string; onBack: () => void }) {
  return <Stack spacing={1}>
    <Button size="small" startIcon={<ArrowLeft size={16} aria-hidden="true" />} sx={{ alignSelf: 'flex-start', ml: -1 }} onClick={onBack}>全部设置</Button>
    <Box>
      <Typography component="h2" tabIndex={-1} id="settings-detail-title" sx={{ fontSize: 20, fontWeight: 650, outline: 'none' }}>{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{description}</Typography>
    </Box>
  </Stack>;
}

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return <Box component="section" sx={{ p: 1.75, border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
    <Typography component="h3" variant="subtitle1" sx={{ mb: 1.5 }}>{title}</Typography>
    <Stack spacing={1.5}>{children}</Stack>
  </Box>;
}

export function SettingsDisclosure({ id, title, summary, expanded, onChange, children }: {
  id: string; title: string; summary?: string; expanded?: boolean; onChange?: (expanded: boolean) => void; children: ReactNode;
}) {
  return <Accordion variant="outlined" disableGutters expanded={expanded} onChange={onChange ? (_, value) => onChange(value) : undefined}
    slotProps={{ transition: { unmountOnExit: true } }} sx={{ borderRadius: '8px !important', '&::before': { display: 'none' } }}>
    <AccordionSummary id={`${id}-heading`} aria-controls={`${id}-content`} expandIcon={<ChevronDown size={17} aria-hidden="true" />} sx={{ minHeight: 56, px: 1.75 }}>
      <Box sx={{ minWidth: 0, pr: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{title}</Typography>
        {summary && <Typography variant="caption" component="div" color="text.secondary" sx={{ mt: 0.25 }}>{summary}</Typography>}
      </Box>
    </AccordionSummary>
    <AccordionDetails id={`${id}-content`} sx={{ px: 1.75, pt: 0, pb: 1.75 }}><Stack spacing={1.5}>{children}</Stack></AccordionDetails>
  </Accordion>;
}
