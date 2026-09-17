import React from "react";
import { createRoot } from "react-dom/client";
import { BaseGalleryView } from "../../src/components/base/BaseGalleryView";
import { MarkdownReader } from "../../src/components/MarkdownReader";
import { VaultContext } from "../../src/contexts/VaultContext";
import type { BaseCells } from "../../src/components/base/useBaseCells";
import { htmlToMarkdown } from "../../../../packages/core/src/pim/htmlToMarkdown";
import "../../../../packages/ui/src/i18n";

const root = createRoot(document.getElementById("host")!);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" onload="window.securityExecuted=true"><script>window.securityExecuted=true</script><rect width="20" height="20" fill="green"/></svg>';
const revoked: string[] = [];
const originalRevoke = URL.revokeObjectURL.bind(URL);
URL.revokeObjectURL = url => { revoked.push(url); originalRevoke(url); };
const files = {
  async readBinaryFile(path: string) {
    if (path !== "cover.svg") throw new Error("Synthetic missing image");
    return new TextEncoder().encode(svg);
  },
};
const values = [
  "javascript:window.securityExecuted=true",
  "data:text/html,<script>window.securityExecuted=true</script>",
  'https://example.invalid/image" onerror="window.securityExecuted=true',
  "data:image/svg+xml," + encodeURIComponent(svg),
  "cover.svg",
  "java\nscript:window.securityExecuted=true",
];
const cells = { columnLabel: (value: string) => value, formatValueForDisplay: () => ({ displayVal: "" }), renderEditableCell: () => null, getColumnSchema: () => null } as unknown as BaseCells;
function render(showImages = true) {
  root.render(<VaultContext.Provider value={{ vaultAdapter: files, queryService: null } as unknown as React.ContextType<typeof VaultContext>}>
    <BaseGalleryView dbData={showImages ? values.map((cover, i) => ({ "file.path": `note-${i}.md`, "file.name": `Card ${i}`, cover })) : []} visibleColumns={[]} coverImageProperty="cover" cells={cells} />
    <section id="converted"><MarkdownReader content={htmlToMarkdown('<p>&lt;img src=x onerror="window.securityExecuted=true"&gt;</p><a href="java&#x09;script:window.securityExecuted=true">Blocked</a>')} /></section>
    <section id="comment"><MarkdownReader content={'<!-- comment --!>\n<img src=x onerror="window.securityExecuted=true">\n-->\n\nVisible'} /></section>
  </VaultContext.Provider>);
}
export const securityRenderingProbe = { render, revoked };
export type SecurityRenderingWindow = Window & { securityRenderingProbe: typeof securityRenderingProbe; securityExecuted?: boolean };
(window as SecurityRenderingWindow).securityRenderingProbe = securityRenderingProbe;
