import {
  hashPasswordStrong,
  needsPasswordRehash,
  verifyPasswordAsync,
} from "../database.js";
import { findLoginAccount } from "./accounts.js";

const sources = new Set(["txt", "database"]);
const dummyPasswordHash =
  "scrypt$32768$8$3$green-link-dummy!$8Z6BqoPTziC3uarUsi-Cff88NXexvz5pbLYe1nn76qQDxr0djXlPzohcKgmqafIZVziYOV6LYr--PYcxcq6rGA";

export function createLoginAuthenticator({
  db,
  source = process.env.LOGIN_ACCOUNT_SOURCE || "database",
} = {}) {
  if (!db)
    throw new Error("Login authenticator requires a database connection.");
  if (!sources.has(source))
    throw new Error("LOGIN_ACCOUNT_SOURCE must be txt or database.");

  return Object.freeze({
    source,
    async authenticate(email, password) {
      if (source === "txt") return findLoginAccount(email, password) || null;

      const user = await db
        .prepare("SELECT id,role,status,password_hash FROM users WHERE email=?")
        .get(email);
      if (!user) {
        await verifyPasswordAsync(password, dummyPasswordHash);
        return null;
      }
      if (!(await verifyPasswordAsync(password, user.password_hash)))
        return null;
      if (user.status !== "active") return null;
      if (needsPasswordRehash(user.password_hash)) {
        const upgraded = await hashPasswordStrong(password);
        await db
          .prepare(
            "UPDATE users SET password_hash=?,password_changed_at=?,updated_at=? WHERE id=? AND password_hash=?",
          )
          .run(
            upgraded,
            new Date().toISOString(),
            new Date().toISOString(),
            user.id,
            user.password_hash,
          );
      }
      return { id: user.id, role: user.role };
    },
  });
}
