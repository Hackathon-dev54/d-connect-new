import { createApp } from "../src/app-server";

const app = createApp();

function resolveRequestUrl(req: any): string {
  let url = req.url || "/";

  // If req.url is already a valid specific API route, keep it
  if (
    url.startsWith("/api/") &&
    url !== "/api/" &&
    !url.startsWith("/api/index") &&
    !url.startsWith("/api/[...all]")
  ) {
    return url;
  }
  if (url.startsWith("/.well-known/")) {
    return url;
  }

  // Check if req.query.all is present (from Vercel [...all].ts)
  if (req.query && req.query.all) {
    const sub = Array.isArray(req.query.all) ? req.query.all.join("/") : req.query.all;
    const queryIdx = url.indexOf("?");
    const queryPart = queryIdx !== -1 ? url.slice(queryIdx) : "";
    return `/api/${sub}${queryPart}`;
  }

  // Check Vercel forward headers
  const fwd = req.headers["x-forwarded-url"] || req.headers["x-invoke-path"];
  if (fwd && typeof fwd === "string" && (fwd.startsWith("/api/") || fwd.startsWith("/.well-known/"))) {
    return fwd;
  }

  const matched = req.headers["x-matched-path"];
  if (matched && typeof matched === "string" && matched.startsWith("/api/") && !matched.includes("index")) {
    const queryIdx = url.indexOf("?");
    const queryPart = queryIdx !== -1 ? url.slice(queryIdx) : "";
    return matched + queryPart;
  }

  return url;
}

export default function handler(req: any, res: any) {
  // 1. Ensure CORS headers are present
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, x-neon-db-url");
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

  // 3. Resolve requested endpoint accurately
  req.url = resolveRequestUrl(req);

  try {
    return (app as any)(req, res);
  } catch (err: any) {
    console.error("Vercel serverless uncaught error:", err);
    if (!res.headersSent) {
      res.statusCode = 200; // Return 200 with error payload so client can display details instead of blank 500
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: err.message || "Internal server error", failed: true }));
    }
  }
}

