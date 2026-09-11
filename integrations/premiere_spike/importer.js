/* Host-independent entry point also exercised by the Node test doubles. */
function pathKey(value) { return String(value || "").replace(/\//g, "\\").toLowerCase(); }
async function projectInfo(ppro) {
  const project = await ppro.Project.getActiveProject();
  return { project, project_id: project ? String(project.guid) : "", project_name: project ? project.name : "" };
}
async function findFolder(ppro, parent, name) {
  for (const item of await parent.getItems()) {
    if (item.name !== name) continue;
    try { const folder = ppro.FolderItem.cast(item); if (folder) return folder; } catch (_) { /* clip */ }
  }
  return null;
}
async function ensureFolder(ppro, project, parent, name) {
  let folder = await findFolder(ppro, parent, name);
  if (folder) return folder;
  project.lockedAccess(() => {
    project.executeTransaction(action => action.addAction(parent.createBinAction(name, false)), "Vault: create bin");
  });
  folder = await findFolder(ppro, parent, name);
  if (!folder) throw new Error("Could not create editor bin: " + name);
  return folder;
}
async function containsPath(ppro, folder, path) {
  for (const item of await folder.getItems()) {
    let clip;
    try { clip = ppro.ClipProjectItem.cast(item); } catch (_) { continue; }
    if (clip && pathKey(await clip.getMediaFilePath()) === pathKey(path) && !(await clip.isOffline())) return true;
  }
  return false;
}
async function importJob(ppro, job) {
  const results = [];
  try {
    const info = await projectInfo(ppro);
    if (info.project_id !== job.project_id) throw new Error("Active project changed before import");
    const parent = await ensureFolder(ppro, info.project, await info.project.getRootItem(), "B-roll Vault");
    const target = await ensureFolder(ppro, info.project, parent, job.bin_name);
    for (const item of job.items) {
      const result = { clip_id: item.clip_id, status: "failed", message: "" };
      try {
        if (item.status === "missing") result.status = "missing";
        else {
          if ((await projectInfo(ppro)).project_id !== job.project_id) throw new Error("Active project changed during import");
          if (await containsPath(ppro, target, item.path)) result.status = "existing";
          else {
            await info.project.importFiles([item.path], true, target, false);
            if (!(await containsPath(ppro, target, item.path))) throw new Error("Import was not confirmed in the target bin");
            result.status = "imported";
          }
        }
      } catch (error) { result.message = String(error.message || error); }
      results.push(result);
    }
  } catch (error) {
    return job.items.map(item => ({ clip_id: item.clip_id, status: item.status === "missing" ? "missing" : "failed", message: String(error.message || error) }));
  }
  return results;
}
if (typeof module !== "undefined") module.exports = { importJob, projectInfo };
