export type FileTreeChange = {
  status: 'added' | 'modified'
  // Unified-diff hunks, oldest first, trimmed to fit one Code element
  hunks: string[]
  edits: number
}

export type FileTreeEntry = { name: string; isDir: boolean }

declare module 'claude-code' {
  interface PluginState {
    'file-tree': {
      // The project folder, fixed at session start so a later cd moves nothing
      root: string
      // Keyed by path relative to the project root, or absolute when outside it
      changes: Record<string, FileTreeChange>
      // Relative directory paths that are open; '' is the root
      expanded: string[]
      listings: Record<string, FileTreeEntry[]>
      // The file being viewed; '' shows the tree
      selected: string
      view: 'diff' | 'file'
      isChangedOnly: boolean
      isAutoOpened: boolean
    }
  }
}
