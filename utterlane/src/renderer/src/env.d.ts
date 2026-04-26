/// <reference types="vite/client" />

// Vite '?raw' suffix returns file contents as string. Used for importing
// markdown user-guide files into the dialog at build time.
declare module '*.md?raw' {
  const content: string
  export default content
}
