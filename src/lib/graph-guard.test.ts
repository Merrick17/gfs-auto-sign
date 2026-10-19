import assert from "node:assert/strict";
import { test } from "node:test";
import { SendBlocked, graph } from "./graph";

test("the Graph client refuses every send or forward endpoint before any request is made", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => void calls++) as unknown as typeof fetch;
  try {
    for (const p of ["/me/sendMail", "/me/messages/abc/send", "/me/messages/abc/forward", "/me/messages/abc/createForward", "/me/messages/abc/send?x=1"])
      await assert.rejects(graph(p, { method: "POST" }), SendBlocked);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = real;
  }
});
