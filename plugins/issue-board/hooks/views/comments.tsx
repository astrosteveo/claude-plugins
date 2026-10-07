import type { Comment, Issue, TypedText } from '../../types'
import { agoText } from '../layout'
import type { PaneElements } from './parts'

export type CommentsData = {
  issue: Issue
  // The open card's comments as last read; null before any.
  talk: { number: number; comments: Comment[] | null; total: number } | null
  // What the card's text fields hold.
  fields: TypedText
  clock: number
}

export type CommentsHandlers = {
  // Keeps what a text field of the card holds, by its name.
  type: (key: string, text: string) => unknown
  // Posts a reply, then reads the comments again.
  reply: (number: number, text: string) => unknown
  // Hands Claude the last comment with how to reply.
  ask: (issue: Issue, last: Comment) => unknown
}

// The card's comments: the latest few, a field to reply in, and Ask Claude to answer, which hands Claude the last
// comment with how to reply. A reply posted here reads the comments again.
export const conversation = ({ Box, Text, Button, Markdown, Input }: PaneElements, data: CommentsData, handlers: CommentsHandlers) => {
  const { issue, fields, clock } = data
  const n = issue.number
  const mine = data.talk?.number === n ? data.talk : null
  const comments = mine?.comments
  const last = comments?.at(-1)
  const reply = (text: string) => {
    if (!text.trim()) return
    void handlers.reply(n, text)
  }
  return (
    <Box key={`talk-${n}`} flexDirection="column" marginTop={1}>
      <Text bold>
        {comments === undefined || comments === null
          ? 'Comments'
          : mine && mine.total > comments.length
            ? `Comments · latest ${comments.length} of ${mine.total}`
            : `Comments · ${comments.length}`}
      </Text>
      {(comments === undefined || comments === null) && <Text dimColor>◌ reading…</Text>}
      {comments?.length === 0 && <Text dimColor>None yet.</Text>}
      {comments?.map((comment, index) => (
        <Box key={`comment-${n}-${index}`} flexDirection="column" marginTop={index > 0 ? 1 : 0}>
          <Text>
            <Text color="suggestion">{`@${comment.author}`}</Text>
            <Text dimColor>{agoText(comment.at, clock) ? ` · ${agoText(comment.at, clock)}` : ''}</Text>
          </Text>
          <Markdown text={comment.body.length > 800 ? `${comment.body.slice(0, 799)}…` : comment.body || '(empty)'} />
        </Box>
      ))}
      <Box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
        {Input && (
          <Input
            key={`reply-${n}`}
            label="reply "
            placeholder="write a comment, Enter posts it"
            value={fields.comment ?? ''}
            submitLabel="post"
            onInput={text => void handlers.type('comment', text)}
            onSubmit={reply}
          />
        )}
        {last && (
          <Button key={`ask-${n}`} dimColor onPress={() => void handlers.ask(issue, last)}>
            Ask Claude to answer
          </Button>
        )}
      </Box>
    </Box>
  )
}
