import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// SEC-02: route bodies carry up to 5000 road-path points (~200 kB); every other body is well under a kilobyte.
// Body parsing happens before authentication, so these caps are also what an unauthenticated flood can make us buffer.
app.use("/api/routes", express.json({ limit: "512kb" }));
app.use(express.json({ limit: "32kb" }));

app.use("/api", router);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
});

// Body-parser errors carry a `type` and a 4xx status: 413 for an oversized body, 400 for malformed JSON and the rest.
app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  const parse = error as { type?: unknown; status?: unknown } | null;
  if (typeof parse?.type === "string" && typeof parse.status === "number" && parse.status >= 400 && parse.status < 500) {
    if (parse.status === 413) res.status(413).json({ error: "Request body too large", code: "PAYLOAD_TOO_LARGE" });
    else res.status(parse.status).json({ error: "Invalid JSON body", code: "INVALID_REQUEST" });
    return;
  }
  next(error);
});

// Express detects error handlers by their four-argument signature.
app.use((_error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  req.log.error({ code: "internal_error" }, "Unhandled API error");
  res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
});

export default app;
