import assert from "node:assert/strict";
import test from "node:test";
import { runWorker } from "../src/server/worker/loop";

test("worker stops polling after an in-flight iteration drains", async () => {
  const stop = new AbortController();
  let polls = 0;
  await runWorker(async () => {
    polls += 1;
    stop.abort();
  }, stop.signal);
  assert.equal(polls, 1);
});

test("worker propagates an unexpected poll failure for its supervisor", async () => {
  const stop = new AbortController();
  await assert.rejects(runWorker(async () => {
    throw new Error("poll failed");
  }, stop.signal), /poll failed/);
});
