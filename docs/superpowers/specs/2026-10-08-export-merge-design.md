# Export and Merge — Design Spec

- **Date:** 2026-10-08
- **Status:** Approved on autopilot, 2026-10-08. The user granted it before going to sleep ("do as much as possible without asking… decide what's best"), so the decisions in §2 are mine, made for the user to revisit.
- **Scope:** the parent spec's §12, moving a journal between the user's two machines (Fedora and Windows). It covers:
  - **Export:** a snapshot of everything the user made or synced, as one file;
  - **Merge:** folding such a file into another machine's journal, by the parent spec's rules;
  - the Settings controls and the summary of what a merge did.
- **Parent spec:** [2026-09-22-trading-journal-design.md](2026-09-22-trading-journal-design.md), §12 (and §1's goal "works the same on two machines… with export and merge between them").

---

## 1. Purpose and success criteria

The user trades from a Fedora machine and a Windows one. Each runs its own journal. This lets them carry one machine's work to the other, and back, without losing either side's edits.

**Success:**
- **Settings → Data → Export journal** downloads `journal-{machine}-{YYYY-MM-DD-HHmm}.tjbundle`.
- **Settings → Data → Merge a bundle…** takes that file on the other machine. After a backup, it merges and reads, for example: "Merged journal-fedora-2026-10-08-0912.tjbundle: 12 trades added, 3 updated from the bundle, 2 kept as yours, 1 deleted, 140 fills added."
- **Merging the same bundle twice** changes nothing the second time, and says so.
- **Two journals merged into each other both ways** end up with the same trades, legs, fills, levels, tags and setups.

### Out of scope
- **Attachments.** Screenshots (parent spec §8.5) aren't built, so a bundle has no `attachments/`. The format has a version, so they can come later.
- **Automatic or live sync** between machines. Moving the file is up to the user (USB stick, cloud folder, e-mail).
- **Partial exports** (a date range, a strategy).
- **Secrets, bars and fetched prices.** Secrets never leave a machine (parent spec §5). Bars and a scalp's fetched prices are caches the other machine fetches again.

---

## 2. Decisions

| Question | Decision |
|---|---|
| File format | **gzip-compressed JSON**, not zip: one document, `{ manifest, tables }`. Zip only paid off for attachments, which don't exist yet. Node's zlib does it with no new dependency. |
| Machine name | The computer's hostname, slugged (`fedora`, `desktop-4k2l`), used in the file name and the manifest. No machine id is stored: the merge doesn't need one. |
| Which tables | `accounts`, `setups`, `tags`, `trades`, `legs`, `iron_fly_details`, `scalp_details`, `scalp_targets`, `trade_tags`, `fills`. Left out: `scalp_prices` (refetched), `bars`, `bar_days` (cache), `sync_state` (this machine's sync). |
| A trade's winner | **The whole aggregate** (the trade row, its legs, details, levels, targets and tag links) comes from one side. That side is the one with the larger **version**: `max(edited_at, deleted_at)`, then `updated_at`, then the canonical JSON as a tie-breaker. So a sync-only trade (both stamps null) never beats an edited one, a tombstone beats only older edits, and both directions pick the same winner. |
| Fills | **Union by id.** The same id on both sides keeps the row with the newer `updated_at` (Activity's version replaces Today's), with the canonical JSON as tie-breaker. |
| A synced trade's facts | **The winner's**, as stored. The parent spec says legs and P&L are recomputed from the merged fills, but the merge doesn't regroup. The next IBKR sync on that machine regroups from the merged fills, as it always does. |
| Setups and tags | Newest `updated_at` wins, row by row. Two with the **same name** are the same one, by the app's own rules: a setup's name ignoring case, and a tag's kind and name ignoring case. Every machine seeded the same names with random ids. They keep the **smaller id**, and both sides' references move to it, so both directions converge. |
| Accounts | Newest `updated_at` wins. IBKR accounts already have deterministic ids. |
| A bundle from a newer schema | Refused: "This bundle comes from a newer version of the journal (schema 9; this one is 7). Update this machine first." An **older** one is merged: columns it lacks keep their local value, or their default on a new row. |
| Safety | A backup (`journal-merge-…db`) before writing; one transaction; a bundle that fails validation writes nothing. |
| Where it lives | `packages/db`: `exportBundle(db)` and `mergeBundle(db, bundle)`, pure database work, property-tested. `apps/server`: the two routes, compression, the backup and the schema check. `apps/web`: the Settings Data panel. |

---

## 3. The bundle

```json
{
  "manifest": {
    "format": 1,
    "schema": 7,
    "machine": "fedora",
    "exportedAt": 1791424153150,
    "counts": { "trades": 64, "fills": 410, "...": 0 }
  },
  "tables": {
    "accounts": [ { "id": "…", "name": "IBKR paper", "...": "…" } ],
    "trades": [ "…" ],
    "...": []
  }
}
```

- **Rows** are the database's own rows, with column names in snake_case as SQLite has them, so an older bundle's rows read the same way.
- **Soft-deleted rows travel too.** A tombstone is how a delete reaches the other machine.
- **`schema`** is the number of migrations applied: the journal's last `idx` + 1.
- **The file name** is `journal-{machine}-{YYYY-MM-DD-HHmm}.tjbundle`, in local time.

---

## 4. The merge

The merge works out the **final state of every row from both sides at once**: the union of the local rows and the bundle's, each id resolved by its rule. Then it writes that state. Since it reads both sides the same way, merging A into B and B into A arrive at the same rows (§4's guarantees).

Everything runs in one transaction, in this order:

1. **Validate.** The manifest's `format` must be 1, and its `schema` no newer than this app's. Every table must be an array of objects with string ids. Anything else is refused with "This isn't a journal bundle." and nothing is written.
2. **Accounts.** Insert the unknown ones. For a known one, the newer `updated_at` wins.
3. **Setups and tags.**
   - Resolve each id across both sides: the newer `updated_at` wins, then the canonical JSON.
   - Then group the results by name (§2). A group of several ids keeps the smallest, with the fields of the group's newest row.
   - Every reference on both sides, `trades.setup_id` and `trade_tags.tag_id`, moves to the kept id before trades are compared. Local rows that lose their id are deleted, since their references have moved.
4. **Trades.** For each trade in the bundle:
   - **Unknown:** insert its aggregate (§2).
   - **Known:** compare versions. If the bundle's is larger, replace the local aggregate with it: the trade row, legs, iron fly details, scalp details, targets and tag links. Its `scalp_prices` row is deleted, because the facts may have moved. Otherwise keep the local one.
   - A local trade the bundle doesn't have stays as it is.
5. **Fills.** Union by id (§2). A fill whose `trade_id` names a trade neither side has keeps the id. Fills already carry their `trade_id`.
6. **Summary:**
   - `added`: live trades new to this journal. A tombstone for a trade it never had is stored silently, so later merges know it.
   - `updated`: the bundle's different version replaced a live local one;
   - `kept`: the bundle had a different version, and the local one won;
   - `deleted`: the bundle's tombstone won over a live local trade;
   - `fillsAdded`;
   - `setupsAdded` and `tagsAdded`, counting rows new under their final id;
   - `unchanged`: true when nothing was written.

   Identical versions count in none of these.

**Guarantees,** property-tested with fast-check over generated journals that share some trades, fills, setups and tags, with edits, deletes and syncs on either side:
- **Idempotent:** merging the same bundle again changes nothing (`unchanged: true`, and an identical dump).
- **Order-independent:** for journals A and B, merging A's bundle into B and B's bundle into A gives identical dumps of every exported table.
- **Nothing lost:** every trade, fill, setup and tag on either side is in the result, perhaps under the smaller of two ids.

---

## 5. Server

- **`GET /api/bundle`** answers the gzipped bundle with:
  - `Content-Type: application/gzip`;
  - `Content-Disposition: attachment; filename="journal-fedora-2026-10-08-0912.tjbundle"`.
- **`POST /api/bundle/merge`** takes the file's bytes as the body (`application/octet-stream`, at most 100 MB).
  - It gunzips, parses and validates (§4.1), backs up the database, merges, and answers the summary.
  - A bad file answers 400 with the reason. A newer schema answers 409 with the message from §2.
- **The backup** uses the existing `backupDatabase(dbFile, backupDir, 10, "merge")`, so merge backups are kept apart from import and migration backups.

---

## 6. The Settings Data panel

Under the data directory line:
- **Export journal**: a button that downloads `GET /api/bundle`.
- **Merge a bundle…**: a file picker for `.tjbundle`. Choosing a file sends it at once. While it runs, the panel reads "Merging…".
- **After a merge,** one line reports what happened:
  - "Merged journal-fedora-2026-10-08-0912.tjbundle: 12 trades added, 3 updated from the bundle, 2 kept as yours, 1 deleted, 140 fills added." Zero counts are left out.
  - Or: "Nothing to merge: this journal already has everything in journal-fedora-….tjbundle."
- **A refused file** shows the server's reason in red.
- **After a merge,** every query refetches, so open lists and the queue show the merged trades.

---

## 7. Errors and edge states

| Case | What happens |
|---|---|
| Not gzip, not JSON, or the wrong shape | 400 "This isn't a journal bundle." Nothing is written, and no backup is made. |
| A newer schema | 409 with §2's message. |
| A bundle exported from this same journal | Merges to "Nothing to merge" (idempotent). |
| A huge journal | 100 MB covers years of fills, since a fill is about 1 KB with its raw JSON. |
| A trade deleted on one side, edited later on the other | The edit wins: its stamp is newer. The trade comes back on both sides. |
| A trade deleted on one side, edited earlier on the other | The tombstone wins on both sides. |
| A trade synced on both machines, never edited | The side with the newer `updated_at` wins, so the newer sync's facts win. |

---

## 8. Testing

- **db:** `exportBundle` on a seeded journal; then `mergeBundle`:
  - an empty journal takes everything;
  - a newer local edit is kept, and a newer bundle edit replaces it;
  - tombstones in both directions;
  - fills unioned, and Activity replacing Today's;
  - setups and tags matched by name onto the smaller id, with the references moved;
  - columns missing from an older bundle;
  - a malformed bundle writes nothing;
  - plus the three fast-check properties (§4).
- **server:**
  - the export's headers and file name;
  - a round trip through `POST /api/bundle/merge`;
  - 400 on garbage, 409 on a newer schema;
  - the backup made before a merge, and none for a refused file.
- **web:**
  - Export's link;
  - Merge's upload, its "Merging…" state, and the summary line with zero counts left out;
  - the nothing-to-merge line;
  - a refusal shown in red.
- **Live check:**
  - export the real journal (read-only copy);
  - merge it into an empty scratch journal and back into a copy of itself;
  - time both;
  - check the counts and that the second merge reads "Nothing to merge".
