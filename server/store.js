// Backward-compatible name used by the application and tests.
// The implementation is a transactional SQLite database, not a JSON store.
export { createDatabase as createStore } from "./database.js";
