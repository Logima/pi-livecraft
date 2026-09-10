# Notifications

`ToastStack` renders application notices and errors. `App.tsx` owns notification state
because backend connectivity, sessions, commands, and multiple features all publish messages.
Features report failures through callbacks such as `onError`; they do not create a parallel global
notification store.

Each toast has a stable id, a `notice` or `error` kind, a message, and an optional session identity.
`App.tsx` filters visibility for the selected session and coordinates explicit dismissal.
`ToastStack` owns only accessible rendering: notices use status semantics, errors use alert
semantics, and every item remains explicitly dismissible.

Keep notification state and cross-feature policy in `App.tsx`. Keep presentation and colocated
styles in this directory.
