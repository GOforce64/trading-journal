import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest runs without globals here, so Testing Library's automatic cleanup
// never registers; without this, renders pile up across tests.
afterEach(cleanup);
