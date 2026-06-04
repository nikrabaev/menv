// Bun resolves `import x from "./file.md" with { type: "text" }` to the file's
// contents as a string (default export). This ambient declaration types such
// imports so the source stays `strict`; the import attribute is what actually
// selects the text loader at build/runtime.
declare module "*.md" {
  const content: string;
  export default content;
}
