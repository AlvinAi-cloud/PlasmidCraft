import {
  showFloatingDialog,
  prepareFloatingDialogHeader,
} from "./floating-dialog.mjs";
import {
  AI_PROVIDERS,
  AI_WORKFLOWS,
  AI_SYSTEM,
  aiContext,
  aiPrompt,
  aiResponseText,
  aiProposal,
} from "./ai.mjs";
import { recordToken } from "./workflow-common.mjs";
import { parseProject, serializeProject } from "./project.mjs";
import {
  CONNECTED_SYSTEM,
  ConnectedWorkspace,
  connectedReply,
} from "./ai-tools.mjs";
import { CODON_USAGE } from "./codon-usage.mjs";
const $ = (s) => document.querySelector(s),
  e = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const button = (label, action, extra = "") =>
  `<button class="button" data-ai="${action}" ${extra}>${label}</button>`;
function preferenceEndpoint(provider, value) {
  const fallback =
    AI_PROVIDERS.find((p) => p.id === provider)?.endpoint ||
    AI_PROVIDERS[0].endpoint;
  if (
    provider !== "compatible" ||
    typeof value !== "string" ||
    value.length > 2048
  )
    return fallback;
  try {
    const url = new URL(value);
    if (
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    )
      return value;
  } catch {}
  return fallback;
}
const tasks = {
  review:
    "Review this plasmid architecture. Flag uncertain annotations and suggest checks.",
  design:
    "Help me design a plasmid. Ask about its purpose, host organism, backbone, inserts, expression requirements and cloning method, then propose a design and checks for review.",
  gibson:
    "Help plan a Gibson assembly. Identify required fragments, overlaps and PCR checks. Open the Gibson designer for validated simulation.",
  golden:
    "Help plan Golden Gate cloning. Check Type IIS sites and overhang requirements. Open the Golden Gate designer.",
  primers:
    "Propose PCR primers for the selected region if DNA is included. Explain binding specificity and checks needed.",
  annotation:
    "Suggest annotations supported by this sequence. Distinguish hypotheses from known features; open the feature library matcher.",
  codons:
    "Help plan single-host or dual-host codon optimization. Ask which organisms and open the codon tool; preserve the protein.",
  other:
    "Help me with another task. Ask what I want to accomplish and which sequence or workflow is relevant.",
};
export class AiUI {
  constructor(api) {
    this.api = api;
    this.open = false;
    this.view = "conversation";
    this.settingsOpen = false;
    this.remember = true;
    this.savedConnection = false;
    this.sessionDisconnected = false;
    this.restoring = false;
    this.connectionNotice = "";
    this.messages = [];
    this.operations = [];
    this.resultDocuments = [];
    this.toolOutputs = [];
    this.attachedIds = new Set();
    this.historyStore = "plasmidcraft.ai.conversations.v1";
    this.historyDocId = null;
    this.historyKey = null;
    this.historyEpoch = 0;
    this.includeHistory = false;
    this.connectedHistory = true;
    this.connectedIncludeDna = true;
    this.accountId = "";
    this.provider = "openai";
    this.endpoint = AI_PROVIDERS[0].endpoint;
    this.model = "";
    try {
      const saved = JSON.parse(
        localStorage.getItem("plasmidcraft.ai.preferences") || "null",
      );
      if (saved && AI_PROVIDERS.some((p) => p.id === saved.provider)) {
        this.connectedIncludeDna = saved.connectedIncludeDna !== false;
        this.accountId =
          typeof saved.accountId === "string"
            ? saved.accountId.slice(0, 256)
            : "";
        this.provider = saved.provider;
        this.endpoint = preferenceEndpoint(this.provider, saved.endpoint);
        this.model =
          typeof saved.model === "string" ? saved.model.slice(0, 256) : "";
      }
    } catch {}
    this.goal = "";
    this.includeDna = false;
    this.response = "";
    this.prompt = "";
    this.error = "";
    this.connection = null;
    this.proposal = null;
    this.epoch = 0;
    this.pending = false;
    this.authBusy = false;
    this.authStatus = "";
    this.accounts = [];
    this.models = [];
    this.apiModels = [];
    this.modelManual = false;
    this.modelLoading = false;
    this.modelError = "";
    this.modelEpoch = 0;
    this.modelTimer = null;
    this.chatNotice = "";
    this.accountOpen = false;
    this.task = "";
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (event.target.closest('#ai-settings-dialog [data-ai="connect"]')) {
          // A model-list response must not move Connect between press and release.
          clearTimeout(this.modelTimer);
          this.modelEpoch++;
          this.modelLoading = false;
        }
      },
      true,
    );
    document.addEventListener("input", (event) => {
      if (!event.target.closest("#ai-workspace, #ai-settings-dialog")) return;
      this.read();
      if (event.target.id === "ai-response") this.proposal = null;
      if (["ai-key", "ai-endpoint"].includes(event.target.id)) {
        this.invalidateApiModels();
        if (!this.modelManual && $("#ai-key")?.value.trim())
          this.modelTimer = setTimeout(() => this.loadApiModels(), 900);
      }
    });
    document.addEventListener("change", (event) => {
      if (event.target.id === "ai-model-manual") {
        this.read();
        this.modelManual = event.target.checked;
        this.refreshApiModelControl();
      } else if (event.target.id === "ai-key") {
        clearTimeout(this.modelTimer);
        if (
          event.target.value.trim() &&
          !this.modelManual &&
          !this.apiModels.length &&
          !this.modelError
        )
          this.modelTimer = setTimeout(() => this.loadApiModels(), 900);
      } else if (event.target.id === "ai-chatgpt-account") {
        this.read();
        this.accountId = event.target.value;
        this.models = [];
        if (this.provider === "chatgpt") this.model = "";
        this.render();
      } else if (event.target.id === "ai-provider") {
        this.invalidateApiModels();
        this.modelManual = false;
        if ($("#ai-key")) $("#ai-key").value = "";
        this.provider = event.target.value;
        this.endpoint = AI_PROVIDERS.find(
          (p) => p.id === this.provider,
        ).endpoint;
        this.model = "";
        this.render();
      } else if (event.target.id === "ai-task") {
        this.read();
        this.goal = tasks[event.target.value] || this.goal;
        this.render();
      }
    });
    window.addEventListener("online", () => {
      if (
        this.provider === "chatgpt" &&
        !this.connection &&
        !this.restoring &&
        !this.sessionDisconnected &&
        !this.authBusy &&
        !this.pending
      )
        this.restoreSavedConnection();
    });
    this.restoreSavedConnection();
  }
  read() {
    if (!$("#ai-workspace") && !this.settingsOpen) return;
    for (const key of ["model", "endpoint", "goal", "response"])
      if ($("#ai-" + key)) this[key] = $("#ai-" + key).value;
    if ($("#ai-remember")) this.remember = $("#ai-remember").checked;
    if ($("#ai-dna")) {
      if ($("#ai-workspace")?.dataset.connected)
        this.connectedIncludeDna = $("#ai-dna").checked;
      else this.includeDna = $("#ai-dna").checked;
    }
    if ($("#ai-history")) {
      if ($("#ai-workspace")?.dataset.connected)
        this.connectedHistory = $("#ai-history").checked;
      else this.includeHistory = $("#ai-history").checked;
    }
    this.accountOpen = $("#ai-account-details")?.open ?? this.accountOpen;
    if ($("#ai-task")) this.task = $("#ai-task").value;
    if (document.querySelector("[data-ai-template]"))
      this.attachedIds = new Set(
        [...document.querySelectorAll("[data-ai-template]:checked")].map(
          (el) => el.dataset.aiTemplate,
        ),
      );
    this.savePreferences();
    if ($("#ai-summary-detail"))
      $("#ai-summary-detail").textContent = this.connectionSummary();
  }
  savePreferences() {
    try {
      localStorage.setItem(
        "plasmidcraft.ai.preferences",
        JSON.stringify({
          provider: this.provider,
          accountId: this.accountId,
          endpoint: preferenceEndpoint(this.provider, this.endpoint),
          model: this.model,
          connectedIncludeDna: this.connectedIncludeDna,
        }),
      );
    } catch {}
  }
  async restoreSavedConnection() {
    if (!this.api.platform.desktop || this.restoring) return;
    const epoch = this.epoch;
    const useChatGPT = this.provider === "chatgpt";
    if (
      useChatGPT
        ? !this.api.platform.chatGPTRestore
        : !this.api.platform.aiRestoreSaved
    )
      return;
    this.restoring = true;
    try {
      if (useChatGPT) {
        const status = await this.api.platform.chatGPTRestore();
        if (epoch !== this.epoch) return;
        this.read();
        if (status && Array.isArray(status.accounts)) {
          this.accounts = status.accounts;
          this.chatNotice = status.notice || "";
          this.connectionNotice = status.notice || "";
          const account = status.accounts.find((a) => a.id === status.activeId);
          if (account?.planEnabled) {
            this.accountId = status.activeId;
            this.provider = "chatgpt";
            this.endpoint = "https://api.openai.com/v1";
            this.connection = {
              provider: "chatgpt",
              endpoint: this.endpoint,
              accountId: status.activeId,
              planEnabled: true,
            };
            // Preserve the last chosen model even while offline or before a
            // metadata refresh; restoring never makes an inference request.
            this.models = this.model
              ? [{ slug: this.model, display_name: this.model }]
              : [];
            this.savePreferences();
            if (!this.model)
              this.refreshRestoredChatGPTModels(status.activeId, epoch);
          }
        }
      } else {
        const saved = await this.api.platform.aiRestoreSaved();
        if (epoch !== this.epoch) return;
        this.read();
        if (saved) {
          const same =
            this.provider === saved.provider &&
            this.endpoint === saved.endpoint;
          this.provider = saved.provider;
          this.endpoint = saved.endpoint;
          if (!same || !this.model) this.model = saved.model || "";
          this.connection = saved;
          this.savedConnection = !!saved.remembered;
          this.savePreferences();
        }
      }
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (!useChatGPT) this.savedConnection = true;
      this.connectionNotice = String(error.message || error);
    } finally {
      this.restoring = false;
      if (epoch === this.epoch && (this.open || this.settingsOpen))
        this.render();
    }
  }
  async refreshRestoredChatGPTModels(accountId, epoch) {
    try {
      const models = await this.api.platform.chatGPTModels(accountId);
      if (epoch !== this.epoch || this.connection?.accountId !== accountId)
        return;
      if (Array.isArray(models) && models.length) {
        this.read();
        this.models = models;
        if (this.open || this.settingsOpen) this.render();
      }
    } catch {
      // Keep the saved model/session on temporary metadata/network failure.
    }
  }
  toggle() {
    if (this.open) this.close();
    else this.show();
  }
  close() {
    this.read();
    this.open = false;
    this.cancel();
    $("#ai-panel").hidden = true;
    $("#ai-panel-body").innerHTML = "";
    document.body.classList.remove("ai-panel-open");
    $("#ai-assistant-button")?.setAttribute("aria-expanded", "false");
  }
  show(mode = "assistant") {
    this.read();
    if (["settings", "account"].includes(mode)) {
      this.showSettings(mode === "account");
      return;
    }
    if ($("#ai-settings-dialog")?.open) $("#ai-settings-dialog").close();
    if (
      this.provider === "chatgpt" &&
      !this.connection &&
      !this.restoring &&
      !this.sessionDisconnected
    )
      this.restoreSavedConnection();
    this.open = true;
    this.view = mode === "external" ? "external" : "conversation";
    if (mode === "workflow") this.task = "";
    this.render();
    if (["response", "external", "workflow"].includes(mode))
      this.jump(mode === "workflow" ? "design" : mode);
  }
  showSettings(account = false) {
    this.read();
    this.settingsOpen = true;
    if (account) this.accountOpen = true;
    let dialog = $("#ai-settings-dialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "ai-settings-dialog";
      dialog.className = "ai-settings-dialog";
      dialog.setAttribute("aria-labelledby", "ai-settings-title");
      dialog.addEventListener("close", () => {
        this.read();
        this.settingsOpen = false;
        this.modelEpoch++;
        clearTimeout(this.modelTimer);
        this.modelLoading = false;
        if (!this.connection) this.apiModels = [];
        dialog.innerHTML = "";
        if (this.authBusy) this.cancel();
        if (this.open) this.render();
      });
      document.body.append(dialog);
    }
    this.renderSettings();
    if (!dialog.open) showFloatingDialog(dialog);
    this.loadAccountStatus();
    if (
      this.connection &&
      this.provider !== "chatgpt" &&
      !this.apiModels.length &&
      !this.modelLoading
    )
      this.loadApiModels();
  }
  renderSettings() {
    if (!this.settingsOpen) return;
    const key = $("#ai-key")?.value || "";
    const provider = AI_PROVIDERS.find((p) => p.id === this.provider),
      locked =
        this.connection || this.pending || this.authBusy || this.restoring,
      disabled =
        this.pending || this.authBusy || this.restoring ? "disabled" : "";
    $("#ai-settings-dialog").innerHTML =
      `<div class="modal-header"><h2 id="ai-settings-title">AI accounts and models</h2>${button("Done", "settings-close")}</div><div class="modal-body"><details id="ai-connection-details" open><summary>Connection and model</summary><p>Configure this once, then use Internal AI Operations for conversations and direct app operations. Enter your API key once. PlasmidCraft saves your provider, key and selected model on this computer and reconnects automatically when the app starts. No prompt or DNA is sent during reconnect.</p><p class="analysis-note">API keys use the provider’s API billing. ChatGPT login uses eligible account access; other website accounts use copy/paste.</p><details id="ai-account-details" ${this.accountOpen || this.provider === "chatgpt" ? "open" : ""}><summary>ChatGPT account login</summary>${this.chatGPTPanel()}</details><div class="ai-controls"><label>Provider<select id="ai-provider" ${locked ? "disabled" : ""}>${AI_PROVIDERS.map((p) => `<option value="${p.id}" ${p.id === this.provider ? "selected" : ""}>${e(p.name)}</option>`).join("")}</select></label><label>API base URL<input id="ai-endpoint" value="${e(this.endpoint)}" ${this.provider !== "compatible" || locked ? "disabled" : ""}></label>${this.provider === "chatgpt" ? this.chatGPTModelControl(disabled) : this.apiModelControl(disabled)}${!this.connection && this.provider !== "chatgpt" ? `<label>API key<input id="ai-key" type="password" autocomplete="off" spellcheck="false" ${!this.api.platform.desktop ? "disabled" : ""}></label>` : ""}</div>${!this.connection && this.provider !== "chatgpt" ? `<label class="check-label"><input id="ai-remember" type="checkbox" ${this.remember ? "checked" : ""} ${disabled}>Remember this connection on this computer</label>` : ""}<div class="wf-actions">${button(this.remember ? "Save and connect" : "Connect for this session", "connect", this.api.platform.desktop && !locked && this.provider !== "chatgpt" ? "" : "disabled")}${button(this.provider === "chatgpt" ? "Disconnect assistant (keep saved session)" : "Disconnect for now", "disconnect", this.connection && !disabled ? "" : "disabled")}${button(this.provider === "chatgpt" ? "Test model (uses plan quota)" : "Test connection (small API request)", "test", this.connection && !disabled && (this.provider !== "chatgpt" || this.connection.planEnabled) ? "" : "disabled")}${this.savedConnection ? button("Forget saved connection", "forget", disabled) : ""}${provider.dashboard ? button("Open provider API-key page", "dashboard") : ""}</div><p id="ai-connection-status">${this.connection ? `${this.provider === "chatgpt" ? `ChatGPT account: ${e(this.accounts.find((a) => a.id === this.connection.accountId)?.label || this.connection.accountId)} · ${this.connection.planEnabled ? "Plan permission granted. Choose a model." : "Plan permission missing; reauthorize before use."}` : `Configured: ${e(this.connection.provider)} at ${e(this.connection.endpoint)}. ${this.connection.remembered ? " Saved on this computer." : " Session only."} Sending a request verifies credentials/model access.`}` : this.api.platform.desktop ? (this.savedConnection ? "Disconnected for now. The saved API connection will reconnect at next app launch; use Forget saved connection to remove it." : "Enter your API key and choose Save and connect. The connection will be restored automatically on later launches.") : "Development UI preview. Open the packaged desktop app to connect a provider."}</p></details><p class="analysis-note">${e(this.connectionNotice)}</p><p role="status">${this.restoring ? "Restoring saved AI connection…" : this.pending ? "Waiting for provider…" : ""}</p><p class="modal-error" role="alert">${e(this.error)}</p>${this.authBusy || this.pending ? button("Cancel sign-in / request", "cancel") : ""}</div>`;
    if ($("#ai-key")) $("#ai-key").value = key;
    prepareFloatingDialogHeader($("#ai-settings-dialog"));
  }
  refreshContext() {
    if (!this.open) return;
    if (
      !this.pending &&
      this.view === "conversation" &&
      this.historyDocId !== (this.api.active()?.id || "empty")
    )
      this.loadLocalConversation();
    const source = this.api.active(),
      selection = this.api.selection();
    const live = $("#ai-live-context");
    if (live)
      live.textContent = source
        ? `${source.name} · ${source.sequence.length.toLocaleString()} bp${selection ? ` · selected bases ${selection.start + 1}–${selection.end}` : " · no selected region"}`
        : "No active DNA";
    const note = $("#ai-context-note");
    if (note)
      note.textContent =
        this.context &&
        (source?.id !== this.context.id ||
          recordToken(source || {}) !== this.context.token ||
          JSON.stringify(selection) !== JSON.stringify(this.context.selection))
          ? "Editor context changed. Preview or Send will capture the current document and selection; an existing proposal stays tied to its original source."
          : "Select DNA or map features while this panel remains open. Context is captured only when you Preview or Send.";
  }
  connectionSummary() {
    if (this.restoring) return "Restoring saved AI connection…";
    if (!this.connection)
      return (
        this.connectionNotice ||
        "No provider connected · set up through AI → Accounts and Models…"
      );
    const provider =
      AI_PROVIDERS.find((p) => p.id === this.connection.provider)?.name ||
      this.connection.provider;
    const access =
      this.connection.provider === "chatgpt"
        ? this.connection.planEnabled
          ? "Plan permission granted"
          : "Plan permission needed"
        : this.connection.remembered
          ? "Saved on this device · access checked when you send"
          : "Session connection · access checked when you send";
    return `${provider} · ${this.model || "Choose a model"} · ${access}`;
  }
  jump(section) {
    this.read();
    if (["connection", "account"].includes(section)) {
      this.showSettings(section === "account");
      return;
    }
    if ($("#ai-settings-dialog")?.open) $("#ai-settings-dialog").close();
    if (!this.open) {
      this.open = true;
      this.render();
    }
    this.view =
      section === "external" ||
      (section === "response" && this.view.startsWith("external"))
        ? "external"
        : "conversation";
    this.render();
    this.applyView();
    $("#ai-panel-body").scrollTop = 0;
    if (section === "design" && $("#ai-conversation-scroll"))
      $("#ai-conversation-scroll").scrollTop = 0;
    if (section === "response") {
      if (this.view === "external") $("#ai-response")?.focus();
      else $("#ai-operations").focus({ preventScroll: true });
    }
    if (section === "design") $("#ai-task")?.focus({ preventScroll: true });
  }
  async loadAccountStatus() {
    if (!this.api.platform.desktop || !this.api.platform.chatGPTStatus) return;
    const epoch = this.epoch;
    try {
      const status = await this.api.platform.chatGPTStatus();
      if (epoch !== this.epoch || !this.settingsOpen) return;
      if (!status || !Array.isArray(status.accounts)) return;
      this.read();
      this.accounts = status.accounts;
      this.chatNotice = status.notice || "";
      if (!this.accounts.some((a) => a.id === this.accountId))
        this.accountId = status.activeId || this.accounts[0]?.id || "";
      const panel = $("#chatgpt-account-panel");
      if (panel) panel.outerHTML = this.chatGPTPanel();
    } catch (error) {
      if (epoch === this.epoch && this.settingsOpen) {
        this.read();
        this.chatNotice = String(error.message || error);
        const panel = $("#chatgpt-account-panel");
        if (panel) panel.outerHTML = this.chatGPTPanel();
      }
    }
  }
  chatGPTPanel() {
    const disabled =
      this.pending ||
      this.authBusy ||
      this.restoring ||
      !this.api.platform.desktop
        ? "disabled"
        : "";
    return `<section class="data-card" id="chatgpt-account-panel"><h3>Use your ChatGPT account</h3><p>Sign in on OpenAI’s website and authorize PlasmidCraft. Eligible accounts can use their ChatGPT plan without an API key. Availability, models and plan limits are controlled by OpenAI. No plasmid data is sent during sign-in.</p><div class="wf-actions">${button("Continue with ChatGPT", "chatgpt-new", disabled)}</div><label>Saved ChatGPT registration<select id="ai-chatgpt-account" ${disabled}><option value="">Add an account…</option>${this.accounts.map((a) => `<option value="${e(a.id)}" ${a.id === this.accountId ? "selected" : ""}>${e(a.label)}${a.savedSession ? "" : " · sign-in may be needed"}</option>`).join("")}</select></label><div class="wf-actions">${button("Use saved session", "chatgpt-use", this.accountId && !disabled ? "" : "disabled")}${button("Sign in again / grant plan access", "chatgpt-reauth", this.accountId && !disabled ? "" : "disabled")}${button("Sign out selected account", "chatgpt-out", this.accountId && !disabled ? "" : "disabled")}${button("Reload active account models", "chatgpt-models", this.connection?.provider === "chatgpt" && !disabled ? "" : "disabled")}</div><p id="chatgpt-account-status">${e(this.authStatus || this.chatNotice || "The last-used ChatGPT account reconnects automatically when the app starts. Sessions are saved on this computer and renewed when needed.")}</p></section>`;
  }
  invalidateApiModels() {
    clearTimeout(this.modelTimer);
    this.modelEpoch++;
    this.modelLoading = false;
    this.apiModels = [];
    this.modelError = "";
    this.refreshApiModelControl();
  }
  apiModelControl(disabled = "") {
    const current =
      this.model && !this.apiModels.some((m) => m.id === this.model);
    return `<div id="ai-api-model-control"><label>${this.modelManual ? "Model ID" : "Available API models"}${this.modelManual ? `<input id="ai-model" value="${e(this.model)}" placeholder="Enter a model ID" ${disabled}>` : `<select id="ai-model" ${disabled || this.modelLoading ? "disabled" : ""}><option value="">${this.modelLoading ? "Loading available models…" : "Select a model…"}</option>${current ? `<option value="${e(this.model)}" selected>Saved / manual model: ${e(this.model)}</option>` : ""}${this.apiModels.map((m) => `<option value="${e(m.id)}" ${this.model === m.id ? "selected" : ""}>${e(m.name === m.id ? m.id : `${m.name} · ${m.id}`)}</option>`).join("")}</select>`}</label><label class="check-label"><input id="ai-model-manual" type="checkbox" ${this.modelManual ? "checked" : ""} ${disabled}>Enter a model ID manually</label>${button("Refresh model list", "models-refresh", disabled || this.modelLoading || !this.api.platform.desktop ? "disabled" : "")}<p class="analysis-note" id="ai-model-status" role="status">${e(this.modelError || (this.modelLoading ? "Loading model metadata; no DNA or prompts are sent." : this.apiModels.length ? `${this.apiModels.length} provider models. Choose a text-generation model; Send or Test checks endpoint access.` : "The model list loads after you enter your API key. Local servers without a key can use Refresh model list."))}</p></div>`;
  }
  refreshApiModelControl() {
    const control = $("#ai-api-model-control");
    if (control)
      control.outerHTML = this.apiModelControl(
        this.pending || this.authBusy || this.restoring ? "disabled" : "",
      );
  }
  async loadApiModels() {
    clearTimeout(this.modelTimer);
    if (
      !this.settingsOpen ||
      this.provider === "chatgpt" ||
      this.modelLoading ||
      !this.api.platform.desktop
    )
      return;
    this.read();
    const key = $("#ai-key")?.value || "";
    if (!this.connection && !key.trim() && this.provider !== "compatible")
      return;
    const epoch = ++this.modelEpoch;
    this.modelLoading = true;
    this.modelError = "";
    this.refreshApiModelControl();
    try {
      const result = await this.api.platform.aiListModels(
        this.connection
          ? null
          : { provider: this.provider, endpoint: this.endpoint, apiKey: key },
      );
      if (epoch !== this.modelEpoch || !this.settingsOpen) return;
      if (!Array.isArray(result?.models))
        throw new Error(
          "This endpoint did not return a model list. You can enter the model ID manually.",
        );
      this.apiModels = result.models;
      this.modelError = result.truncated
        ? "Showing the first 1,000 models or ten pages; a model ID can also be entered manually."
        : this.apiModels.length
          ? ""
          : "No compatible models were returned. Check your key permissions or enter a model ID manually.";
    } catch (error) {
      if (epoch !== this.modelEpoch || !this.settingsOpen) return;
      this.modelError = String(error.message || error);
    } finally {
      if (epoch === this.modelEpoch) {
        this.modelLoading = false;
        this.refreshApiModelControl();
      }
    }
  }
  chatGPTModelControl(disabled) {
    const current =
      this.model && !this.models.some((m) => m.slug === this.model);
    return `<label>ChatGPT account model<select id="ai-model" ${disabled}><option value="">Choose an available account model…</option>${current ? `<option value="${e(this.model)}" selected>Saved model: ${e(this.model)}</option>` : ""}${this.models.map((m) => `<option value="${e(m.slug)}" ${this.model === m.slug ? "selected" : ""}>${e(m.display_name)}</option>`).join("")}</select></label>`;
  }
  async accountAction(action) {
    const epoch = ++this.epoch;
    this.authBusy = true;
    this.proposal = null;
    this.authStatus =
      action === "chatgpt-new" || action === "chatgpt-reauth"
        ? "Waiting for ChatGPT authorization in your browser…"
        : "Updating ChatGPT account…";
    this.render();
    try {
      let status;
      if (action === "chatgpt-new" || action === "chatgpt-reauth")
        status = await this.api.platform.chatGPTSignIn(
          action === "chatgpt-reauth" ? this.accountId : null,
        );
      else if (action === "chatgpt-use")
        status = await this.api.platform.chatGPTActivate(this.accountId);
      else if (action === "chatgpt-out")
        status = await this.api.platform.chatGPTSignOut(this.accountId);
      else if (action === "chatgpt-models") {
        const id = this.connection?.accountId;
        if (!id) throw new Error("Activate a ChatGPT account first.");
        const models = await this.api.platform.chatGPTModels(id);
        if (epoch !== this.epoch) return;
        this.models = models;
        if (!models.some((m) => m.slug === this.model)) this.model = "";
      }
      if (epoch !== this.epoch) return;
      if (status) {
        this.sessionDisconnected = action === "chatgpt-out";
        this.connectionNotice = "";
        this.accounts = status.accounts;
        this.chatNotice = status.notice || "";
        if (action === "chatgpt-out") {
          if (
            this.connection?.provider === "chatgpt" &&
            this.connection.accountId === this.accountId
          ) {
            this.connection = null;
            this.models = [];
            this.model = "";
          }
        } else if (status.activeId) {
          this.accountId = status.activeId;
          const a = this.accounts.find((a) => a.id === status.activeId);
          this.provider = "chatgpt";
          this.endpoint = "https://api.openai.com/v1";
          this.connection = {
            provider: "chatgpt",
            endpoint: this.endpoint,
            accountId: status.activeId,
            planEnabled: !!a?.planEnabled,
          };
          this.model = "";
          this.models = [];
          this.response = "";
          if (a?.planEnabled) {
            this.models = await this.api.platform.chatGPTModels(
              status.activeId,
            );
            if (epoch !== this.epoch) return;
            if (!this.models.length)
              this.chatNotice =
                "This account returned no available models. Check eligibility or reload later.";
          }
        }
      }
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.error = String(error.message || error);
    } finally {
      if (epoch === this.epoch) {
        this.authBusy = false;
        this.authStatus = "";
      }
    }
    if (epoch === this.epoch) this.savePreferences();
    if (epoch === this.epoch && this.settingsOpen) this.render();
  }
  render() {
    this.renderSettings();
    if (!this.open) return;
    if (!this.view.startsWith("external")) {
      this.renderConnected();
      return;
    }
    const previousScroll = $("#ai-panel-body")?.scrollTop || 0;
    const disabled =
      this.pending || this.authBusy || this.restoring ? "disabled" : "";
    const body = `<div id="ai-workspace"><div class="ai-connection-banner"><span class="ai-connection-badge ${this.connection ? "configured" : ""}">${this.connection ? "Configured" : "Not connected"}</span><span id="ai-summary-detail" role="status">${e(this.connectionSummary())}</span></div><nav class="ai-section-nav" aria-label="AI assistant sections">${button("Internal AI Operations", "navigate-design")}${button("External AI", "navigate-external")}</nav><p>Prepare a prompt to use in an AI website, then paste its JSON proposal below to review and apply.</p><section id="ai-design-section"><h3>Prepare a prompt for external AI</h3><div class="ai-controls"><label>Workflow prompt<select id="ai-task" ${disabled}><option value="">Choose a starting point…</option>${Object.keys(
      tasks,
    )
      .map(
        (t) =>
          `<option value="${t}" ${this.task === t ? "selected" : ""}>${e({ design: "Design plasmid", other: "Other tasks", review: "Review plasmid", gibson: "Gibson cloning", golden: "Golden Gate cloning", primers: "PCR primers", annotation: "Feature annotation", codons: "Codon optimization" }[t])}</option>`,
      )
      .join(
        "",
      )}</select></label><label class="check-label"><input id="ai-dna" type="checkbox" ${this.includeDna ? "checked" : ""} ${disabled}>Include active DNA and selected bases (up to 40,000 bp)</label></div><div class="ai-live-context"><strong>Current editor context</strong><p id="ai-live-context"></p><p class="analysis-note" id="ai-context-note"></p></div><p class="analysis-note">Prompt metadata includes names, topology, length and up to 250 feature locations. DNA is included only when checked. Other open documents, traces, edit history, libraries, paths and credentials are excluded.</p><label>Prompt<textarea id="ai-goal" rows="4" ${disabled}>${e(this.goal)}</textarea></label><label class="check-label"><input type="checkbox" id="ai-history" ${this.includeHistory ? "checked" : ""} ${disabled}>Include recent conversation history in the outgoing prompt</label><p class="analysis-note">History may contain DNA from earlier messages. Preview the outgoing prompt before sharing it.</p><div class="wf-actions">${button("Preview outgoing prompt", "prepare", disabled)}${button("Cancel sign-in / request", "cancel", this.pending || this.authBusy ? "" : "disabled")}${button("Copy prompt for external AI", "copy", disabled)}</div><details ${this.prompt ? "open" : ""}><summary>Exact outgoing prompt</summary><textarea id="ai-outgoing" rows="7" readonly>${e(this.prompt)}</textarea></details></section><details id="ai-external-details"><summary>Use an AI website with copy / paste</summary><p>Copy the prepared prompt, open your service, sign in there and paste it. Paste its JSON response below to review in PlasmidCraft. These buttons open websites; they do not sign PlasmidCraft into your subscription.</p><div class="wf-actions">${["chatgpt", "codex", "claude", "gemini"].map((s) => button("Open " + { chatgpt: "ChatGPT", codex: "Codex", claude: "Claude", gemini: "Gemini" }[s], "site-" + s)).join("")}</div></details><section id="ai-response-section"><h3>Paste external AI JSON proposal</h3><label>JSON proposal<textarea id="ai-response" rows="8" spellcheck="false" ${disabled}>${e(this.response)}</textarea></label><div class="wf-actions">${button("Review proposed actions", "review", disabled)}${button("Export response", "export", this.response && !this.pending ? "" : "disabled")}${button("Clear session text", "clear", disabled)}</div><p role="status" id="ai-status">${this.pending ? "Waiting for provider…" : ""}</p><p class="modal-error" role="alert" id="ai-error">${e(this.error)}</p>${this.proposal ? `<div class="data-card"><h3>Review proposal</h3><p>${e(this.proposal.summary)}</p><ol>${this.proposal.steps.map((s) => `<li>${e(s)}</li>`).join("")}</ol><p>${this.proposal.created.length} new DNA document(s). Source documents are preserved. All coordinates and primer binding are checked locally; biological identity and experimental performance still require review.</p>${this.proposal.created.map((r) => `<details><summary>${e(r.name)} · ${r.sequence.length} bp · ${r.features.length} annotations · ${r.primers.length} primers</summary><pre class="table-sequence">${e(r.sequence)}</pre></details>`).join("")}<div class="wf-actions">${button("Create reviewed DNA copies", "apply", this.proposal.created.length ? "" : "disabled")}${this.proposal.workflows.map((t) => button("Open " + t, "workflow-" + t)).join("")}</div></div>` : ""}</section></div>`;
    $("#ai-panel").hidden = false;
    document.body.classList.add("ai-panel-open");
    $("#ai-assistant-button")?.setAttribute("aria-expanded", "true");
    $("#ai-panel-body").innerHTML = body;
    $("#ai-panel-body").scrollTop = previousScroll;
    this.applyView();
    const status = document.createElement("div");
    status.className = "ai-global-status";
    status.append(
      $("#ai-status"),
      $("#ai-error"),
      $("#ai-workspace").querySelector('[data-ai="cancel"]'),
    );
    $("#ai-workspace").append(status);
    this.refreshContext();
  }
  async conversationKey(source) {
    const bytes = new TextEncoder().encode(
      JSON.stringify([source?.name || "No document", source?.sequence || ""]),
    );
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
  }
  async loadLocalConversation() {
    const source = this.api.active();
    if (this.pending || this.historyDocId === (source?.id || "empty")) return;
    this.historyDocId = source?.id || "empty";
    this.historyKey = null;
    this.messages = [];
    this.operations = [];
    this.resultDocuments = [];
    this.toolOutputs = [];
    this.operationStatus = "No operations yet.";
    this.historyNotice = "";
    this.historyLoading = true;
    const epoch = ++this.historyEpoch;
    try {
      const key = await this.conversationKey(source);
      if (epoch !== this.historyEpoch) return;
      this.historyKey = key;
      const store = JSON.parse(
        localStorage.getItem(this.historyStore) || "null",
      );
      const entry =
        store?.version === 1 && store.sessions?.find((s) => s.key === key);
      if (entry && Array.isArray(entry.messages)) {
        this.messages = entry.messages
          .filter(
            (m) =>
              ["user", "assistant"].includes(m.role) &&
              typeof m.text === "string",
          )
          .slice(-40)
          .map((m) => ({ role: m.role, text: m.text.slice(0, 12000) }));
        this.operations = Array.isArray(entry.operations)
          ? entry.operations
              .filter((o) => typeof o.detail === "string")
              .slice(-24)
          : [];
        this.operationStatus = this.operations.length
          ? "Restored saved operation history."
          : "No operations yet.";
      }
    } catch {
      this.chatNotice = "Local conversation history could not be restored.";
    } finally {
      if (epoch === this.historyEpoch) {
        this.historyLoading = false;
        if (this.open && !this.view.startsWith("external")) this.render();
      }
    }
  }
  persistConversation(keys = [this.historyKey]) {
    try {
      const old = JSON.parse(localStorage.getItem(this.historyStore) || "null");
      let sessions =
        old?.version === 1 && Array.isArray(old.sessions) ? old.sessions : [];
      for (const key of keys.filter(Boolean)) {
        sessions = sessions.filter((s) => s.key !== key);
        sessions.unshift({
          key,
          updated: Date.now(),
          messages: this.messages.slice(-40),
          operations: this.operations
            .slice(-24)
            .map(({ tool, detail, status }) => ({ tool, detail, status })),
        });
      }
      sessions = sessions.slice(0, 20);
      while (JSON.stringify(sessions).length > 1500000 && sessions.length > 1)
        sessions.pop();
      localStorage.setItem(
        this.historyStore,
        JSON.stringify({ version: 1, sessions }),
      );
      this.historyNotice = "Conversation saved on this device.";
    } catch {
      this.historyNotice =
        "Conversation could not be saved locally; export it before closing.";
    }
  }
  renderConnected() {
    this.loadLocalConversation();
    const locked =
      this.pending || this.authBusy || this.restoring || this.historyLoading;
    const disabled = locked ? "disabled" : "";
    const canSend =
      this.connection &&
      this.model &&
      !locked &&
      (this.provider !== "chatgpt" || this.connection.planEnabled);
    const templates = (this.api.documents?.() || [])
      .filter((d) => d.id !== this.api.active()?.id && !d.trace)
      .map(
        (d) =>
          `<label class="check-label"><input type="checkbox" data-ai-template="${e(d.id)}" ${this.attachedIds.has(d.id) ? "checked" : ""} ${disabled}>${e(d.name)} · ${d.sequence.length.toLocaleString()} bp</label>`,
      )
      .join("");
    const panel = $("#ai-panel-body"),
      scroll = $("#ai-conversation-scroll")?.scrollTop,
      operationScroll = $("#ai-operations-scroll")?.scrollTop,
      composerScroll = $(".ai-composer-fields")?.scrollTop,
      openDetails = [
        ...panel.querySelectorAll(".ai-connected-composer details[open]"),
      ].map((el) => el.id || el.className);
    panel.innerHTML = `<div id="ai-workspace" data-connected="true" data-ai-view="conversation"><div class="ai-connection-banner"><span class="ai-connection-badge ${this.connection ? "configured" : ""}">${this.connection ? "Connected" : "Not connected"}</span><span id="ai-summary-detail">${e(this.connectionSummary())}</span></div><nav class="ai-section-nav" aria-label="AI assistant sections">${button("Internal AI Operations", "navigate-design")}${button("External AI", "navigate-external")}</nav><section class="ai-connected-composer" aria-labelledby="ai-input-heading"><h3 id="ai-input-heading">Message input</h3><div class="ai-composer-fields"><textarea id="ai-goal" aria-labelledby="ai-input-heading" placeholder="Describe your design or ask a question…" rows="4" ${disabled}>${e(this.goal)}</textarea><label class="check-label"><input id="ai-dna" type="checkbox" ${this.connectedIncludeDna ? "checked" : ""} ${disabled}>Share active document DNA with connected AI</label><p class="analysis-note">Send lets AI inspect the attached sequence and run local tools on a new copy. Your original stays unchanged. No file is saved automatically.</p><details class="ai-context-details"><summary>Document context and templates</summary><div class="ai-live-context"><strong>Current editor context</strong><p id="ai-live-context"></p><p id="ai-context-note" class="analysis-note"></p></div>${templates ? `<details class="ai-template-picker"><summary>Additional DNA templates</summary><p class="analysis-note">Select up to two open templates for cloning. Only checked templates are included in the request; the DNA attachment checkbox also applies to them.</p>${templates}</details>` : ""}</details></div><div class="wf-actions">${button("Send", "send", canSend ? "" : "disabled")}${button("Stop", "cancel", this.pending ? "" : "disabled")}</div></section><section id="ai-operations" class="ai-internal-section" tabindex="-1" aria-labelledby="ai-operations-heading"><h3 id="ai-operations-heading">Operations and results</h3><div class="ai-connected-scroll" id="ai-operations-scroll"><p role="status">${this.pending ? "Working on a separate copy…" : e(this.operationStatus || "No operations yet.")}</p><ol>${this.operations.map((o) => `<li class="ai-operation ${e(o.status)}"><strong>${e(String(o.tool || "Operation").replaceAll("_", " "))}</strong> · ${e(o.status)}<p>${e(o.detail)}</p></li>`).join("")}</ol>${this.resultDocuments.map((d, i) => `<div class="ai-result-link"><strong>${e(d.name)}</strong> · ${d.sequence.length.toLocaleString()} bp ${button("Open document", "result-" + i)}${button("Save .pcraft…", "save-result-" + i)}</div>`).join("")}${this.toolOutputs.map((o) => `<details><summary>${e(o.name)}</summary>${o.primers.map((p) => `<p>${e(p.name)}<br><code class="table-sequence">${e(p.sequence)}</code></p>`).join("")}</details>`).join("")}<p id="ai-error" class="modal-error" role="alert">${e(this.error)}</p></div></section><section id="ai-history-section" class="ai-internal-section" aria-labelledby="ai-history-heading"><h3 id="ai-history-heading">Conversation history</h3><div class="ai-connected-scroll" id="ai-conversation-scroll"><section class="ai-conversation-log" aria-label="Conversation history">${
      [...this.messages]
        .reverse()
        .map(
          (m) =>
            `<article class="ai-message ${m.role}"><strong>${m.role === "user" ? "You" : "AI"}</strong><p>${e(m.text)}</p></article>`,
        )
        .join("") ||
      "<p>Describe your design goal. The assistant can use local tools and open the result as a new plasmid document.</p>"
    }</section><details><summary>History and sharing settings</summary><label class="check-label"><input type="checkbox" id="ai-history" ${this.connectedHistory ? "checked" : ""} ${disabled}>Include recent conversation in the next request</label><p class="analysis-note">History can contain earlier DNA. Local tools can use the active document and explicitly checked additional templates. Document DNA and tool-generated oligos are attached only when enabled above; names, feature locations and tool summaries are included. Messages and selected history are sent as written and can contain pasted DNA. Send authorizes relevant local operations on a copy. Results open as unsaved documents.</p><p class="analysis-note">${e(this.historyNotice || "Conversation history is stored locally per document.")}</p>${button("New conversation", "new-chat", disabled)}${button("Export conversation", "export-conversation", disabled)}</details></div></section></div>`;
    $("#ai-panel").hidden = false;
    document.body.classList.add("ai-panel-open");
    $("#ai-assistant-button")?.setAttribute("aria-expanded", "true");
    this.refreshContext();
    if (scroll !== undefined)
      $("#ai-conversation-scroll").scrollTop =
        this.renderedMessageCount === this.messages.length ? scroll : 0;
    this.renderedMessageCount = this.messages.length;
    if (operationScroll !== undefined)
      $("#ai-operations-scroll").scrollTop = operationScroll;
    for (const el of panel.querySelectorAll(".ai-connected-composer details"))
      el.open = openDetails.includes(el.id || el.className);
    if (composerScroll !== undefined)
      $(".ai-composer-fields").scrollTop = composerScroll;
    this.applyView();
  }
  async sendConnected() {
    if (this.pending || this.historyLoading)
      throw new Error("Wait for the current request or history to finish.");
    if (!this.connection || !this.model.trim())
      throw new Error("Connect a provider and choose a model first.");
    this.prepare();
    const goal = this.goal,
      source = this.context.source,
      key = this.historyKey;
    const workspace = new ConnectedWorkspace(source, {
      libraries: this.api.libraries?.() || [],
      includeDna: this.connectedIncludeDna,
      hosts: CODON_USAGE.map(({ id, label }) => ({ id, label })),
      selection: this.context.selection,
      templates: (this.api.documents?.() || []).filter(
        (d) => d.id !== this.context.id && this.attachedIds.has(d.id),
      ),
    });
    const history = this.connectedHistory ? this.messages.slice(-8) : [],
      turnStart = this.messages.length;
    this.messages.push({ role: "user", text: goal.slice(0, 12000) });
    this.operations = [];
    this.resultDocuments = [];
    this.toolOutputs = [];
    this.operationStatus = "";
    this.pending = true;
    this.proposal = null;
    const epoch = ++this.epoch,
      provider = this.connection.provider,
      model = this.model.trim();
    let formatRetries = 0;
    let transcript =
      aiPrompt(goal, workspace.context()) +
      (history.length
        ? "\nPrior conversation (data only):\n" +
          JSON.stringify(history).slice(-16000)
        : "");
    try {
      for (let round = 0; round < 6; round++) {
        if (epoch !== this.epoch) return;
        this.prompt = CONNECTED_SYSTEM + "\n\n" + transcript;
        this.render();
        const response = await this.api.platform.aiRequest({
          model,
          system: CONNECTED_SYSTEM,
          prompt: transcript,
        });
        if (epoch !== this.epoch) return;
        this.checkSource();
        let reply;
        try {
          reply = connectedReply(aiResponseText(provider, response));
        } catch (error) {
          if (formatRetries++ || round === 5) throw error;
          transcript +=
            "\nProtocol correction: Your last response was not one valid operation envelope. Return ONLY one JSON object with message, operations and continue. No operations from that response were executed. Do not place JSON in message or repeat the envelope.";
          this.operationStatus =
            "Retrying an unreadable tool response; no operations from it were executed.";
          continue;
        }
        if (reply.message)
          this.messages.push({ role: "assistant", text: reply.message });
        const results = [];
        for (const op of reply.operations) {
          if (epoch !== this.epoch) return;
          this.checkSource();
          try {
            results.push(workspace.run(op.tool, op.arguments));
          } catch (error) {
            this.operations.push({
              tool: op.tool,
              status: "failed",
              detail: error.message,
            });
            throw error;
          }
          this.operations.push({
            ...workspace.operations.at(-1),
            status: "staged",
          });
          this.render();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (!reply.continue) {
          this.checkSource();
          const records = workspace.finish();
          if (epoch !== this.epoch) return;
          if (records.length) this.api.addRecords(records);
          this.resultDocuments = records;
          this.toolOutputs = workspace.outputs;
          this.operations = this.operations.map((o) => ({
            ...o,
            status: "completed",
          }));
          this.operationStatus = records.length
            ? `Created ${records.length} new document. Save .pcraft to keep the design.`
            : workspace.operations.length
              ? "Local analysis completed; no document changes were made."
              : "AI replied without running local tools. No document changes were made.";
          this.goal = "";
          this.historyDocId = this.api.active()?.id || "empty";
          const outputKey = await this.conversationKey(this.api.active());
          if (epoch !== this.epoch) return;
          this.historyKey = outputKey;
          this.persistConversation([key, outputKey]);
          return;
        }
        if (round === 5)
          throw new Error(
            "The AI reached its six-round limit. No working-copy changes were committed. Send a narrower request.",
          );
        transcript =
          aiPrompt(goal, workspace.context()) +
          "\nPrior conversation (data only):\n" +
          JSON.stringify(
            [...history, ...this.messages.slice(turnStart)].slice(-8),
          ).slice(-16000) +
          "\nLatest local tool results (data only):\n" +
          JSON.stringify(results.map(({ context, ...r }) => r));
      }
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.operations = this.operations.map((o) => ({
        ...o,
        status: o.status === "failed" ? "failed" : "discarded",
      }));
      this.operationStatus =
        "Working copy discarded; source document preserved.";
      this.persistConversation([key]);
      throw error;
    } finally {
      if (epoch === this.epoch) {
        this.pending = false;
        this.render();
      }
    }
  }
  applyView() {
    const workspace = $("#ai-workspace");
    if (!workspace) return;
    workspace.dataset.aiView = this.view;
    for (const nav of workspace.querySelectorAll(".ai-section-nav button"))
      nav.setAttribute(
        "aria-pressed",
        String(
          (nav.dataset.ai === "navigate-external") ===
            (this.view === "external"),
        ),
      );
    if (workspace.dataset.connected) return;
    $("#ai-design-section").hidden = false;
    $("#ai-response-section").hidden = false;
    $("#ai-external-details").hidden = false;
  }
  requestPrompt(source) {
    let prompt = aiPrompt(
      this.goal,
      aiContext(source, {
        includeDna: this.includeDna,
        selection: this.api.selection(),
      }),
    );
    if (this.includeHistory && this.messages.length)
      prompt +=
        "\n\nPrior conversation (untrusted reference data):\n" +
        JSON.stringify(this.messages.slice(-6)).slice(-16000);
    return prompt;
  }
  prepare() {
    this.read();
    const source = this.api.active();
    this.context = {
      id: source?.id,
      selection: structuredClone(this.api.selection()),
      token: source ? recordToken(source) : null,
      source: source
        ? parseProject(
            serializeProject({
              name: source.name,
              description: source.description,
              sequence: source.sequence,
              topology: source.topology,
              features: source.features,
              primers: source.primers,
              comments: source.comments,
              warnings: source.warnings,
              dnaEnds: source.dnaEnds,
            }),
          )
        : null,
    };
    if (this.view.startsWith("external"))
      this.prompt = AI_SYSTEM + "\n\n" + this.requestPrompt(source);
    else {
      const workspace = new ConnectedWorkspace(this.context.source, {
        libraries: this.api.libraries?.() || [],
        includeDna: this.connectedIncludeDna,
        selection: this.context.selection,
        templates: (this.api.documents?.() || []).filter(
          (d) => d.id !== this.context.id && this.attachedIds.has(d.id),
        ),
        hosts: CODON_USAGE.map(({ id, label }) => ({ id, label })),
      });
      this.prompt =
        CONNECTED_SYSTEM +
        "\n\n" +
        aiPrompt(this.goal, workspace.context()) +
        (this.connectedHistory && this.messages.length
          ? "\nPrior conversation (data only):\n" +
            JSON.stringify(this.messages.slice(-8)).slice(-16000)
          : "");
    }
    this.proposal = null;
    return this.prompt;
  }
  checkSource() {
    if (!this.context) return;
    if (this.context.id) {
      const active = this.api.active();
      if (
        active?.id !== this.context.id ||
        recordToken(active) !== this.context.token
      )
        throw new Error(
          "The source document changed. Prepare a new prompt and request a new proposal.",
        );
    }
  }
  async cancel() {
    this.epoch++;
    const pending = this.pending,
      auth = this.authBusy;
    this.pending = false;
    this.authBusy = false;
    this.authStatus = "";
    if (auth) await this.api.platform.chatGPTCancel?.().catch(() => {});
    if (pending) await this.api.platform.aiCancel().catch(() => {});
    if (pending) {
      this.operations = this.operations.map((o) => ({
        ...o,
        status: o.status === "staged" ? "discarded" : o.status,
      }));
      this.operationStatus =
        "Stopped. Uncommitted working-copy operations were discarded.";
      this.persistConversation();
    }
  }
  async action(action) {
    try {
      this.read();
      this.error = "";
      if (action === "settings-close") {
        $("#ai-settings-dialog")?.close();
        return;
      }
      if (action === "close") {
        this.close();
        return;
      }
      if (action.startsWith("navigate-")) {
        this.jump(action.slice(9));
        return;
      }
      if (action === "models-refresh") {
        await this.loadApiModels();
        return;
      }
      if (action.startsWith("chatgpt-")) {
        await this.accountAction(action);
        return;
      }
      if (action === "connect") {
        this.modelEpoch++;
        clearTimeout(this.modelTimer);
        this.modelLoading = false;
        const key = $("#ai-key")?.value || "";
        if ($("#ai-key")) $("#ai-key").value = "";
        this.connection = await this.api.platform.aiConnect(
          {
            provider: this.provider,
            endpoint: this.endpoint,
            apiKey: key,
          },
          { remember: this.remember, model: this.model.trim() },
        );
        this.savedConnection =
          !!this.connection.remembered || this.savedConnection;
        this.connectionNotice = "";
      } else if (action === "forget") {
        await this.api.platform.aiForgetSaved();
        await this.cancel();
        this.connection = null;
        this.savedConnection = false;
        this.connectionNotice =
          "Saved API connection removed from this device.";
      } else if (action === "disconnect") {
        this.sessionDisconnected = true;
        await this.cancel();
        await this.api.platform.aiDisconnect();
        this.connection = null;
        this.invalidateApiModels();
      } else if (action === "prepare") {
        this.prepare();
        if ($("#ai-prompt-details")) $("#ai-prompt-details").open = true;
      } else if (action === "copy") {
        await this.api.platform.copyText(this.prepare());
        this.api.toast("Prompt copied. Paste into your chosen AI service.");
      } else if (action === "send" && !this.view.startsWith("external")) {
        await this.sendConnected();
      } else if (action.startsWith("save-result-")) {
        const record = this.resultDocuments[Number(action.slice(12))];
        if (!record)
          throw new Error("The result document is no longer available.");
        const doc =
          this.api.documents?.().find((d) => d.id === record.id) || record;
        if (this.api.saveRecord) await this.api.saveRecord(doc);
        else
          await this.api.platform.saveFile(
            `${doc.name}.pcraft`,
            serializeProject(doc),
          );
      } else if (action.startsWith("result-")) {
        const record = this.resultDocuments[Number(action.slice(7))];
        if (!record || !this.api.documents?.().some((d) => d.id === record.id))
          throw new Error(
            "This result tab was closed. Reopen the saved .pcraft file.",
          );
        this.api.activate?.(record.id);
      } else if (action === "export-conversation") {
        await this.api.platform.saveFile(
          "PlasmidCraft_conversation.txt",
          this.messages
            .map((m) => `${m.role === "user" ? "You" : "AI"}: ${m.text}`)
            .join("\n\n") +
            "\n\nOperations:\n" +
            this.operations.map((o) => `${o.status}: ${o.detail}`).join("\n"),
        );
      } else if (action === "send" || action === "test") {
        if (!this.connection) throw new Error("Connect a provider first.");
        if (!this.model.trim())
          throw new Error(
            "Enter a model ID available to your provider account.",
          );
        let system = AI_SYSTEM,
          prompt;
        if (action === "test") {
          system = "Reply with OK.";
          prompt = "Connection test, no plasmid data.";
        } else {
          this.prepare();
          this.response = "";
          prompt = this.requestPrompt(this.context.source);
        }
        this.pending = true;
        this.proposal = null;
        const epoch = ++this.epoch;
        this.render();
        try {
          const result = await this.api.platform.aiRequest({
            model: this.model.trim(),
            system,
            prompt,
          });
          if (epoch !== this.epoch) return;
          const response = aiResponseText(this.connection.provider, result);
          if (action === "test") this.api.toast("AI connection verified.");
          else {
            this.response = response;
            let explanation = response;
            try {
              explanation = JSON.parse(response).summary || response;
            } catch {}
            this.messages.push(
              { role: "user", text: this.goal.slice(0, 8000) },
              { role: "assistant", text: String(explanation).slice(0, 12000) },
            );
            this.messages = this.messages.slice(-20);
            this.checkSource();
          }
        } catch (error) {
          if (epoch !== this.epoch) return;
          throw error;
        } finally {
          if (epoch === this.epoch) this.pending = false;
        }
        if (epoch !== this.epoch) return;
      } else if (action === "cancel") {
        await this.cancel();
        this.error =
          "Sign-in/request canceled. Provider usage may still be counted.";
      } else if (action === "review") {
        if (!this.context) this.prepare();
        this.checkSource();
        this.proposal = aiProposal(this.response, this.context.source);
      } else if (action === "apply") {
        this.checkSource();
        if (!this.proposal) throw new Error("Review the proposal first.");
        const verified = aiProposal(this.response, this.context.source);
        this.api.addRecords(verified.created);
        this.proposal = null;
        this.context = null;
        this.api.toast(
          "Created AI design copies. Save them as .pcraft after review.",
        );
      } else if (action.startsWith("workflow-")) {
        this.checkSource();
        const t = action.slice(9);
        if (
          !this.proposal?.workflows.includes(t) ||
          !Object.hasOwn(AI_WORKFLOWS, t)
        )
          throw new Error("Review a supported workflow first.");
        this.api.runCommand(AI_WORKFLOWS[t]);
        return;
      } else if (action === "export")
        await this.api.platform.saveFile(
          "PlasmidCraft_AI_response.txt",
          this.response,
        );
      else if (action === "clear") {
        this.response = "";
        this.prompt = "";
        this.goal = "";
        this.task = "";
        this.includeHistory = false;
        this.proposal = null;
        this.context = null;
      } else if (action === "new-chat") {
        await this.cancel();
        this.messages = [];
        this.includeHistory = false;
        this.prompt = "";
        this.goal = "";
        this.task = "";
        this.proposal = null;
        this.context = null;
        this.operations = [];
        this.resultDocuments = [];
        this.toolOutputs = [];
        this.operationStatus = "";
        this.persistConversation();
      } else if (action === "dashboard") {
        await this.api.platform.aiOpenSite("dashboard-" + this.provider);
        return;
      } else if (action.startsWith("site-")) {
        await this.api.platform.aiOpenSite(action.slice(5));
        return;
      }
      this.render();
      if (action === "review") this.jump("response");
    } catch (error) {
      this.error = String(error.message || error);
      this.proposal = null;
      if ($("#ai-workspace") || this.settingsOpen) this.render();
      else this.api.toast(this.error, true);
    }
  }
}
