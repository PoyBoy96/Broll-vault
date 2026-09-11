const { test } = require("node:test");
const assert = require("node:assert/strict");
const { importJob } = require("./importer.js");
function host() {
  const folder = name => ({ name, items: [], async getItems() { return this.items; },
    createBinAction(name) { return () => this.items.push(folder(name)); } });
  const root = folder("Root"), calls = [];
  const project = { guid: "p1", name: "Test", async getRootItem() { return root; },
    lockedAccess(fn) { fn(); }, executeTransaction(fn) { fn({ addAction: action => action() }); },
    async importFiles(paths, suppressUI, target, numberedStills) {
      assert.equal(suppressUI, true); assert.equal(numberedStills, false);
      calls.push(...paths);
      if (!paths[0].includes("fail")) target.items.push({ async getMediaFilePath() { return paths[0]; }, async isOffline() { return false; } });
    } };
  return { calls, root, Project: { async getActiveProject() { return project; } },
    FolderItem: { cast: item => item.items ? item : null }, ClipProjectItem: { cast: item => item.getMediaFilePath ? item : null } };
}
test("partial receipt, original UNC paths and target-bin duplicates", async () => {
  const ppro = host();
  const job = { project_id: "p1", bin_name: "Test", items: [
    { clip_id: 1, path: "\\\\server\\share\\good.mov", status: "pending" },
    { clip_id: 2, path: "\\\\server\\share\\fail.mov", status: "pending" },
    { clip_id: 3, path: "\\\\server\\share\\missing.mov", status: "missing" } ] };
  assert.deepEqual((await importJob(ppro, job)).map(i => i.status), ["imported", "failed", "missing"]);
  assert.deepEqual((await importJob(ppro, job)).map(i => i.status), ["existing", "failed", "missing"]);
  assert.equal(ppro.calls.filter(p => p === job.items[0].path).length, 1);
  assert.equal(ppro.root.items[0].name, "B-roll Vault");
  assert.equal(ppro.root.items[0].items[0].name, "Test");
});
test("project mismatch prevents bin creation and import", async () => {
  const ppro = host();
  const result = await importJob(ppro, { project_id: "other", bin_name: "Test", items: [
    { clip_id: 1, path: "file.mov", status: "pending" } ] });
  assert.equal(result[0].status, "failed");
  assert.deepEqual(ppro.calls, []); assert.deepEqual(ppro.root.items, []);
});
test("no project produces per-item failure", async () => {
  const ppro = host(); ppro.Project.getActiveProject = async () => null;
  const result = await importJob(ppro, { project_id: "p1", bin_name: "Test", items: [
    { clip_id: 1, path: "file.mov", status: "pending" } ] });
  assert.equal(result[0].status, "failed"); assert.deepEqual(ppro.calls, []);
});
test("offline project item is not reported as already available", async () => {
  const ppro = host();
  const job = { project_id: "p1", bin_name: "Test", items: [{ clip_id: 1, path: "clip.mov", status: "pending" }] };
  await importJob(ppro, job);
  ppro.root.items[0].items[0].items[0].isOffline = async () => true;
  const result = await importJob(ppro, job);
  assert.equal(result[0].status, "imported");
  assert.equal(ppro.calls.length, 2);
});
