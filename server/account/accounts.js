import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const defaultFile = fileURLToPath(new URL("./accounts.txt", import.meta.url));
const roles = new Map([
  ["관리자", { id: "admin", role: "admin" }],
  ["일반", { id: "u1", role: "user" }],
  ["농장주", { id: "farmer-a", role: "user" }],
]);

export function readLoginAccounts(
  filePath = process.env.LOGIN_ACCOUNTS_FILE || defaultFile,
) {
  const accounts = readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line, index) => {
      const [kind, email, password, ...extra] = line
        .split("|")
        .map((value) => value.trim());
      const identity = roles.get(kind);
      if (!identity || !email || !password || extra.length)
        throw new Error(
          `로그인 계정 파일 ${index + 1}번 항목 형식이 올바르지 않습니다.`,
        );
      return {
        ...identity,
        email: email.toLowerCase(),
        password,
      };
    });

  if (!accounts.length)
    throw new Error("로그인 계정 파일에 사용할 계정이 없습니다.");
  if (new Set(accounts.map(({ email }) => email)).size !== accounts.length)
    throw new Error("로그인 계정 파일에 중복된 이메일이 있습니다.");
  return accounts;
}

export function findLoginAccount(email, password) {
  return readLoginAccounts().find(
    (account) => account.email === email && account.password === password,
  );
}
