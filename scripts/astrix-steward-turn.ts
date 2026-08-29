import { loadConfig } from "../src/server/config";

const cfg = loadConfig().trueforge;
const base = cfg.baseUrl.replace(/\/+$/, "");
const headers: Record<string, string> = { "Content-Type": "application/json" };
if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
const astrixBase = (process.env.ASTRIX_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const worldResponse = await fetch(`${astrixBase}/astrix/state`);
const world = await worldResponse.json();
if (!worldResponse.ok) throw new Error(`ASTrix state ${worldResponse.status}: ${JSON.stringify(world)}`);
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
  if (!poll.ok) throw new Error(`turn poll ${poll.status}: ${JSON.stringify(finalBody)}`);
  const state = finalBody?.data?.state;
  if (state?.status === "error" || state?.status === "cancelled") throw new Error(`turn ended ${state.status}: ${JSON.stringify(finalBody)}`);
  if (state?.status === "done") break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (finalBody?.data?.state?.status !== "done") throw new Error(`turn timeout: ${JSON.stringify(finalBody)}`);
console.log(JSON.stringify({ worldRequest: { method: "GET", url: `${astrixBase}/astrix/state` }, world, session: { status: sessionResponse.status, id: sessionId }, turn: { status: turnResponse.status, id: turnId, request: prompt }, elapsedMs: Date.now() - started, response: finalBody }));
