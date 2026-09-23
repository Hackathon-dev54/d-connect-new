import { createApp } from "../src/app-server";

const app = createApp();

export default function handler(req: any, res: any) {
  // 1. Ensure CORS headers are present
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  // 2. Prevent Express body-parser from hanging on Vercel's pre-consumed stream
  if (req.body && req._body === undefined) {
    req._body = true;
  }

  // 3. Restore original requested URL when Vercel rewrites /api/* to /api/index
  const matchedPath =
    (req.headers["x-matched-path"] as string) ||
    (req.headers["x-vercel-matched-path"] as string) ||
    (req.headers["x-invoke-path"] as string);

  const queryString = req.url && req.url.includes("?") ? "?" + req.url.split("?")[1] : "";

  if (matchedPath && matchedPath.startsWith("/api/")) {
    req.url = matchedPath + queryString;
  } else if (req.url && (req.url === "/api" || req.url === "/api/" || req.url.includes("index") || req.url.includes("[...all]"))) {
    if (matchedPath) {
      req.url = matchedPath + queryString;
    } else if (req.query && req.query.all) {
      const sub = Array.isArray(req.query.all) ? req.query.all.join("/") : req.query.all;
      req.url = `/api/${sub}` + queryString;
    }
  }

  try {
    return (app as any)(req, res);
  } catch (err: any) {
    console.error("Vercel serverless uncaught error:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: err.message || "Internal server error" }));
    }
  }
}
