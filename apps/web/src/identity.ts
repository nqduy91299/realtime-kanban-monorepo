/**
 * Who you are on the board. Auth is out of scope (§12), so it's just a name kept in this
 * browser. The color is derived from the name, so it stays the same across reloads (P1).
 */

// Dark enough that white text on them passes WCAG AA, and readable on both themes.
const COLORS = ["#c2255c", "#1864ab", "#087f5b", "#d9480f", "#6741d9", "#0b7285", "#a61e4d", "#862e9c"];

const ADJECTIVES = ["Quiet", "Swift", "Brave", "Calm", "Clever", "Sunny", "Bold", "Gentle"];
const ANIMALS = ["Otter", "Falcon", "Panda", "Fox", "Heron", "Lynx", "Koala", "Owl"];

const KEY = "kanban:name";

export function colorFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (Math.imul(hash, 31) + ch.codePointAt(0)!) | 0;
  return COLORS[Math.abs(hash) % COLORS.length]!;
}

export function loadName(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved;
  } catch {
    // storage blocked: fall through to a random name
  }
  const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]!;
  const name = `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
  saveName(name);
  return name;
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // not persisted; fine
  }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : (parts[0] ?? "?").slice(0, 2)).toUpperCase();
}
