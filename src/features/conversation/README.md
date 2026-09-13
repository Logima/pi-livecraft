# Conversation

`useConversationRuntime` owns state for the selected Pi conversation: snapshots, streamed messages, steering queue reconciliation, activity, tool execution updates, observed durations, event sequences, and replay of snapshot `liveEvents`. It rejects stale snapshot responses and batches assistant deltas with `requestAnimationFrame`.

`App.tsx` keeps only cross-feature Pi effects such as session status, dialogs, Git refreshes, quotas, and notifications. Multiline informational notifications from Pi commands are routed into the selected conversation so command output keeps its original line structure; ordinary notifications remain transient toasts. Live and replayed events pass through that orchestration before reaching the runtime so their ordering and sequence deduplication remain consistent.

Pure protocol, reconciliation, and display rules stay separate:

- `tool-protocol.ts` interprets tool calls and execution updates;
- `message-reconciliation.ts` merges history with live messages;
- `message-display.ts` identifies protocol content visible in the thread;
- `tool-presentation.ts` and `tool-call-presentations/` describe tool-specific display;
- `event-sequence.ts` accepts new sequence numbers and rejects duplicates.

Presentation follows the same ownership boundaries:

- `Conversation.tsx` assembles the thread and owns scrolling and navigation;
- `MessageCard.tsx` renders protocol messages and turn usage;
- `ActivityIndicator.tsx` renders the current Pi activity;
- `Markdown.tsx` owns Markdown and front matter rendering;
- `ToolCallCard.tsx` owns tool state, actions, and expansion;
- `ToolCallOutput.tsx` renders file previews and expanded output;
- `ToolCallEditDiff.tsx` renders edit diffs.

Styles are split by the same surfaces: `conversation.css` for the viewport and empty/loading states, `messages.css`, `tool-call.css`, `conversation-actions.css`, `activity.css`, and `conversation-motion.css`. Composer slash-command styles remain in `composer.css`.

Conversation views are simplified (messages only), semi-detailed (tool headers only; expanded calls show their full output with the existing scroll limits), or detailed (calls with their full output).

## Tool call presentations

Tool calls are composed by `ToolCallCard` in `src/features/conversation/ToolCallCard.tsx`; previews and expanded results live in `ToolCallOutput.tsx`. The presentation is selected by `toolCallPresentation()` in `src/features/conversation/tool-presentation.ts`.

By default, the tool header exposes its full title on hover. Agent calls show their short `description` in the header so delegated work remains identifiable in the conversation and related-session tree. An Agent card exposes an always-visible `Open` action as soon as either its live bridge identity or completed result identifies the persisted child; it remains separate from the compact contextual actions. The header reconciles the initial Agent result with later background notifications to keep a visible running or finished indicator current. Once the call is resolved, its status displays the character counts of its serialized JSON arguments (`↘`) and raw text output (`↗`); these values remain available to hover and screen readers. Resolved tool calls show their full output when expanded from the header; clicking the output itself never collapses it. Expanded output keeps the existing scroll limits and format-specific rendering.

Follow the [step-by-step guide](/docs/HOW-TO-TOOL-PRESENTATION.md) before adding a presentation. Add one only when a tool genuinely provides information that is easier to understand in another form.

## Contextual conversation actions

Messages and tool calls expose contextual actions through explicit composition rather than a registry. `DefaultMessageCard` in `MessageCard.tsx` owns actions on ordinary messages; `ToolCallCard.tsx` owns actions on tool calls. Both reuse the `.conversation-actions` styles in `conversation-actions.css`, which reveal actions on hover or keyboard focus and keep them visible on touch devices. Unknown custom messages rendered by `DefaultCustomMessage` do not currently expose this surface.

Action components are implementations, not the extension contract. `CopyButton.tsx` uses the browser Clipboard API, while `OpenFileButton.tsx` delegates to the local backend so the operating system can launch the file. Both report failures through `onError` and expose accessible labels through the shared `Tooltip` component.

- Text messages expose one copy action when `visibleText()` returns content.
- Forkable user messages expose an action that starts a Pi fork before that prompt, refreshes the
  active branch, and places Pi's returned prompt text in the composer for editing.
- Tool calls always expose their serialized input (`↘`) and expose raw output (`↗`) once a result exists, including error results.
- Successful `read`, `write`, and `edit` calls expose an action that resolves relative paths from the session working directory and opens the resulting file, including absolute targets outside it.
- Pending calls expose a kill action that terminates the tool's child process without aborting the Pi session; they have no output or file action. Directional markers distinguish copy actions without visible button text.

Follow the [conversation action guide](/docs/HOW-TO-CONVERSATION-ACTION.md) to add another action. Keep actions icon-only, keyboard-accessible, colocated with their owning content, and explicit in the relevant renderer. Do not introduce a registry unless actions need genuinely dynamic selection.

## Subagent monitor

`SubagentMonitor` is mounted immediately above the composer and is scoped to the selected parent conversation. `projectSubagentMonitor()` reconciles parent-session `Agent` fallback evidence with the authoritative `pi-livecraft.subagents` status snapshot when present. Bridge rows are keyed by explicit `agentId` and correlate to parent Agent calls through an optional bounded `toolCallId`; they retain a distinct optional `childSessionId`. Exact bridge `toolCallId` correlation has priority. When a foreground registry record omits that ID, Livecraft uses a pure one-to-one fallback over the available description, subagent type/name, requested model, and requested thinking/effort hints; a pair is accepted only when each side has exactly one match, with no time or array-position guessing. Bridge lifecycle and telemetry win over stale parent messages. Successful fallback promotes the provisional row, while ambiguous calls remain distinct and unmapped; provisional rows remain visible briefly when the bridge snapshot has not arrived. A present bridge snapshot also makes its agent membership authoritative: transcript-only running rows absent from the snapshot become `interrupted`; the fallback remains active when the bridge is absent.

The projection exposes only supported facts: description, subagent type/name, requested and effective model, requested thinking/effort, explicit `running`, `interrupted`, `completed`, `failed`, or `cancelled` lifecycle, source-reported duration, tool count, and tokens. Missing telemetry remains absent. Type is available only to row hover and accessible text; description is the visible title. Durations use rounded whole seconds. Active rows remain visible; terminal or otherwise non-running rows are in a compact collapsed history, and each row opens the related child session only through the existing `onOpenAgentSession` callback.

`SessionSummary.subagentBridgeStatus` caches the latest opaque bridge status text in the manager summary. The companion may include only the bounded `toolCallId` correlation field from the registry record; it does not serialize arbitrary record data or session paths. The selected monitor parses it after refresh only when no live bridge snapshot is available; live snapshots still take precedence.

Runs resumed with the same `agentId` reuse one monitor row/session. A running bridge row opens the persisted child transcript with parent/agent/child relation metadata; the manager relays the child session's live events into that ordinary conversation stream and buffers a bounded current turn for mid-turn opens. Terminal or missing bridge rows retain normal snapshot opening. While the relation is running, the opened transcript is read-only except for Stop, which routes the private ownership-checked stop command through the parent manager session. After terminal bridge settlement it becomes an ordinary idle session.
