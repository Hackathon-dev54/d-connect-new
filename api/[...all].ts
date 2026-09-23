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

  // 3. Accurately resolve requested endpoint without replacing with [...all]
  let routeParam = req.query?.__route__ || req.query?.__path;
  if (!routeParam && req.url && req.url.includes("?")) {
    try {
      const u = new URL(req.url, "http://localhost");
      routeParam = u.searchParams.get("__route__") || u.searchParams.get("__path") || u.searchParams.get("path");
    } catch (_) {}
  }
  const queryString = req.url && req.url.includes("?") ? "?" + req.url.split("?")[1] : "";

  if (routeParam) {
    const raw = Array.isArray(routeParam) ? routeParam.join("/") : routeParam;
    const clean = raw.startsWith("/") ? raw : "/" + raw;
    if (clean.startsWith("/.well-known/")) {
      req.url = clean + queryString;
    } else if (clean.startsWith("/api/")) {
      req.url = clean + queryString;
    } else {
      req.url = "/api" + clean + queryString;
    }
  } else if (req.query && req.query.all) {
    const sub = Array.isArray(req.query.all) ? req.query.all.join("/") : req.query.all;
    req.url = `/api/${sub}` + queryString;
  } else if (
    req.headers["x-forwarded-uri"] &&
    (req.headers["x-forwarded-uri"].startsWith("/api/") ||
      req.headers["x-forwarded-uri"].startsWith("/.well-known/"))
  ) {
    req.url = req.headers["x-forwarded-uri"];
  } else if (req.url && (req.url === "/api" || req.url === "/api/" || req.url.includes("index") || req.url.includes("[...all]"))) {
    const matchedPath =
      (req.headers["x-matched-path"] as string) ||
      (req.headers["x-invoke-path"] as string);
    if (matchedPath && matchedPath.startsWith("/api/") && !matchedPath.includes("index") && !matchedPath.includes("[...all]")) {
      req.url = matchedPath + queryString;
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
