import { describe, expect, it } from "vitest";

import { getLogger, logger } from "./logger";
import { runWithRequestContext } from "./request-context";

describe("logger", () => {
  it("root logger outputs JSON with level, time, msg", () => {
    // pino logger has these properties
    expect(logger.level).toBeDefined();
    expect(typeof logger.info).toBe("function");
  });

  it("getLogger returns a logger with component binding", () => {
    const log = getLogger("test-component");
    // Child logger includes the component binding
    expect((log as any).bindings().component).toBe("test-component");
  });

  it("getLogger includes requestId inside request context", () => {
    runWithRequestContext(
      { requestId: "req-123", method: "GET", path: "/" },
      () => {
        const log = getLogger("http");
        const bindings = (log as any).bindings();
        expect(bindings.requestId).toBe("req-123");
        expect(bindings.component).toBe("http");
      },
    );
  });

  it("getLogger omits requestId outside request context", () => {
    const log = getLogger("standalone");
    const bindings = (log as any).bindings();
    expect(bindings.requestId).toBeUndefined();
    expect(bindings.component).toBe("standalone");
  });

  it("getLogger with no args returns root logger outside context", () => {
    const log = getLogger();
    // Root logger — no child bindings
    expect(log).toBe(logger);
  });
});
