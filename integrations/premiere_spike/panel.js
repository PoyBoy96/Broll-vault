const ppro = require("premierepro");
const uxp = require("uxp");
const importer = require("./importer.js");
const clientId = "premiere-" + Date.now() + "-" + Math.random().toString(36).slice(2);
let token = "", enabled = false, busy = false, timer = null, pending = null;
const el = id => document.getElementById(id);
async function call(action, body) {
  const response = await fetch("http://127.0.0.1:8010/api/spike/" + action, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || ("HTTP " + response.status));
  return data;
}
async function poll() {
  if (!enabled || busy) return;
  busy = true;
  try {
    // A lost response retries this receipt, never the import itself.
    if (pending) {
      await call("result", pending);
      el("receipt").textContent = pending.items.map(i => i.clip_id + ": " + i.status + (i.message ? " — " + i.message : "")).join("\n");
      pending = null;
    }
    const info = await importer.projectInfo(ppro);
    await call("heartbeat", { editor: "premiere", client_id: clientId, version: String(uxp.host.version),
      project_id: info.project_id, project_name: info.project_name });
    el("status").textContent = info.project_id ? "Connected · " + info.project_name : "Connected · Open a Premiere project";
    if (!info.project_id || !enabled) return;
    const { job } = await call("claim", { editor: "premiere", client_id: clientId, project_id: info.project_id });
    if (job) {
      pending = { editor: "premiere", client_id: clientId, job_id: job.id, claim_id: job.claim_id,
        project_id: job.project_id, items: await importer.importJob(ppro, job) };
      el("status").textContent = "Import finished · receipt pending";
    }
  } catch (error) { el("status").textContent = "Needs attention · " + String(error.message || error); }
  finally { busy = false; if (enabled) timer = setTimeout(poll, 2000); }
}
function stop() { enabled = false; clearTimeout(timer); }
el("connect").addEventListener("click", () => {
  if (busy) return;
  stop(); token = el("token").value.trim(); enabled = true; poll();
});
el("disconnect").addEventListener("click", () => { stop(); el("status").textContent = "Disconnected"; });
uxp.entrypoints.setup({ panels: { vaultSpike: { hide: stop, destroy: stop } } });
