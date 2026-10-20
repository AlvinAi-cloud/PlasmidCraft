# AI design assistant — desktop 0.32

The **AI Assistant** toolbar button toggles a docked panel beside the sequence inspector. It leaves map/sequence editing available. On narrow windows it tiles below the editor. Close with the panel's × button; response and request text remain in the current session. Opening or closing other tool dialogs does not cancel AI work. Closing the AI panel itself cancels pending sign-in/inference and suppresses late responses.

The current-context box follows active documents and selected DNA/features without sending data. **Send** captures current internal context; **Preview outgoing prompt** is available in External AI. Existing responses/proposals remain tied to their original source; changing source DNA requires preparing a new request before applying a proposal.

Use **AI → Accounts and Models…** for connection setup in a separate dialog. It works with the AI panel closed. Configure a provider and model there, click **Done**, then use **Internal AI Operations…** or the toolbar button. The panel has two options: **Internal AI Operations** and **External AI**. Internal mode has message input at the top, operations and results in the middle, and conversation history at the bottom. Each area can scroll independently. Settings and login controls stay in the menu dialog; closing it preserves the active connection and conversation. Closing settings during sign-in cancels that sign-in, while closing it during an ordinary AI request leaves the request running.

Provider, model and endpoint preferences are remembered on this device. In the Mac app, **Remember on this device** is enabled by default: API keys are saved in macOS Keychain and restored automatically at app startup. Reconnect reads local credentials without contacting the AI service. A dismissed, unconnected key draft is cleared. Saved eligible ChatGPT sessions can be activated through the settings dialog without repeating website sign-in when the provider permits it; storage limitations are described below. The panel shows the provider/model connection status without account controls.

Type a request in the message input at the top; Internal AI does not require a workflow prompt. Connected AI uses validated local tools, shows conversation history and an operations summary, and opens changed designs as new unsaved document tabs. **External AI** retains the manual prompt-copy, paste and review workflow. Opening the panel does not submit a request.


## Connect a provider

1. Open **AI → Accounts and Models…**. Choose OpenAI API, Anthropic/Claude API, Google Gemini API, or an OpenAI-compatible endpoint.
2. Enter the provider’s API key. After you finish typing/pasting it, **Available API models** loads automatically; select a model from the dropdown. For compatible services, enter the base URL (ending in `/v1` where required). HTTPS is required except for HTTP localhost endpoints. The preset localhost URL is suitable for an Ollama OpenAI-compatible server; enter the exact installed model name. LM Studio and other compatible services can use their own base URLs. Compatibility depends on their Chat Completions implementation.
3. Leave **Remember on this device (macOS Keychain)** checked and click **Connect and remember**. The key field clears; the native process saves one connection (key, provider, endpoint and initial model) in Keychain under service `org.plasmidcraft.desktop.ai`, account `api-connection`. Remembering a different API connection replaces the previous saved item. The renderer receives only public connection/model status. **Test connection** makes a small, potentially billable request without plasmid data; configuration alone does not prove provider access.
4. **Disconnect for now** clears the active native session and keeps the saved connection for the next app launch. **Forget saved connection** deletes the Keychain item and disconnects. A failed deletion is reported without claiming the key was removed.
5. To avoid persistence, uncheck **Remember on this device** before connecting. That connection ends at app exit. Save/read errors are reported; the app never silently saves a plaintext key or claims secure storage succeeded. Secure API persistence is currently implemented for macOS only. Other platforms must use the explicit session-only choice until their secure storage is implemented.

Provider/model/endpoint preferences are nonsecret values stored in the local app profile. URL credentials, queries and fragments are excluded from saved endpoint preferences. Keys, responses and conversation text are excluded from `.pcraft`/library files and source files. External response drafts remain in memory; internal conversation history is saved locally as described below. Changing the active model in settings is remembered locally for the next reconnect.

