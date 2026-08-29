import { loadConfig } from "../src/server/config";
import { AstrixWorldState } from "../src/astrix/state";

const cfg = loadConfig().trueforge;
const base = cfg.baseUrl.replace(/\/+$/, "");
const headers: Record<string, string> = { "Content-Type": "application/json" };
if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
const world = new AstrixWorldState().snapshot();
const started = Date.now();

const sessionResponse = await fetch(`${base}/api/v1/sessions`, {
  method: "POST", headers, body: JSON.stringify({ agent: { name: "astrix-steward" } }),
});
const sessionBody = await sessionResponse.json();
if (!sessionResponse.ok) throw new Error(`session ${sessionResponse.status}: ${JSON.stringify(sessionBody)}`);
const sessionId = sessionBody.data?.id;

const prompt = `You are evaluating ASTrix. Inspect this current world state and return one structured JSON decision. Do not mutate anything yet. State: ${JSON.stringify(world)}`;
const turnResponse = await fetch(`${base}/api/v1/sessions/${sessionId}/turns`, {
  method: "POST", headers,
  body: JSON.stringify({ input: [{ type: "user.message", content: prompt }], previous_turn_id: "auto", stream: false }),
});
const turnBody = await turnResponse.json();
if (!turnResponse.ok) throw new Error(`turn ${turnResponse.status}: ${JSON.stringify(turnBody)}`);
const turnId = turnBody.data?.id;

let finalBody: unknown = null;
for (let attempt = 0; attempt < 30; attempt++) {
  const poll = await fetch(`${base}/api/v1/sessions/${sessionId}/turns/${turnId}`, { headers });
  finalBody = await poll.json();
  const state = finalBody?.data?.state;
  if (state?.status === "done" || state?.status === "error" || state?.status === "cancelled") break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
console.log(JSON.stringify({ session: { status: sessionResponse.status, id: sessionId }, turn: { status: turnResponse.status, id: turnId }, elapsedMs: Date.now() - started, response: finalBody }));
