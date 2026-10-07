import type { ButtonProps, ElementConstructor, ElementTable, InputProps, RenderChildren } from 'claude-code'

import { bar, tone } from '../layout'

// The elements a view draws with, from the surface's own table. A view takes them, plain data and handlers built in
// register.tsx, and never `$`: the engine doesn't follow `$` across an import.
export type Elements = Pick<ElementTable, 'Box' | 'Text' | 'Button' | 'Link'>

// The pane's elements: those, Markdown, and the text field where the surface draws one.
export type PaneElements = Elements & Pick<ElementTable, 'Markdown'> & { Input?: ElementConstructor<InputProps> }

// The small pieces the pane's and the band's rows are built from, made with the surface's own elements.
export const partsOf = ({ Box, Text, Button, Link }: Elements) => ({
  // A link in a row stays on one line: squeezed, it ends in an ellipsis rather than breaking down the pane a letter a
  // line. A click still opens the whole address.
  link: (href: string, label = '↗ GitHub') => (
    <Text wrap="truncate-end">
      <Link href={href} label={label} />
    </Text>
  ),
  // A part of a one-line row that keeps its width: a number, a badge, a count or a button. A row short of room
  // squeezes only the part left to shrink, which cuts its text, rather than breaking `#252` into `#25` over `2`.
  keep: (part: RenderChildren) => <Box flexShrink={0}>{part}</Box>,
  // One option of a set, the chosen one drawn as the primary and the others dim. `extra` carries a tab's hotkey.
  choice: (key: string, label: string, chosen: boolean, onPress: ButtonProps['onPress'], extra: Pick<ButtonProps, 'hotkey'> = {}) => (
    <Button key={key} {...extra} variant={chosen ? 'primary' : undefined} dimColor={!chosen} onPress={onPress}>
      {label}
    </Button>
  ),
  // A bar `cells` wide, filled as far as `done` is along `total`, in the tone of how far that is.
  meter: (done: number, total: number, cells: number) => {
    const [filled, empty] = bar({ done, total }, cells)
    return (
      <Text>
        <Text color={tone({ done, total })}>{filled}</Text>
        <Text color="inactive" dimColor>
          {empty}
        </Text>
      </Text>
    )
  },
})
