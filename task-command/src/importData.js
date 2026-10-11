// Import and backup helpers.
// Two formats are accepted:
// 1. A Daily Compass backup: { items: [...], checkins: {...}, holdings: [...], pf: {...}, snaps: {...} }
// 2. The old task list: [ { text, area | category, priority: now|soon|later|high|medium|low, done, pinned, created } ]

const COLLECTIONS = ["items", "checkins", "holdings", "pf", "snaps"];
const LISTS = ["items", "holdings"]; // stored as arrays of {id, ...}; the others are {id: data}

const PRIO_MAP = { now: "high", soon: "normal", later: "low", asap: "asap", high: "high", medium: "normal", normal: "normal", low: "low" };
const squash = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
const CAT_MAP = {
  work: "Work", business: "Work",
  finance: "Finance", investments: "Finance", investment: "Finance",
  family: "Family",
  personal: "Personal", others: "Personal", other: "Personal",
};

function toTime(v) {
  const t = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(t) ? t : Date.now();
}

/** Returns [{coll, id, data}] ready to save. Throws an Error with a friendly message. */
export function importToDocs(text, S, uid) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That isn't valid JSON. Paste the whole thing, from the first [ or { to the last ] or }.");
  }

  if (Array.isArray(raw)) return fromOldTaskList(raw, S, uid);

  if (raw && typeof raw === "object" && COLLECTIONS.some((c) => c in raw)) {
    const docs = [];
    for (const coll of COLLECTIONS) {
      const v = raw[coll];
      if (!v) continue;
      if (LISTS.includes(coll)) {
        for (const x of v) {
          if (!x || typeof x !== "object") continue;
          const { id, ...data } = x;
          docs.push({ coll, id: String(id || uid()), data });
        }
      } else {
        for (const [id, data] of Object.entries(v)) docs.push({ coll, id, data });
      }
    }
    return docs;
  }
  throw new Error("Expected a Daily Compass backup { \"items\": [...] } or a task list [ ... ].");
}

function fromOldTaskList(list, S, uid) {
  let freeSlots = 5 - S.items.filter((x) => x.type === "tasks" && x.star && !x.done).length;
  const docs = [];
  for (const x of list) {
    if (!x || typeof x !== "object") continue;
    const title = String(x.text ?? x.title ?? "").trim();
    if (!title) continue;
    const done = Boolean(x.done);
    const createdAt = toTime(x.created ?? x.createdAt);
    const prio = PRIO_MAP[squash(x.priority ?? x.prio)] ?? "normal";
    const area = squash(x.area ?? x.category);
    const base = { title, prio, done, createdAt, doneAt: done ? Date.now() : null, due: "" };

    if (area === "wishlist") {
      docs.push({ coll: "items", id: uid(), data: { ...base, type: "wishes", price: "", link: "" } });
      continue;
    }
    const star = Boolean(x.pinned) && !done && freeSlots > 0;
    if (star) freeSlots--;
    docs.push({ coll: "items", id: uid(), data: { ...base, type: "tasks", cat: CAT_MAP[area] ?? "Personal", star } });
  }
  return docs;
}

export function backupJSON(S) {
  const { items, checkins, holdings, pf, snaps } = S;
  return JSON.stringify({ app: "daily-compass", exportedAt: new Date().toISOString(), items, checkins, holdings, pf, snaps }, null, 1);
}
