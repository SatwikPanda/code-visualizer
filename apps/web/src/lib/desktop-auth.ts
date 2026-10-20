import { timingSafeEqual } from "node:crypto";
export function desktopTokenMatches(
  expected: string | undefined,
  actual: string | undefined,
) {
  if (!expected) return true;
  if (!actual) return false;
  const a = Buffer.from(expected),
    b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}
