// The cross-app clipboard: snapshots of elements captured in one app (God
// mode, Shift+C) that can be rebuilt in another. Hosts persist the list
// (~/.morse/clipboard.json, chrome.storage.local); this keeps it bounded.

export const CLIPBOARD_MAX = 20;
const MAX_ITEM_BYTES = 400_000;

export function clipAdd(list, item, max = CLIPBOARD_MAX) {
  if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id) throw new Error("Not a clipboard item");
  if (JSON.stringify(item).length > MAX_ITEM_BYTES) throw new Error("This is too large to capture. Point at a smaller part.");
  const rest = (Array.isArray(list) ? list : []).filter(i => i && i.id !== item.id);
  return [{ ...item, created: item.created || new Date().toISOString() }, ...rest].slice(0, max);
}
