import assert from "node:assert/strict";
import test from "node:test";
import { buildFollowUpPrompt, conversationRootId } from "./follow-ups";

test("follow-up prompt preserves the original request, prior response, and user feedback", () => {
  const prompt = buildFollowUpPrompt({
    originalTitle: "Prepare the launch checklist",
    originalPrompt: "Prepare the launch checklist for the website.",
    priorResponse: "I made a draft, but did not create the checklist.",
    feedback: "You did not do the work. Create the checklist and report the finished file.",
  });

  assert.match(prompt, /Original request[\s\S]*Prepare the launch checklist for the website\./);
  assert.match(prompt, /Prior response[\s\S]*did not create the checklist/);
  assert.match(prompt, /My follow-up[\s\S]*Create the checklist/);
  assert.match(prompt, /Act on my follow-up instead of merely repeating the prior answer/);
});

test("conversation root remains stable across replies", () => {
  assert.equal(conversationRootId({ id: "root", conversationId: null }), "root");
  assert.equal(conversationRootId({ id: "reply-2", conversationId: "root" }), "root");
});
