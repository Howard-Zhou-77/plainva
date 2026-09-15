/** Local service fixtures for the real mobile screens. No request is forwarded
 * to a provider, and every workspace uses newly generated, ephemeral keys. */
import { build } from "vite";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, dirname, join } from "node:path";

export async function workspaceFixtureStorage(vaultId) {
  const root = fileURLToPath(new URL("../../../packages/core", import.meta.url));
  const scratch = await mkdtemp(join(root, ".screenshot-runtime-"));
  if (dirname(scratch) !== root || !basename(scratch).startsWith(".screenshot-runtime-")) throw new Error("Invalid fixture scratch directory");
  try {
    await build({ configFile: false, root, logLevel: "error", build: {
      ssr: join(root, "src/index.ts"), outDir: scratch, emptyOutDir: false,
      rolldownOptions: { output: { format: "esm", entryFileNames: "runtime.mjs" } },
    } });
    const core = await import(pathToFileURL(join(scratch, "runtime.mjs")).href);
    const runtime = core.personalWorkspaceRuntime(await core.createPersonalWorkspaceBootstrap({
      ownerDisplayName: "Anna Beispiel", deviceDisplayName: "Pixel (Fixture)",
      platform: "android", minimumClientVersion: "0.8.2",
    }));
    const member = await core.inviteWorkspaceMember({ runtime, displayName: "Ben Beispiel", role: "Editor" });
    core.applyWorkspaceGovernanceUpdate(runtime, member);
    const group = await core.createWorkspaceGroup({ runtime, name: "Projektteam", memberIds: [runtime.memberId, member.memberId], role: "Editor" });
    core.applyWorkspaceGovernanceUpdate(runtime, group);
    const slice = core.createWorkspaceSlice({ runtime, name: "Team-Handbuch", definition: { kind: "folder", folder: "Team" }, materializedObjectIds: [] });
    runtime.policy = slice.policy;
    return {
      [`secret_workspace_runtime_mobile_${vaultId}`]: core.serializePersonalWorkspaceRuntime(runtime),
      [`workspace_status_mobile_${vaultId}`]: {
        version: 1, workspaceId: runtime.workspaceId,
        fingerprint: core.workspaceDocumentHash(runtime.genesis),
        deviceName: "Pixel (Fixture)", phase: "active", lastError: null,
      },
    };
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

const FOLDERS = [
  ["inbox", "Posteingang"], ["archive", "Archiv"], ["deleteditems", "Papierkorb"],
  ["drafts", "Entwürfe"], ["sentitems", "Gesendet"], ["junkemail", "Junk-E-Mail"],
].map(([id, displayName]) => ({ id, displayName, childFolderCount: 0, unreadItemCount: id === "inbox" ? 1 : 0 }));

const MESSAGES = [
  { id: "fixture-3", subject: "Projektübersicht", conversationId: "project", bodyPreview: "Die neue Übersicht ist fertig.", isRead: false, hasAttachments: true },
  { id: "fixture-2", subject: "Re: Projektübersicht", conversationId: "project", bodyPreview: "Danke, ich habe die Termine ergänzt.", isRead: true, hasAttachments: false },
  { id: "fixture-1", subject: "Newsletter September", conversationId: "newsletter", bodyPreview: "Unsere Nachrichten aus dem September.", isRead: true, hasAttachments: false },
].map((m, i) => ({ ...m, from: { emailAddress: { name: "Ben Beispiel", address: "ben@example.org" } },
  toRecipients: [{ emailAddress: { name: "Anna Beispiel", address: "anna@example.org" } }],
  receivedDateTime: `2026-09-14T0${9 - i}:00:00Z`, flag: { flagStatus: "notFlagged" },
  body: { contentType: "text", content: `${m.bodyPreview}\n\nDie Projektplanung liegt im gemeinsamen Vault.\n\nViele Grüße\nBen` },
}));

/** Install after the general external-request blocker: Playwright tries the
 * most recently registered matching route first. Unknown requests fail closed. */
export async function installMailFixture(context) {
  const messages = structuredClone(MESSAGES);
  const observed = { lists: 0, bodies: 0, tokenRefreshes: 0, unexpected: [] };
  await context.route("https://login.microsoftonline.com/**", async (route) => {
    if (!route.request().url().includes("/oauth2/v2.0/token")) return route.abort("blockedbyclient");
    observed.tokenRefreshes++;
    await route.fulfill({ json: { access_token: "local-fixture-only", refresh_token: "local-fixture-only", expires_in: 3600, token_type: "Bearer" } });
  });
  await context.route("https://graph.microsoft.com/**", async (route) => {
    const request = route.request(), url = new URL(request.url());
    const path = decodeURIComponent(url.pathname.replace(/^\/v1\.0/, ""));
    if (request.method() === "GET") {
      if (path === "/me") return route.fulfill({ json: { id: "fixture-anna", mail: "anna@example.org", userPrincipalName: "anna@example.org", displayName: "Anna Beispiel" } });
      if (path === "/me/mailFolders") return route.fulfill({ json: { value: FOLDERS } });
      const folder = /^\/me\/mailFolders\/([^/]+)$/.exec(path);
      if (folder) return route.fulfill({ json: FOLDERS.find(f => f.id === folder[1]) ?? { id: folder[1], unreadItemCount: 0 } });
      if (/^\/me\/mailFolders\/[^/]+\/messages$/.test(path)) {
        observed.lists++;
        return route.fulfill({ json: { value: path.includes("/inbox/") ? messages : [], "@odata.count": path.includes("/inbox/") ? messages.length : 0 } });
      }
      if (path.endsWith("/messageRules")) return route.fulfill({ json: { value: [] } });
      const message = /^\/me\/messages\/([^/]+)$/.exec(path);
      if (message) {
        const item = messages.find(m => m.id === message[1]);
        if (item) { observed.bodies++; return route.fulfill({ json: item }); }
      }
      if (path.endsWith("/attachments")) return route.fulfill({ json: { value: [{ id: "attachment-1", name: "Projektübersicht.txt", contentType: "text/plain", size: 36 }] } });
    }
    if (request.method() === "PATCH") {
      const item = messages.find(m => path === `/me/messages/${m.id}`);
      if (item) { Object.assign(item, request.postDataJSON()); return route.fulfill({ status: 204 }); }
    }
    observed.unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 501, json: { error: { message: "Unsupported local fixture request" } } });
  });
  return observed;
}
