/**
 * The name a shortcut is registered under (launcher-keys-palette spec §4): a Latin letter in lower case, a digit,
 * "?", Enter or Escape. On another layout, such as Greek, J types "ξ"; then the physical key names it.
 */
export function keyName(event: Pick<KeyboardEvent, "key" | "code">): string | null {
  const { key, code } = event;
  if (key === "Enter" || key === "Escape" || key === "?") return key;
  if (/^[a-z0-9]$/i.test(key)) return key.toLowerCase();
  if (/^\p{L}$/u.test(key)) return /^Key([A-Z])$/.exec(code)?.[1]?.toLowerCase() ?? null;
  return null;
}
