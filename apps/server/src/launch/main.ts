import { runLaunch } from "./run.js";

/** What the Trading Journal icon runs (launcher spec §3.2). */
process.exitCode = await runLaunch(process.argv.slice(2), process.env).catch((error: unknown) => {
  console.error(error);
  return 1;
});
