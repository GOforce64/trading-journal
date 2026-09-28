import type { OptionQuote } from "@tj/core";
import { z } from "zod";
import { type AlpacaKeys, type AlpacaOptions, alpacaGet, DATA_API } from "./http.js";
import type { LatestSource } from "./quotes.js";

const LATEST_OPTION_QUOTES = `${DATA_API}/v1beta1/options/quotes/latest`;

/** Alpaca's own pattern for a contract code. Anything else fails a whole batch with a 400. */
export const CONTRACT = /^[A-Z]{1,5}\d{6,7}[CP]\d{8}$/;

/** Alpaca refuses more symbols than this in one call ("symbol limit is 100"). */
const BATCH = 100;

const latestQuotesSchema = z.object({
  quotes: z.record(
    z.string(),
    z.object({
      bp: z.number().nonnegative(),
      ap: z.number().nonnegative(),
      t: z.iso.datetime({ offset: true }),
    }),
  ),
});

export type OptionQuoteSource = LatestSource<OptionQuote>;

/**
 * Bid and ask per contract from the free plan's indicative feed: quotes derived from OPRA,
 * good enough for an estimate. Unknown and expired contracts are simply left out.
 */
export function alpacaOptionQuotes(keys: AlpacaKeys, options: AlpacaOptions = {}): OptionQuoteSource {
  return {
    async latest(contracts) {
      const wanted = [...new Set(contracts)].filter((contract) => CONTRACT.test(contract));
      const found = new Map<string, OptionQuote>();
      for (let start = 0; start < wanted.length; start += BATCH) {
        const query = new URLSearchParams({
          symbols: wanted.slice(start, start + BATCH).join(","),
          feed: "indicative",
        });
        const reply = latestQuotesSchema.parse(
          await alpacaGet(`${LATEST_OPTION_QUOTES}?${query}`, keys, options),
        );
        for (const [contract, quote] of Object.entries(reply.quotes)) {
          // A missing bid comes as 0, which is what a long leg would fetch. A missing ask is no offer at all.
          found.set(contract, {
            bid: quote.bp,
            ask: quote.ap > 0 ? quote.ap : null,
            at: Date.parse(quote.t),
          });
        }
      }
      return found;
    },
  };
}
