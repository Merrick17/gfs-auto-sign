import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MESSAGE, draftRecipients, messageHtml } from "./drafts";

test("the owner's message is text in the draft, never markup", () => {
  const html = messageHtml('Hello <b>team</b>\n<a href="https://evil.test">pay</a>');
  assert.ok(!html.includes("<a ") && !html.includes("<b>"));
  assert.equal(html, "Hello &lt;b&gt;team&lt;/b&gt;<br>&lt;a href=&quot;https://evil.test&quot;&gt;pay&lt;/a&gt;");
});

test("an empty message falls back to the default text", () => {
  assert.equal(messageHtml("   "), messageHtml(DEFAULT_MESSAGE));
});

test("recipients: rule To replaces the reply default, CC merges without duplicates or To addresses", () => {
  assert.deepEqual(draftRecipients(null, ["A@gfs.test"]), { to: null, cc: ["a@gfs.test"] });
  assert.deepEqual(draftRecipients({ to: ["X@acme.test", "x@acme.test"], cc: ["x@acme.test", "b@gfs.test"] }, ["b@gfs.test", "c@gfs.test"]), {
    to: ["x@acme.test"],
    cc: ["b@gfs.test", "c@gfs.test"],
  });
});
