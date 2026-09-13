# Project architecture

Pi Livecraft separates the interface, local HTTP API, and Pi processes so that restarting the frontend or backend does not close active sessions.

```text
React browser
    │ HTTP + SSE
    ▼
server/backend.ts ─── JSON Lines over local TCP ──▶ server/manager.ts ─── Pi public RPC ──▶ pi --mode rpc
                                                        ▲
                                                        │ starts; replaces only after an accepted restart
                                             server/manager-supervisor.ts
```

## Frontend

`src/App.tsx` remains the cross-cutting orchestrator: it receives the SSE stream, applies effects that span features (dialogs, Git, quotas, notifications, and manager state), and connects the panels. Workspace/session lifecycle belongs to `useWorkspaceSessions`; selected-conversation snapshots, replay, streaming, and tool execution state belong to `useConversationRuntime`. Area-specific logic and rendering live in `src/features/`:

- `composer/` — input, commands, and image preparation;
- `conversation/` — history, activity, usage, and tool calls;
- `dialogs/` — extension questionnaires and dialogs;
- `git/` — Git widget state and diffs;
- `manager/` — persistent runtime update and restart notice;
- `right-sidebar/` — integrated widgets, rail actions, collapse state, and resizing;
- `workspace/` — directory selection and recent sessions.

Use the [`src/features/` map](/src/features/README.md) to locate frontend ownership. Features with non-obvious contracts add a short README beside their code rather than expanding this system overview.

`src/api.ts` is the frontend's only HTTP and SSE boundary. It owns request encoding, error conversion, manager-event parsing and validation, and the `EventSource` subscription while leaving native reconnection intact. A component does not communicate directly with the manager or a Pi process.

`src/App.css` orders the stylesheets. Global and responsive rules live in `src/styles/`; feature-specific rules are colocated with their feature.

## Backend and manager

`server/backend.ts` exposes the web API, validates HTTP requests, serves the build, and broadcasts SSE events. Domain behavior for Git, quotas, terminal launching, and todos lives in `server/features/`; route definitions remain in the backend. Other neighboring modules provide workspace files, recent sessions, and system integrations.

`server/manager.ts` is the sole owner of `pi --mode rpc` processes. `server/pi-process.ts` starts them with the extensions from `pi-extensions/`, while `server/manager-client.ts` carries backend requests over local JSON Lines. Keeping this ownership outside the backend preserves Pi sessions across backend restarts.

`server/manager-supervisor.ts` starts the manager with the SHA-256 revision of the files declared in `server/manager-runtime-files.json`. It never replaces the manager because files changed or because it crashed: replacement happens only when the manager accepts a restart request and exits with the reserved code. After a crash, the supervisor stays alive and the backend reports the outage.

`server/manager-runtime-monitor.ts` runs in the backend. It compares the running revision with the current declared files, emits `manager_status` through SSE, and coordinates the guarded restart. The manager reconciles live Pi state and rejects the restart while work is active; the monitor rejects concurrent restart requests. Once accepted, the manager closes its Pi children before the supervisor starts the replacement; closed idle sessions remain available in history. The focused [manager lifecycle guide](/docs/MANAGER-LIFECYCLE.md) documents this contract and its validation.

## Shared contracts

`shared/` contains types and protocols exchanged between layers. HTTP, SSE, manager, and RPC formats are observable contracts: an internal move must not change them implicitly. The `pi-livecraft.subagents` status contract carries only bounded browser-safe agent data, including optional `toolCallId` correlation from the companion registry; it never carries session paths or arbitrary registry records. Subagent monitor opens carry only browser-safe parent/agent/child relation IDs; `shared/subagent-relay.ts` bounds and validates the child event envelope relayed by the manager.

## Main flows

1. The frontend calls a function from `src/api.ts`.
2. `server/backend.ts` validates the request and handles local capabilities directly, or forwards it to the manager.
3. The manager creates, reopens, or commands the relevant Pi process.
4. Pi events travel back to the backend and then to the browser through SSE. The manager may route a bounded child event from the parent companion into the related child session's normal event stream.
5. `App` updates cross-cutting state and delegates rendering to the relevant feature.

## Where to make a change

- New contextual message or tool call action: compose it in `DefaultMessageCard` or `ToolCallCard` and reuse the conversation action styles; follow [`HOW-TO-CONVERSATION-ACTION.md`](/docs/HOW-TO-CONVERSATION-ACTION.md).
- New tool presentation: `src/features/conversation/tool-call-presentations/<tool>.ts`, register in `index.ts`, then its focused test.
- New conversation or composer behavior: the relevant feature, without growing `App` when the state is not cross-cutting.
- New palette command, widget command, or shortcut: read [`../src/features/commands/README.md`](/src/features/commands/README.md).
- New preference or persisted UI state: read [`../src/features/settings/README.md`](/src/features/settings/README.md).
- New right widget: read [`../src/features/right-sidebar/README.md`](/src/features/right-sidebar/README.md).
- Existing local capability: its module under `server/features/`, after reading [`../server/features/README.md`](/server/features/README.md).
- New local route: `server/backend.ts`, then `src/api.ts` if the frontend uses it.
- Manager or Pi process behavior: `server/manager.ts` or `server/pi-process.ts`; keep `server/manager-runtime-files.json` aligned with runtime imports.
- Manager supervision or restart protocol: `server/manager-supervisor.ts` and `server/manager-runtime-monitor.ts`, after explicit approval because this changes the interruption boundary.
