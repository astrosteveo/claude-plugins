# Ask

Ask Claude a side question without adding it to the chat. And when Claude
asks you something, see which option Claude would pick, and why.

Type a question in the Ask pane, or run `/ask <question>`. Claude answers in
the background, in the pane. The main conversation never sees the question
or the answer, so it doesn't fill up the context.

The answer comes from a fork of the session. The fork reads the whole
conversation, so Claude knows what you are working on. The prompt cache serves
that history, so a question costs little. If the session has no reply yet,
the question goes to a plain Sonnet call instead.

The main conversation never sees the pane, so each question also brings the
last three answered questions from the pane with it. A follow-up like "any
others?" then knows what Claude already said. Long answers are cut short so
this stays small.

## Use it

The pane reads like a chat. The question box sits at the bottom, with the
**Suggest next prompts** and **Clear answered** buttons under it. Questions
stack above it, oldest first, so the newest is just above the box. When you
ask or an answer comes in, the pane scrolls to the bottom so the box stays in
view.

- `/ask` opens the pane with the cursor in the question box.
- `/ask <question>` sends the question and opens the pane. You can keep
  working while Claude thinks. A toast tells you when the answer is ready.
- **Suggest next prompts** asks Claude for three prompts you could send next.
- When Claude suggests prompts, each one gets a **Use** button. It puts that
  prompt in the prompt box, ready to edit or send. When there are too many
  buttons for one line, they wrap onto the next.
- **Copy** copies an answer. **Remove** drops one. **Retry** runs a failed one
  again. **Clear answered** keeps only the questions still running.

The status line shows how many questions are still running.

## When Claude asks you

When Claude asks a question with options (the AskUserQuestion dialog), this
plugin adds three things.

### Claude's take

While the dialog is open, a fork of the session works out which option Claude
would pick. A box above the dialog shows the pick, a confidence meter, and a
short reason. The option descriptions get `★ Claude's pick (N%)` and an "In
plain words" note. The option labels never change, because the label is the
answer Claude gets back.

The box above the dialog has little room, so the fork is asked for short
reasons. With one or two questions they fit whole. With more, each pick comes
first and the reasons are cut at a word to fit.

### Remembered answers

After you answer, the band above the prompt offers **Remember** or **Not
now**. Remember means the same question in the same project is answered for
you next time, with a toast saying so. The same question means the same text
and options, ignoring case and spacing.

### The decision log

`/decisions` opens a pane with the answers Claude reuses and the log of your
answers in this project.

- The log marks where you went against Claude's pick.
- The search box at the top filters the log and the remembered answers. Every
  word you type must appear in the question, the answer or the header.
- Under the log's title, a line says how often you went with Claude's pick:
  over the whole log, and over the last 20 answers once there are more. A
  second line splits it by week, for the last four weeks with answers.
  Answers given from memory had no pick, so they don't count.
- **Forget** next to a remembered answer means you are asked again.
- **Copy as Markdown** puts the project's log on the clipboard as markdown.
- **Clear log** drops this project's log.

The log and the remembered answers live in the plugin's own store, shared by
every session. Nothing is written into the project. Each write reads the
store first and changes only its own entries, so two sessions open at once
don't erase each other's answers. The log keeps the last 300 answers.

## Notes

- The fork can't use tools. It answers from the conversation alone. This is
  true of the side questions and of Claude's take.
- A question typed in the pane leaves no trace in the chat. The `/ask`
  command prints nothing, but Claude Code may still log the command line
  itself, as it does for other commands.
- The pane keeps the last 30 questions for the session.
