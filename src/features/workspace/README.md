# Workspace and sessions

`useWorkspaceSessions` owns workspace selection and the session lists shown by the application. It coordinates initial selection, refreshes, creation, reopening, renaming and closing, optimistic naming, pending UI requests, and the local persistence of recent workspaces, completed sessions, and pinned sessions.

`useTabStatus` mirrors all loaded running sessions and finished-unread session counts in the browser title. The title starts with compact counts (`▶2 · ✓3`: running · finished unread). The favicon shows a static ring while running and the unread count (capped at `9+`). It uses no animation timers, so its running indicator remains consistent in background tabs. Completions in the selected session remain unread while the document is hidden and clear when it becomes visible. Focused presentation tests: `test/tab-status.test.ts`.

Keep session-list reconciliation and workspace/session persistence in this controller. `App.tsx` supplies cross-feature callbacks, such as clearing feature state when the workspace changes or preparing an initial composer draft; it should not duplicate the controller's state.

Directory browsing remains in `DirectoryPicker`. Workspace paths accept both `~/...` and Windows `~\...`; completion preserves the separator style the user typed. Pure list and persistence rules live in the neighboring `sidebar-sessions.ts` and `recent-workspaces.ts` modules.
