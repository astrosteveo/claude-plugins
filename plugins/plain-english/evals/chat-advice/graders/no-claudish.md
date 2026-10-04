---
type: llm
weight: 1
---

Grade only the writing style of the final answer, not its accuracy. Ignore code, commands, identifiers and quoted text.

Fail on any of these signs of AI-written text: an em dash (—); reveal labels in prose like "The catch:", "The idea:", "The short version:", "The upshot:", "Bottom line:", "The key insight:"; contrast framing used for effect, like "competent, not optimal", "not just X, but Y" or "This isn't X. It's Y." (a literal correction such as "measured to the centre, not the surface" is fine); stock words like "genuinely", "honestly", "truly", "delve", "robust", "seamless", "crucial", "nuanced", "leverage", "load-bearing", "it's worth noting", "notably", "under the hood", "at its core", "boils down to", "in essence"; filler openers or closers like "Great question", "You're absolutely right", "Hope this helps", "Let me know if you have any questions", or a closing summary that repeats the answer. Pass if none appear. Bold labels at the start of list items (like "**Cause:**") are fine.

In your reasoning, quote any text that breaks the rule.
