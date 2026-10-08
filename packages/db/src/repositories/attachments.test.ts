import { describe, expect, it } from "vitest";
import { journal, scalp } from "../bundle.fixture.js";
import { createAttachmentsRepo } from "./attachments.js";

const IMAGE = { sha256: "a".repeat(64), ext: "png", mime: "image/png", bytes: 1_234 };

function setup() {
  const j = journal(1_000);
  const repo = createAttachmentsRepo(j.db, () => j.clock.now);
  const trade = j.trades.create(scalp);
  return { ...j, repo, tradeId: trade.id };
}

describe("attachments repository", () => {
  it("attaches screenshots to a trade, oldest first, as an edit of the trade", () => {
    const { repo, trades, clock, tradeId } = setup();
    clock.now = 2_000;
    const first = repo.create(tradeId, IMAGE);
    clock.now = 3_000;
    repo.create(tradeId, { ...IMAGE, sha256: "b".repeat(64), ext: "jpg", mime: "image/jpeg" });
    const trade = trades.get(tradeId);
    expect(trade?.attachments.map((each) => each.sha256)).toEqual(["a".repeat(64), "b".repeat(64)]);
    expect(first).toMatchObject({ tradeId, caption: null, bytes: 1_234, createdAt: 2_000 });
    expect(trade).toMatchObject({ editedAt: 3_000, updatedAt: 3_000 });
  });

  it("captions a screenshot, trimmed, and removes one, each an edit of its trade", () => {
    const { repo, trades, clock, tradeId } = setup();
    const shot = repo.create(tradeId, IMAGE);
    if (!shot) throw new Error("not attached");
    clock.now = 4_000;
    expect(repo.setCaption(shot.id, "  the 09:31 flush  ")?.caption).toBe("the 09:31 flush");
    expect(trades.get(tradeId)?.editedAt).toBe(4_000);
    expect(repo.setCaption(shot.id, "   ")?.caption).toBeNull();
    clock.now = 5_000;
    expect(repo.remove(shot.id)).toBe(true);
    expect(trades.get(tradeId)).toMatchObject({ attachments: [], editedAt: 5_000 });
    expect(repo.remove(shot.id)).toBe(false);
    expect(repo.setCaption(shot.id, "x")).toBeNull();
  });

  it("attaches nothing to a trade that's unknown or deleted", () => {
    const { repo, trades, tradeId } = setup();
    expect(repo.create("nope", IMAGE)).toBeNull();
    trades.softDelete(tradeId);
    expect(repo.create(tradeId, IMAGE)).toBeNull();
  });
});
