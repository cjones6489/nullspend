import { describe, it, expect } from "vitest";
import {
  ACTION_TYPES as DB_ACTION_TYPES,
  ACTION_STATUSES as DB_ACTION_STATUSES,
} from "@nullspend/db";
import {
  ACTION_TYPES as SDK_ACTION_TYPES,
  ACTION_STATUSES as SDK_ACTION_STATUSES,
} from "../../packages/sdk/src/types";

describe("cross-package constant consistency", () => {
  it("ACTION_TYPES match between @nullspend/db and @nullspend/sdk", () => {
    expect([...DB_ACTION_TYPES]).toEqual([...SDK_ACTION_TYPES]);
  });

  it("ACTION_STATUSES match between @nullspend/db and @nullspend/sdk", () => {
    expect([...DB_ACTION_STATUSES]).toEqual([...SDK_ACTION_STATUSES]);
  });
});
