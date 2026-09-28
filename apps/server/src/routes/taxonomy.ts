import { zValidator } from "@hono/zod-validator";
import { createTaxonomyRepo, type Db } from "@tj/db";
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

export function taxonomyRoutes(db: Db, now?: () => number) {
  const repo = createTaxonomyRepo(db, now);
  repo.seedDefaults();

  const setups = new Hono()
    .get("/", (c) => c.json(repo.listSetups()))
    .post("/", zValidator("json", newSetupSchema), (c) => c.json(repo.createSetup(c.req.valid("json")), 201));

  const tags = new Hono()
    .get("/", (c) => c.json(repo.listTags()))
    .post("/", zValidator("json", newTagSchema), (c) => c.json(repo.createTag(c.req.valid("json")), 201));

  return { setups, tags };
}
