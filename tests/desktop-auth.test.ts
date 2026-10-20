import { test } from "node:test";
import assert from "node:assert/strict";
import { desktopTokenMatches } from "../apps/web/src/lib/desktop-auth";
test("desktop authentication is required only in desktop mode and rejects missing, partial, or incorrect tokens", () => {
  assert.equal(desktopTokenMatches(undefined, undefined), true);
  assert.equal(desktopTokenMatches("private-session-token", undefined), false);
  assert.equal(desktopTokenMatches("private-session-token", "private"), false);
  assert.equal(
    desktopTokenMatches("private-session-token", "private-session-tokee"),
    false,
  );
  assert.equal(
    desktopTokenMatches("private-session-token", "private-session-token"),
    true,
  );
});
