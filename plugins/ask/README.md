# Ask

Ask Claude a side question without adding it to the chat.

Type a question in the Ask pane, or run `/ask <question>`. Claude answers in
the background, in the pane. The main conversation never sees the question
or the answer, so it doesn't fill up the context.

The answer comes from a fork of the session. The fork reads the whole
conversation, so Claude knows what you are working on. The prompt cache serves
that history, so a question costs little. If the session has no reply yet,
the question goes to a plain Sonnet call instead.

## Use it

- `/ask` opens the pane with the cursor in the question box.
- `/ask <question>` sends the question and opens the pane. You can keep
  working while Claude thinks. A toast tells you when the answer is ready.
- **Suggest next prompts** asks Claude for three prompts you could send next.
- When Claude suggests prompts, each one gets a **Use** button. It puts that
  prompt in the prompt box, ready to edit or send.
- **Copy** copies an answer. **Remove** drops one. **Retry** runs a failed one
  again. **Clear answered** keeps only the questions still running.

The status line shows how many questions are still running.

## Notes

- The fork can't use tools. It answers from the conversation alone.
- A question typed in the pane leaves no trace in the chat. The `/ask`
  command prints nothing, but Claude Code may still log the command line
  itself, as it does for other commands.
- The pane keeps the last 30 questions for the session.
