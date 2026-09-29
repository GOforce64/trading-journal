import { zValidator } from "@hono/zod-validator";
import { createTaxonomyRepo, type Db, DuplicateNameError } from "@tj/db";
import { Hono } from "hono";
import { z } from "zod";

const newSetupSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().max(500).nullish(),
  strategy: z.enum(["scalp", "iron_fly"]).nullish(),
});

const newTagSchema = z.object({
  name: z.string().trim().min(1).max(40),
  kind: z.enum(["mistake", "emotion"]),
});

/** Archived items are listed only on request: the pickers and the Playbook ask for them (scalp-review spec §6.3). */
const listQuerySchema = z.object({ includeArchived: z.enum(["true"]).optional() });

const setupPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().max(500).nullable(),
    strategy: z.enum(["scalp", "iron_fly"]).nullable(),
    archived: z.boolean(),
  })
  .partial();

/** A tag's kind never changes. */
const tagPatchSchema = z.object({ name: z.string().trim().min(1).max(40), archived: z.boolean() }).partial();

export function taxonomyRoutes(db: Db, now?: () => number) {
  const repo = createTaxonomyRepo(db, now);
  repo.seedDefaults();

  const setups = new Hono()
    .get("/", zValidator("query", listQuerySchema), (c) =>
      c.json(repo.listSetups({ includeArchived: c.req.valid("query").includeArchived === "true" })),
    )
    .post("/", zValidator("json", newSetupSchema), (c) => {
      try {
        return c.json(repo.createSetup(c.req.valid("json")), 201);
      } catch (error) {
        if (error instanceof DuplicateNameError)
          return c.json({ error: "duplicate", message: error.message }, 409);
        throw error;
      }
    })
    .patch("/:id", zValidator("json", setupPatchSchema), (c) => {
      try {
        const updated = repo.updateSetup(c.req.param("id"), c.req.valid("json"));
        return updated ? c.json(updated) : c.json({ error: "not found" }, 404);
      } catch (error) {
        if (error instanceof DuplicateNameError)
          return c.json({ error: "duplicate", message: error.message }, 409);
        throw error;
      }
    });

  const tags = new Hono()
    .get("/", zValidator("query", listQuerySchema), (c) =>
      c.json(repo.listTags({ includeArchived: c.req.valid("query").includeArchived === "true" })),
    )
    .post("/", zValidator("json", newTagSchema), (c) => {
      try {
        return c.json(repo.createTag(c.req.valid("json")), 201);
      } catch (error) {
        if (error instanceof DuplicateNameError)
          return c.json({ error: "duplicate", message: error.message }, 409);
        throw error;
      }
    })
    .patch("/:id", zValidator("json", tagPatchSchema), (c) => {
      try {
        const updated = repo.updateTag(c.req.param("id"), c.req.valid("json"));
        return updated ? c.json(updated) : c.json({ error: "not found" }, 404);
      } catch (error) {
        if (error instanceof DuplicateNameError)
          return c.json({ error: "duplicate", message: error.message }, 409);
        throw error;
      }
    });

  return { setups, tags };
}
