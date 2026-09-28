import { createHash } from "node:crypto";

/** Fixed namespace for oQuants trade ids; changing it would re-import everything as new. */
export const OQUANTS_NAMESPACE = "b92b0110-2258-4151-8c35-73de08de03ca";

/** RFC 4122 version 5 (SHA-1, name-based) UUID: the same name always gives the same id. */
export function uuidV5(name: string, namespace: string): string {
  const bytes = createHash("sha1")
    .update(Buffer.from(namespace.replace(/-/g, ""), "hex"))
    .update(name, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
