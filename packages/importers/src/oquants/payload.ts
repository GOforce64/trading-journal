import { z } from "zod";

export const OQUANTS_FORMAT = "oquants-cells/1";

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const cells = z.array(z.string());

/** What scripts/oquants-extract.js copies: raw cell text, interpreted only by the parser. */
export const oquantsPayloadSchema = z.object({
  format: z.literal(OQUANTS_FORMAT),
  capturedAt: z.string(),
  timeZone: z.string().refine(isTimeZone, "unknown time zone"),
  pageCounter: z.string(),
  headers: cells,
  trades: z.array(
    z.object({
      ticker: z.string(),
      cells,
      designerHref: z.string(),
      legs: z.array(z.object({ cells })),
    }),
  ),
});

export type OquantsPayload = z.infer<typeof oquantsPayloadSchema>;
export type OquantsTradeCells = OquantsPayload["trades"][number];

/** A column the parser needs is gone: oQuants changed its table and nothing can be read safely. */
export class OquantsFormatError extends Error {}
