// REPLAYS OF RECORDS PUBLISHED BEFORE THE WORK-SLOT QUEUE.
//
// exitplan's ground reputation leg now queues behind the final window's grafts
// on the work slot ([XM]); before, it was priced from the join's level beside
// them and the overlap was settled by the window's slot total (which let slot
// work overlap the climb). Every exit published before that change was priced
// on the old accounting, so a replay whose CHECK reproduces a published point
// marks its fixture's exit inputs `slotQueue: false` (exitplan's replay-only
// switch) — the incident it attributes is then replayed on the model that
// produced it. A replay on this switch says nothing about the current model:
// [XM1] and the checks that price decisions on today's inputs do.
//
// Marks every exit-inputs object under `root` (an object with exitLevel and
// incomePerSec) in place and returns `root`.
export function preQueue(root) {
  const seen = new Set();
  const walk = (x) => {
    if (!x || typeof x !== "object" || seen.has(x)) return;
    seen.add(x);
    if ("exitLevel" in x && "incomePerSec" in x && !Array.isArray(x)) x.slotQueue = false;
    for (const v of Object.values(x)) walk(v);
  };
  walk(root);
  return root;
}
