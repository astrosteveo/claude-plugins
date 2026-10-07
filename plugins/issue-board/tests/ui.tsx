import type { On } from 'claude-code'

// What the tests mount and run, the same in every file: the pane and the band at a size, the /issues command, the
// system prompt's request, and the folder the session is in.

export const pane = (bodyColumns: number, bodyRows: number) =>
  ({ component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows }, view: {} } }) as const

export const band = (bodyColumns: number, maxRows = 10) =>
  ({ component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows, bodyColumns, scroll: { offset: 0, bodyRows: maxRows }, view: {} } }) as const

export const HINT = { component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } } as const

// /issues as typed in the prompt box, and /issues refresh.
export const RUN = { command: 'issues', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
export const REFRESH = { ...RUN, args: 'refresh' } as const

// A request for the system prompt, as the engine sends it before each turn.
export const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as const

// The folder the session is in, as `session.repo` answers it.
export const REPO = { root: '/work/void-sector', remote: null, internal: false, name: null }

// What the engine draws in the band when no plugin has anything to say, so a test can tell the board drew nothing.
export const engineBand = (on: On): void => {
  on('ui.render', { component: 'AbovePrompt' }, async ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box key="engine" />
  })
}

// What the engine draws under the prompt: its hint, then ` · ` and the tail the plugins added.
export const engineHint = (on: On): void => {
  on('ui.render', { component: 'PromptHint' }, async ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{e.props.tail ? `${e.props.hint} · ${e.props.tail}` : e.props.hint}</Text>
  })
}
