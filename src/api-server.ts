import { createApp } from "./app-server";

const app = createApp();

function resolveRequestUrl(req: any): string {
  let url = req.url || "/";

  // 1. Direct check from URL query parameters (e.g. ?__route__=db/status)
  if (url.includes("__route__=") || url.includes("route=") || url.includes("path=")) {
    try {
      const qIdx = url.indexOf("?");
      if (qIdx !== -1) {
        const params = new URLSearchParams(url.slice(qIdx + 1));
        const routeParam = params.get("__route__") || params.get("route") || params.get("path");
        if (routeParam) {
          params.delete("__route__");
          params.delete("route");
          params.delete("path");
          const qs = params.toString() ? `?${params.toString()}` : "";
          const clean = routeParam.replace(/^\/+/, "");
          if (clean.startsWith(".well-known/")) {
            return `/${clean}${qs}`;
          }
          return `/api/${clean}${qs}`;
        }
      }
    } catch (_) {
      // Fallback
    }
  }

  // 2. If req.query was already populated
  if (req.query) {
    const route = req.query.__route__ || req.query.route || req.query.path || req.query.slug;
    if (route) {
      const sub = Array.isArray(route) ? route.join("/") : route;
      const cleanSub = sub.replace(/^\/+/, "");
      if (cleanSub.startsWith(".well-known/")) {
        return `/${cleanSub}`;
      }
      return `/api/${cleanSub}`;
    }
  }

  // 3. Check Vercel forward headers
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

  // 4. If req.url is already a valid specific API route (not index)
  if (
    url.startsWith("/api/") &&
    url !== "/api" &&
    url !== "/api/" &&
    !url.startsWith("/api/index")
  ) {
    return url;
  }
  if (url.startsWith("/.well-known/")) {
    return url;
  }

  return url;
}

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

  // 3. Resolve requested endpoint accurately
  req.url = resolveRequestUrl(req);

  try {
    return (app as any)(req, res);
  } catch (err: any) {
    console.error("Vercel serverless uncaught error:", err);
    if (!res.headersSent) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: err?.message || "Internal server error", failed: true }));
    }
  }
}
