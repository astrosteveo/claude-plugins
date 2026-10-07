import type { ElementConstructor, InputProps } from 'claude-code'

import type { GroupBy } from '../../types'
import type { Tab } from '../filters'
import type { Elements } from './parts'
import { partsOf } from './parts'

// The heading's elements: the search field is there only where the surface draws one.
export type TabsElements = Elements & { Input?: ElementConstructor<InputProps> }

export type TabsData = {
  // Each tab with its label: its name and how many open issues it holds.
  tabs: { tab: Tab; label: string }[]
  // The tab shown.
  shown: string
  // What the search field holds.
  typed: string
  groupings: { id: GroupBy; label: string }[]
  grouping: GroupBy
}

export type TabsHandlers = {
  pickTab: (tab: Tab) => unknown
  search: (text: string) => unknown
  group: (id: GroupBy) => unknown
}

// The Issues heading: its filters, the search and the grouping, which act on the issues below it alone. With a
// project the first two filters read Priority, and the grouping can be Status.
export const issuesHeading = (elements: TabsElements, data: TabsData, handlers: TabsHandlers) => {
  const { Box, Text, Input } = elements
  const { choice } = partsOf(elements)
  return (
    <Box flexDirection="row" gap={1} flexWrap="wrap">
      <Text bold color="claude">
        Issues
      </Text>
      {data.tabs.map(({ tab, label }) => choice(`filter-${tab.id}`, label, tab.id === data.shown, () => void handlers.pickTab(tab), { hotkey: tab.hotkey }))}
      {Input && (
        <Input
          key="search"
          label="⌕ "
          placeholder="search titles, #numbers, labels"
          value={data.typed}
          submitLabel="search"
          onInput={text => void handlers.search(text)}
          onSubmit={text => void handlers.search(text)}
        />
      )}
      <Text dimColor>by</Text>
      {data.groupings.map(one => choice(`group-${one.id}`, one.label, one.id === data.grouping, () => void handlers.group(one.id)))}
    </Box>
  )
}
