/** A narrow desktop bridge. Sequence processing is identical in both runtimes. */
export const FILE_LIMIT = 50 * 1024 * 1024;
export const OPEN_FILTERS = [
  {
    name: "DNA, proteins, plasmids, and Sanger traces",
    extensions: [
      "pcraft",
      "pcprotein",
      "faa",
      "pep",
      "gb",
      "gbk",
      "genbank",
      "fa",
      "fasta",
      "fna",
      "dna",
      "ab1",
      "txt",
    ],
  },
];

export function createPlatform(host = globalThis) {
  const desktop = Boolean(host.__TAURI_INTERNALS__ || host.__TAURI__);
  const api = () => {
    const tauri = host.__TAURI__;
    if (!tauri?.dialog || !tauri?.fs || !tauri?.window) {
      throw new Error(
        "The desktop bridge is unavailable. Rebuild PlasmidCraft with its native plugins.",
      );
    }
    return tauri;
  };

  async function pickFiles({ filters = OPEN_FILTERS, multiple = true } = {}) {
    if (!desktop) return null;
    const tauri = api();
    const picked = await tauri.dialog.open({
      multiple,
      directory: false,
      filters,
    });
    if (!picked) return [];
    const files = [];
    for (const sourcePath of Array.isArray(picked) ? picked : [picked]) {
      const name = sourcePath.split(/[\\/]/).at(-1);
      try {
        const metadata = await tauri.fs.stat(sourcePath);
        if (metadata.size > FILE_LIMIT)
          throw new Error("The maximum file size is 50 MB.");
        const bytes = await tauri.fs.readFile(sourcePath);
        if (bytes.byteLength > FILE_LIMIT)
          throw new Error("The maximum file size is 50 MB.");
        files.push({
          name,
          sourcePath,
          size: bytes.byteLength,
          arrayBuffer: async () =>
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ),
        });
      } catch (error) {
        files.push({ name, sourcePath, error: String(error.message || error) });
      }
    }
    return files;
  }

  async function saveFile(
    filename,
    text,
    {
      type = "text/plain",
      extensions = [filename.split(".").at(-1)],
      currentPath = null,
    } = {},
  ) {
    if (desktop) {
      const tauri = api();
      const target =
        currentPath ||
        (await tauri.dialog.save({
          defaultPath: filename,
          filters: [{ name: "PlasmidCraft export", extensions }],
        }));
      if (!target) return { saved: false, path: null };
      const bytes =
        typeof text === "string"
          ? new TextEncoder().encode(text)
          : text instanceof Uint8Array
            ? text
            : text instanceof ArrayBuffer
              ? new Uint8Array(text)
              : null;
      if (!bytes) throw new Error("Export data must be text or binary bytes.");
      if (bytes.length > FILE_LIMIT)
        throw new Error("The document exceeds the 50 MB file limit.");
      const invoke = tauri.core?.invoke;
      if (!invoke)
        throw new Error(
          "The native save service is unavailable. Open the latest PlasmidCraft app.",
        );
      const encodedPath = btoa(
        Array.from(new TextEncoder().encode(target), (b) =>
          String.fromCharCode(b),
        ).join(""),
      );
      await invoke("save_file_atomic", bytes, {
        headers: { "x-plasmidcraft-path": encodedPath },
      });
      return { saved: true, path: target };
    }
    const url = host.URL.createObjectURL(new host.Blob([text], { type }));
    const link = host.document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    host.setTimeout(() => host.URL.revokeObjectURL(url), 1000);
    return { saved: true, path: null };
  }

  async function confirmDiscard(message) {
    if (!desktop) return host.confirm(message);
    return api().dialog.confirm(message, {
      title: "Unsaved changes",
      kind: "warning",
      okLabel: "Discard Changes",
      cancelLabel: "Keep Editing",
    });
  }

  async function copyText(text) {
    if (!desktop) return host.navigator.clipboard.writeText(text);
    const clipboard = host.__TAURI__?.clipboardManager;
    if (!clipboard) throw new Error("Native clipboard support is unavailable.");
    return clipboard.writeText(text);
  }

  async function setTitle(title) {
    if (desktop) await api().window.getCurrentWindow().setTitle(title);
  }

  async function install({ hasUnsavedChanges, onMenu, onError = () => {} }) {
    if (!desktop) return () => {};
    const tauri = api(),
      window = tauri.window.getCurrentWindow();
    let closing = false;
    const unlistenClose = await window.onCloseRequested(async (event) => {
      if (!hasUnsavedChanges()) return;
      event.preventDefault();
      if (closing) return;
      closing = true;
      try {
        if (
          await confirmDiscard(
            "Save your PlasmidCraft documents and export any unsaved workspace libraries before quitting. Discard unsaved changes?",
          )
        ) {
          await window.destroy();
        }
      } catch (error) {
        onError(error);
      } finally {
        closing = false;
      }
    });
    const unlistenMenu = await tauri.event.listen(
      "plasmidcraft-menu",
      (event) => onMenu(event.payload),
    );
    return () => {
      unlistenClose();
      unlistenMenu();
    };
  }

  async function closeWindow() {
    if (desktop) await api().window.getCurrentWindow().close();
  }
  async function aiInvoke(command, args = {}) {
    if (!desktop)
      throw new Error(
        "AI connections require the current PlasmidCraft desktop app.",
      );
    const invoke = host.__TAURI__?.core?.invoke;
    if (!invoke)
      throw new Error(
        "The AI desktop bridge is unavailable. Open the latest preview app.",
      );
    return invoke(command, args);
  }
  return {
    desktop,
    pickFiles,
    saveFile,
    confirmDiscard,
    copyText,
    setTitle,
    install,
    closeWindow,
    blastSubmit: (query) => aiInvoke("blast_submit", { query }),
    blastOpenResults: (rid) => aiInvoke("blast_open_results", { rid }),
    aiConnect: (connection, { remember = true, model = "" } = {}) =>
      aiInvoke("ai_connect", { connection, remember, model }),
    aiListModels: (connection = null) =>
      aiInvoke("ai_list_models", { connection }),
    aiRestoreSaved: () => aiInvoke("ai_restore_saved"),
    aiForgetSaved: () => aiInvoke("ai_forget_saved"),
    aiDisconnect: () => aiInvoke("ai_disconnect"),
    aiCancel: () => aiInvoke("ai_cancel"),
    aiRequest: (request) => aiInvoke("ai_request", request),
    chatGPTStatus: () => aiInvoke("chatgpt_status"),
    chatGPTRestore: () => aiInvoke("chatgpt_restore"),
    chatGPTSignIn: (registrationId) =>
      aiInvoke("chatgpt_sign_in", { registrationId: registrationId || null }),
    chatGPTCancel: () => aiInvoke("chatgpt_cancel"),
    chatGPTActivate: (registrationId) =>
      aiInvoke("chatgpt_activate", { registrationId }),
    chatGPTModels: (registrationId) =>
      aiInvoke("chatgpt_models", { registrationId }),
    chatGPTSignOut: (registrationId) =>
      aiInvoke("chatgpt_sign_out", { registrationId }),
    aiOpenSite: async (site) => {
      if (desktop) return aiInvoke("ai_open_site", { site });
      const sites = {
        chatgpt: "https://chatgpt.com/",
        codex: "https://chatgpt.com/codex",
        claude: "https://claude.ai/",
        gemini: "https://gemini.google.com/",
        "dashboard-openai": "https://platform.openai.com/api-keys",
        "dashboard-anthropic": "https://platform.claude.com/settings/keys",
        "dashboard-gemini": "https://aistudio.google.com/api-keys",
      };
      if (!Object.hasOwn(sites, site)) throw new Error("Unknown AI website.");
      host.open(sites[site], "_blank", "noopener,noreferrer");
    },
  };
}