The transport uses OpenAI Responses, Claude Messages, Gemini GenerateContent, or OpenAI-compatible Chat Completions. Fixed providers use their official hosts. Redirects are refused, request/response sizes are bounded and requests time out after 120 seconds. Errors do not echo raw provider response bodies or credentials. OpenAI requests set `store:false`; this is not a promise of zero retention by every provider. Provider policies, account access and API charges apply. Inference requests run only when you choose Send or Test. Model discovery makes a separate metadata-only GET request after API-key entry, when opening settings for an active API connection with no cached model list, or when choosing **Refresh model list**. No DNA, document names or prompt text are included in discovery.

Official API contracts: [OpenAI authentication](https://developers.openai.com/api/reference/overview), [Claude API](https://platform.claude.com/docs/en/api/overview), [Gemini GenerateContent](https://ai.google.dev/api/generate-content).

![Internal AI Operations](screenshots/0.32/internal-ai-operations.png)

Interface illustration uses a synthetic test document and a mocked provider.

## Available model picker

The picker queries the configured provider’s current model list rather than shipping a fixed list. Supported routes are [OpenAI Models](https://developers.openai.com/api/reference/resources/models/methods/list), [Claude Models](https://platform.claude.com/docs/en/api/models/list), [Gemini Models](https://ai.google.dev/api/models), and OpenAI-compatible `/models` endpoints. Gemini results are restricted to models advertising `generateContent`; other provider lists may include models unsuitable for this assistant, so choose a text-generation model. Listing a model does not guarantee inference quota or compatibility with the configured generation endpoint; Send/Test reports access errors.

A selected model is retained when refreshing. For a connected or restored API connection, discovery uses the native credential without returning it to the interface. Local servers without a key can use **Refresh model list**. If listing is denied, unavailable or empty, the interface explains the problem and **Enter a model ID manually** remains available. Pagination is bounded to 1,000 unique models/ten pages, a 1 MB page limit and a 20-second overall timeout. Changing provider/key or closing settings discards stale results. Discovery never saves a newly entered key; **Connect and remember** is still the explicit save step.

## Connected conversation and operations

Send a message to the selected API or eligible account connection. Relevant operations run on a private copy of the active DNA document. The original stays unchanged. The assistant can inspect context, annotate from one/all local libraries, edit or extract DNA, design primers, simulate PCR, optimize CDS codons, design mutagenesis with terminal homology, and run Gibson/Golden Gate design using ordered regions of the working copy and explicitly checked additional templates. Select up to two other open DNA templates under Additional DNA templates; unchecked documents are excluded. Missing sequences and design constraints require clarification rather than invented parts.

The application uses a provider-independent JSON tool protocol with existing HTTP transports. Only supported app tools are available; there is no shell, arbitrary code, file-system or network-tool access. Requests are bounded to six rounds and twelve operations, with 40,000-base designs. Tool results are returned to the provider for follow-up when requested. **Share active document DNA with connected AI** is enabled by default; the checkbox can disable it and its state is remembered. DNA/oligo/protein sequences are omitted from context and tool results when disabled. Names, feature locations, operation summaries and selected context are included. Recent conversation is included by default; its checkbox can disable it. Earlier messages can contain DNA.

Each tool result is validated locally. Failed operations or changed source documents discard the uncommitted working copy. **Stop** or closing the panel suppresses late responses and cancels pending inference. The provider may already count usage. A completed run opens new unsaved documents, with **Open document** and **Save .pcraft…** controls. Saving remains a user action. Biological identity and experimental performance require review.

Conversations and operation summaries are saved locally per document content/name using a SHA-256 identifier; they are not synchronized to cloud storage. The store retains up to 20 document conversations with bounded recent messages. Generated document sequences are saved only through ordinary document saving; the history store retains conversational text, which can itself include pasted DNA. **New conversation** clears the current saved thread. Export a conversation for a portable text copy. Credentials are stored separately in the OS secure store.

## External prompt review

**External AI…** retains the manual website workflow. Prepare/copy a prompt, paste its JSON proposal into **Paste external AI JSON proposal**, review the validated actions, then explicitly create the proposed DNA copies. Prompt preparation and JSON proposal pasting are shown together in this mode. External proposals do not automatically execute. Clearing external text preserves internal conversation history. Supported legacy proposals include annotations, primers, guarded DNA replacement, new DNA and links to existing workflow tools.

## Use a website subscription account

The assistant also supports a manual website handoff: **Copy prompt for external AI**, open ChatGPT, Codex, Claude or Gemini, sign in there, paste the prompt, then paste its JSON response back into PlasmidCraft and review it. The static website buttons do not sign the app into your subscription, access account cookies or send the prompt automatically.

### Direct ChatGPT account login

1. Open **AI → Accounts and Models…**, expand **ChatGPT account login**, and click **Continue with ChatGPT**. Complete the official sign-in/consent page in your system browser. The app receives a loopback callback and returns focus to its window.
2. Select an account-provided model. Only models returned for that account are listed; PlasmidCraft does not guess which models a plan includes. **Test connection** makes a small request and consumes plan quota. No plasmid DNA is included in this test.
3. Type a request in Internal AI Operations and choose Send. Requests use the selected account's authorized plan access. Missing consent, ineligible accounts, model restrictions or quota limits are reported; the app never switches automatically to paid API-key billing.
4. Use the saved-account selector and **Use saved session** to reconnect after restarting. **Sign in again / grant plan access** requests fresh authorization for that registration. **Sign out selected account** attempts server revocation and removes local credentials. If revocation cannot be confirmed, the notice says so; review connected apps in your account as needed.

This implements OpenAI's documented eligible open-source [plan sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [account/session handling](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), and [streamed inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference). Eligibility is controlled by OpenAI and has not been confirmed for this unpublished local app. A ChatGPT subscription alone does not guarantee access through every third-party application. Identity-only login can succeed while plan inference remains disabled; reauthorize if the account is eligible but has not granted the necessary scopes.

Native sign-in uses PKCE, state and nonce, validates signed ID tokens against discovery/JWKS, and binds credentials to the issued application client and verified account subject. Matching email addresses never merge registrations. Refreshes are serialized across app processes and rotating credentials are saved atomically. The renderer receives public status/model information, never access or refresh tokens. Credentials are not borrowed from Codex, copied from browser cookies, included in project files, or written into source files.

On macOS, login tokens are stored in **Keychain** under `org.plasmidcraft.desktop.chatgpt`. Nonsecret registration metadata is in the app configuration directory's `chatgpt/accounts.json`, with owner-only file permissions. If Keychain storage is unavailable, a notice explains that the session is held only in native memory. Windows/Linux currently use session memory only; secure persistent storage there remains future work. A synthetic macOS Keychain save/read/update/delete test passes on the development Mac. Live ChatGPT account login has not been exercised.

ChatGPT plan requests use streamed Responses with `store:false` and require a completed response. Cancel stops waiting for inference, though provider usage may already have occurred. An in-progress token renewal finishes saving rotating credentials before cancellation is applied. Model listing and sign-in contact the provider without sending document DNA. Other providers continue to use their supported API-key routes or manual website handoff.

## Verification

The provider adapters, context whitelist and proposal validation have unit checks. The UI is exercised with a simulated native bridge. Native tests cover loopback callbacks, JWT validation, account isolation, storage failures, token replacement, supported request bodies and streamed response handling; API-key HTTP transport also uses a local mock server. No real key, paid request or private plasmid upload was used during development. Live provider/account acceptance and native-window UI acceptance remain pending.

External AI offers **Design plasmid** for a guided request and **Other tasks** for an open-ended request under **Choose a starting point…**. Edit the message before sending. Selecting a starting point does not send a request.

The External AI workflow list begins with **Review plasmid**, then **Design plasmid**; **Other tasks** is last. The other workflows retain their order. The **Message input** box starts at approximately 128 pixels tall and can be resized vertically.

Conversation history displays newest messages first. Internal tools include CDS inspection and verified amino-acid range replacement with host-preferred codons only for replaced residues. Duplicate identical JSON operation envelopes execute once; malformed envelopes are retried once without being displayed as chat. Operations are checked locally and changed results open as unsaved documents. The Inspector separates readable descriptions from detailed provenance.
