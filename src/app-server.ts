import express from "express";
import cors from "cors";
import { neonDb, MessageRecord, PeerRecord, UserRecord } from "./db/neon";

export interface PeerIdentity {
  domain: string;
  username: string;
  avatarColor: string;
  publicKey?: string;
  inboxUrl: string;
  status: "pending" | "accepted" | "rejected" | "blocked";
  direction: "incoming" | "outgoing";
  lastSeen?: number;
  addedAt: number;
}

export interface ChatChannel {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  isDefault?: boolean;
}

export interface ChatMessage {
  id: string;
  targetId: string;
  targetType: "channel" | "p2p";
  senderId: string;
  senderName: string;
  senderDomain?: string;
  senderAvatar?: string;
  senderColor: string;
  text: string;
  imageUrl?: string;
  replyTo?: {
    id: string;
    senderName: string;
    text: string;
  };
  reactions: Record<string, string[]>;
  timestamp: number;
  status?: "sending" | "delivered" | "failed";
}

let nodeConfig = {
  domain: "",
  username: "PeerNode_" + Math.floor(1000 + Math.random() * 9000),
  avatarColor: "indigo",
  customStatus: "Decentralized node ready",
};

// Active SSE stream connections
interface SseClient {
  res: express.Response;
  clientId?: string;
  userIdentifier?: string;
}
const sseClients = new Set<SseClient>();

function broadcast(eventType: string, payload: any, excludeClientId?: string) {
  const data = `data: ${JSON.stringify({ type: eventType, payload })}\n\n`;
  for (const client of Array.from(sseClients)) {
    if (excludeClientId && client.clientId && client.clientId === excludeClientId) {
      continue;
    }
    try {
      client.res.write(data);
      if (typeof (client.res as any).flush === "function") {
        (client.res as any).flush();
      }
    } catch (_) {
      sseClients.delete(client);
    }
  }
}

function cleanDomain(input: string): string {
  let cleaned = (input || "").trim().toLowerCase();
  cleaned = cleaned.replace(/^https?:\/\//, "");
  cleaned = cleaned.replace(/\/.*$/, "");
  return cleaned;
}

export function deriveSubdomain(domainOrHost: string): string {
  if (!domainOrHost) return "node";
  const clean = domainOrHost.replace(/^https?:\/\//, "").replace(/:\d+$/, "").trim().toLowerCase();
  const parts = clean.split(".");
  if (parts.length >= 3) {
    return parts[0];
  }
  if (parts.length === 2) {
    if (parts[1] === "local" || parts[1] === "internal") return parts[0];
    return parts[0];
  }
  return clean || "node";
}

function parseJwtPayload(token: string): any {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = Buffer.from(base64, "base64").toString("utf-8");
    return JSON.parse(jsonPayload);
  } catch (_) {
    return null;
  }
}

export function createApp() {
  const app = express();

  // Full CORS support
  app.use(
    cors({
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["*"],
    })
  );
  app.options("*", cors());

  app.use(express.json({ limit: "15mb" }));

  function getAppDomain(req: express.Request): string {
    if (nodeConfig.domain && nodeConfig.domain.trim()) {
      return nodeConfig.domain;
    }
    const hostHeader = req.headers.host;
    if (hostHeader && !hostHeader.includes("localhost") && !hostHeader.includes("127.0.0.1")) {
      return hostHeader;
    }
    return "my-node.local:3000";
  }

  // 1. DATABASE STATUS & INFO (Neon PostgreSQL)
  app.get("/api/db/status", async (_req, res) => {
    try {
      const status = await neonDb.getStatus();
      res.json({
        ...status,
        envVarsFound: {
          DATABASE_URL: Boolean(process.env.DATABASE_URL),
          POSTGRES_URL: Boolean(process.env.POSTGRES_URL),
          POSTGRES_URL_NON_POOLING: Boolean(process.env.POSTGRES_URL_NON_POOLING),
        },
        guideUrl: "https://neon.com/docs/guides/vercel-managed-integration",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // CONFIGURE NEON DB CONNECTION DYNAMICALLY (from UI or .env)
  app.post("/api/db/configure", async (req, res) => {
    try {
      const { databaseUrl } = req.body;
      if (databaseUrl !== undefined) {
        neonDb.setDbUrl(databaseUrl ? databaseUrl.trim() : null);
      }
      const status = await neonDb.getStatus();
      res.json({ success: true, status });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET REGISTERED USERS (For friend discovery)
  app.get("/api/users", async (_req, res) => {
    try {
      const users = await neonDb.getAllUsers();
      res.json({ users });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. GOOGLE AUTHENTICATION CONFIG & RESTRICTIONS (from .env)
  app.get("/api/auth/config", (req, res) => {
    const domain = getAppDomain(req);
    const username = deriveSubdomain(domain);
    const rawAllowed = (
      process.env.ALLOWED_GMAIL ||
      process.env.ALLOWED_EMAILS ||
      process.env.VITE_ALLOWED_EMAILS ||
      ""
    ).trim();

    let allowedEmails = rawAllowed
      ? rawAllowed.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
      : [];

    // If wildcard *@gmail.com or * is configured, hasRestriction is false (allows all Google users)
    const isWildcard = allowedEmails.some(
      (e) => e === "*" || e === "*@*" || e === "*@gmail.com"
    );

    res.json({
      allowedEmails,
      hasRestriction: allowedEmails.length > 0 && !isWildcard,
      clientId:
        process.env.GOOGLE_CLIENT_ID ||
        process.env.VITE_GOOGLE_CLIENT_ID ||
        "962902289698-dk7vjl1smbdeckdg9oe9j5a01m1lrknt.apps.googleusercontent.com",
      domain,
      username,
    });
  });

  // 2. GOOGLE AUTHENTICATION (Sign In with Google)
  app.post("/api/auth/google", async (req, res) => {
    const { credential, profile } = req.body;
    let userId = "";
    let email = "";
    let name = "";
    let picture = "";

    if (credential) {
      const payload = parseJwtPayload(credential);
      if (payload) {
        userId = payload.sub;
        email = payload.email;
        name = payload.name;
        picture = payload.picture;
      }
    } else if (profile && profile.email) {
      email = profile.email;
      name = profile.name || email.split("@")[0];
      picture = profile.picture || "";
      userId = profile.id || `google_${Buffer.from(email).toString("hex").slice(0, 12)}`;
    }

    if (!email) {
      return res.status(400).json({ error: "Missing Google credential or email" });
    }

    const currentDomain = getAppDomain(req);
    const subdomainUsername = name || deriveSubdomain(currentDomain);

    // Enforce allowed Gmail from .env (if restricted)
    const rawAllowed = (
      process.env.ALLOWED_GMAIL ||
      process.env.ALLOWED_EMAILS ||
      process.env.VITE_ALLOWED_EMAILS ||
      ""
    ).trim();

    if (rawAllowed) {
      const allowedList = rawAllowed
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      const emailLower = email.trim().toLowerCase();
      const isAllowed = allowedList.some((allowed) => {
        if (allowed === "*" || allowed === "*@*" || allowed === "*@gmail.com") {
          return true;
        }
        if (allowed.startsWith("*@") || allowed.startsWith("@")) {
          const dom = allowed.replace(/^\*?@/, "");
          return emailLower.endsWith("@" + dom);
        }
        return emailLower === allowed;
      });

      if (!isAllowed) {
        return res.status(403).json({
          error: `Access Denied: Google account "${email}" is not authorized for this domain (${currentDomain}).`,
          code: "GMAIL_NOT_ALLOWED",
          allowedEmails: allowedList,
          attemptedEmail: email,
        });
      }
    }

    try {
      const user = await neonDb.upsertUser({
        id: userId,
        email,
        name: subdomainUsername,
        picture,
        domain: currentDomain,
      });

      res.json({
        success: true,
        user,
        nodeUsername: subdomainUsername,
        message: `Successfully authenticated Google account ${email}. Saved to Neon DB.`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Google OAuth callback endpoint (handles popup or redirect completion)
  app.get("/api/auth/callback/google", (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Google Authentication</title>
  <style>
    body { background: #0c0c0e; color: #fff; font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #141417; border: 1px solid #222226; padding: 24px; border-radius: 16px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <p>Completing Google Authentication...</p>
  </div>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage({
          type: 'GOOGLE_OAUTH_RESPONSE',
          hash: window.location.hash,
          search: window.location.search
        }, '*');
        setTimeout(() => window.close(), 300);
      } else {
        window.location.href = '/' + window.location.hash;
      }
    } catch (e) {
      window.location.href = '/';
    }
  </script>
</body>
</html>`);
  });

  // 3. Manifest
  const handleManifest = (req: express.Request, res: express.Response) => {
    const domain = getAppDomain(req);
    const protocol = req.secure || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    res.json({
      protocol: "IMAGXP-P2P/1.0",
      domain: domain,
      username: nodeConfig.username,
      avatarColor: nodeConfig.avatarColor,
      status: "online",
      database: neonDb.isConfigured() ? "Neon PostgreSQL" : "Memory Cache",
      endpoints: {
        manifest: `${protocol}://${domain}/.well-known/imagxp-agent.json`,
        inbox: `${protocol}://${domain}/api/p2p/inbox`,
        friendRequest: `${protocol}://${domain}/api/p2p/friend-request`,
        resolve: `${protocol}://${domain}/api/p2p/manifest`,
        sync: `${protocol}://${domain}/api/p2p/sync`,
        dbStatus: `${protocol}://${domain}/api/db/status`,
      },
      timestamp: Date.now(),
    });
  };

  app.get("/.well-known/imagxp-agent.json", handleManifest);
  app.get("/api/p2p/manifest", handleManifest);

  // 4. SEND FRIEND REQUEST (Persists dual-sided records to Neon DB & broadcasts SSE)
  app.post("/api/peer/send-request", async (req, res) => {
    try {
      const {
        senderDomain,
        senderUsername,
        senderAvatarColor = "indigo",
        targetIdentifier,
        note,
      } = req.body;

      if (!senderDomain || !targetIdentifier) {
        return res.status(400).json({ error: "Missing senderDomain or targetIdentifier" });
      }

      const cleanSender = cleanDomain(senderDomain);
      const cleanTarget = cleanDomain(targetIdentifier);

      if (cleanSender === cleanTarget) {
        return res.status(400).json({ error: "Cannot send friend request to yourself" });
      }

      // Check if target matches an existing user in Neon DB
      const targetUser = await neonDb.getUser(cleanTarget);
      const targetDisplayName = targetUser?.name || cleanTarget.split("@")[0].split(".")[0];
      const targetDomainOrEmail = targetUser?.email || cleanTarget;

      const now = Date.now();

      // 1. Save Sender's outgoing record in Neon DB
      const senderRecord: PeerRecord = {
        id: `${cleanSender}_${targetDomainOrEmail}`,
        owner_domain: cleanSender,
        peer_domain: targetDomainOrEmail,
        username: targetDisplayName,
        avatar_color: "purple",
        inbox_url: `https://${targetDomainOrEmail}/api/p2p/inbox`,
        status: "pending",
        direction: "outgoing",
        added_at: now,
        last_seen: now,
      };
      await neonDb.upsertPeer(senderRecord);

      // 2. Save Target's incoming record in Neon DB (so other tab or device sees it immediately!)
      const targetRecord: PeerRecord = {
        id: `${targetDomainOrEmail}_${cleanSender}`,
        owner_domain: targetDomainOrEmail,
        peer_domain: cleanSender,
        username: senderUsername || cleanSender.split("@")[0].split(".")[0],
        avatar_color: senderAvatarColor,
        inbox_url: `https://${cleanSender}/api/p2p/inbox`,
        status: "pending",
        direction: "incoming",
        added_at: now,
        last_seen: now,
      };
      await neonDb.upsertPeer(targetRecord);

      // Broadcast SSE events
      broadcast("peer_request_received", {
        domain: cleanSender,
        ownerDomain: targetDomainOrEmail,
        username: senderUsername || cleanSender,
        avatarColor: senderAvatarColor,
        inboxUrl: targetRecord.inbox_url,
        status: "pending",
        direction: "incoming",
        note,
        lastSeen: now,
        addedAt: now,
      });

      broadcast("peer_updated", {
        domain: targetDomainOrEmail,
        ownerDomain: cleanSender,
        username: targetDisplayName,
        avatarColor: "purple",
        status: "pending",
        direction: "outgoing",
        lastSeen: now,
      });

      // If target appears to be a remote domain, attempt external HTTPS forward
      if (cleanTarget.includes(".") && !cleanTarget.includes("@")) {
        (async () => {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3500);
            await fetch(`https://${cleanTarget}/api/p2p/friend-request`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                fromDomain: cleanSender,
                fromUsername: senderUsername || cleanSender,
                fromAvatarColor: senderAvatarColor,
                fromInboxUrl: `https://${cleanSender}/api/p2p/inbox`,
                note,
                timestamp: now,
              }),
              signal: controller.signal,
            });
            clearTimeout(timeout);
          } catch (_) {}
        })();
      }

      res.json({
        success: true,
        message: `Friend request sent to ${targetDomainOrEmail} and saved to Neon DB.`,
        peer: senderRecord,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5. RESPOND TO FRIEND REQUEST (Accept or Decline)
  app.post("/api/peer/respond-request", async (req, res) => {
    try {
      const { ownerDomain, peerDomain, accept } = req.body;
      if (!ownerDomain || !peerDomain) {
        return res.status(400).json({ error: "Missing ownerDomain or peerDomain" });
      }

      const cleanOwner = cleanDomain(ownerDomain);
      const cleanPeer = cleanDomain(peerDomain);
      const newStatus = accept ? "accepted" : "rejected";

      // Update both records in Neon DB
      await neonDb.updatePeerStatus(cleanOwner, cleanPeer, newStatus);
      await neonDb.updatePeerStatus(cleanPeer, cleanOwner, newStatus);

      // Broadcast SSE updates to both sides
      broadcast("peer_updated", {
        domain: cleanPeer,
        ownerDomain: cleanOwner,
        status: newStatus,
        lastSeen: Date.now(),
      });

      broadcast("peer_updated", {
        domain: cleanOwner,
        ownerDomain: cleanPeer,
        status: newStatus,
        lastSeen: Date.now(),
      });

      // Forward response to remote node if external domain
      if (cleanPeer.includes(".") && !cleanPeer.includes("@")) {
        (async () => {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3500);
            await fetch(`https://${cleanPeer}/api/p2p/friend-response`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                fromDomain: cleanOwner,
                accepted: Boolean(accept),
              }),
              signal: controller.signal,
            });
            clearTimeout(timeout);
          } catch (_) {}
        })();
      }

      res.json({ success: true, status: newStatus });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Inbound Friend Request (from external peer or direct WebRTC hook)
  app.post("/api/p2p/friend-request", async (req, res) => {
    const { fromDomain, fromUsername, fromAvatarColor, fromInboxUrl, note } = req.body;

    if (!fromDomain || !fromUsername) {
      return res.status(400).json({ error: "Missing required peer fields" });
    }

    const domain = cleanDomain(fromDomain);
    const myDomain = getAppDomain(req);
    const now = Date.now();

    const peerObj: PeerRecord = {
      id: `${myDomain}_${domain}`,
      owner_domain: myDomain,
      peer_domain: domain,
      username: fromUsername,
      avatar_color: fromAvatarColor || "indigo",
      inbox_url: fromInboxUrl || `https://${domain}/api/p2p/inbox`,
      status: "pending",
      direction: "incoming",
      added_at: now,
      last_seen: now,
    };

    await neonDb.upsertPeer(peerObj);
    broadcast("peer_request_received", {
      domain,
      ownerDomain: myDomain,
      username: fromUsername,
      avatarColor: fromAvatarColor || "indigo",
      inboxUrl: peerObj.inbox_url,
      status: "pending",
      direction: "incoming",
      note,
      lastSeen: peerObj.last_seen,
      addedAt: peerObj.added_at,
    });

    res.json({ success: true, status: "pending", message: "Friend request received and saved to Neon DB" });
  });

  // 7. Friend Response
  app.post("/api/p2p/friend-response", async (req, res) => {
    const { fromDomain, accepted, fromUsername, fromAvatarColor } = req.body;
    if (!fromDomain) {
      return res.status(400).json({ error: "Missing fromDomain" });
    }

    const domain = cleanDomain(fromDomain);
    const myDomain = getAppDomain(req);
    const newStatus = accepted ? "accepted" : "rejected";

    const peerObj: PeerRecord = {
      id: `${myDomain}_${domain}`,
      owner_domain: myDomain,
      peer_domain: domain,
      username: fromUsername || domain.split(".")[0],
      avatar_color: fromAvatarColor || "indigo",
      status: newStatus,
      direction: "incoming",
      added_at: Date.now(),
      last_seen: Date.now(),
    };

    await neonDb.upsertPeer(peerObj);
    broadcast("peer_updated", {
      domain,
      ownerDomain: myDomain,
      username: peerObj.username,
      avatarColor: peerObj.avatar_color,
      status: peerObj.status,
      direction: peerObj.direction,
      lastSeen: peerObj.last_seen,
    });

    res.json({ success: true });
  });

  // 8. Inbound Direct P2P Message
  app.post("/api/p2p/inbox", async (req, res) => {
    const { id, fromDomain, fromUsername, fromAvatarColor, text, imageUrl, replyTo, timestamp } = req.body;

    if (!fromDomain || (!text && !imageUrl)) {
      return res.status(400).json({ error: "Invalid message payload" });
    }

    const senderDomain = cleanDomain(fromDomain);
    const myDomain = getAppDomain(req);

    // Ensure peer exists
    const peerRecord: PeerRecord = {
      id: `${myDomain}_${senderDomain}`,
      owner_domain: myDomain,
      peer_domain: senderDomain,
      username: fromUsername || senderDomain,
      avatar_color: fromAvatarColor || "indigo",
      inbox_url: `https://${senderDomain}/api/p2p/inbox`,
      status: "accepted",
      direction: "incoming",
      added_at: Date.now(),
      last_seen: Date.now(),
    };
    await neonDb.upsertPeer(peerRecord);

    const messageRecord: MessageRecord = {
      id: id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      target_id: senderDomain,
      target_type: "p2p",
      sender_id: senderDomain,
      sender_domain: senderDomain,
      sender_name: fromUsername || peerRecord.username,
      sender_color: fromAvatarColor || peerRecord.avatar_color,
      text: (text || "").trim(),
      image_url: imageUrl || undefined,
      reply_to: replyTo || undefined,
      timestamp: timestamp || Date.now(),
    };

    await neonDb.insertMessage(messageRecord);

    const chatMsg: ChatMessage = {
      id: messageRecord.id,
      targetId: senderDomain,
      targetType: "p2p",
      senderId: senderDomain,
      senderDomain: senderDomain,
      senderName: messageRecord.sender_name,
      senderColor: messageRecord.sender_color,
      text: messageRecord.text || "",
      imageUrl: messageRecord.image_url,
      replyTo: messageRecord.reply_to,
      reactions: {},
      timestamp: messageRecord.timestamp,
      status: "delivered",
    };

    broadcast("message_new", chatMsg);
    res.json({ success: true, messageId: chatMsg.id, status: "delivered" });
  });

  // 9. P2P Sync Endpoint
  app.get("/api/p2p/sync", async (req, res) => {
    const peerDomain = cleanDomain((req.query.peerDomain as string) || "");
    const since = parseInt((req.query.since as string) || "0", 10);
    const myDomain = getAppDomain(req);

    const allMessages = await neonDb.getMessages(peerDomain);
    const relevant = allMessages.filter((m) => m.timestamp > since);

    const peers = await neonDb.getPeers(myDomain);
    const peerRecord = peers.find((p) => p.peer_domain === peerDomain);

    res.json({
      success: true,
      domain: myDomain,
      username: nodeConfig.username,
      avatarColor: nodeConfig.avatarColor,
      peerStatus: peerRecord?.status || null,
      messages: relevant.map((m) => ({
        id: m.id,
        targetId: m.target_id,
        targetType: m.target_type as any,
        senderId: m.sender_id,
        senderDomain: m.sender_domain,
        senderName: m.sender_name,
        senderColor: m.sender_color,
        text: m.text || "",
        imageUrl: m.image_url,
        replyTo: m.reply_to,
        timestamp: m.timestamp,
        status: "delivered",
      })),
      timestamp: Date.now(),
    });
  });

  // 10. Bootstrap (loads initial state from Neon DB for a specific user identity or domain)
  app.get("/api/chat/bootstrap", async (req, res) => {
    const userIdentifier = (
      (req.query.userIdentifier as string) ||
      (req.query.userEmail as string) ||
      getAppDomain(req)
    ).trim();

    const cleanUser = cleanDomain(userIdentifier);

    try {
      const [dbChannels, dbMessages, dbPeers] = await Promise.all([
        neonDb.getChannels(),
        neonDb.getMessages(undefined, cleanUser),
        neonDb.getPeers(cleanUser),
      ]);

      const formattedChannels: ChatChannel[] = dbChannels.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        createdAt: c.created_at,
        isDefault: c.id === "general",
      }));

      const formattedMessages: ChatMessage[] = dbMessages.map((m) => ({
        id: m.id,
        targetId: m.target_id,
        targetType: m.target_type as any,
        senderId: m.sender_id,
        senderDomain: m.sender_domain,
        senderName: m.sender_name,
        senderColor: m.sender_color,
        text: m.text || "",
        imageUrl: m.image_url,
        replyTo: m.reply_to,
        reactions: {},
        timestamp: m.timestamp,
        status: "delivered",
      }));

      const formattedPeers: PeerIdentity[] = dbPeers.map((p) => ({
        domain: p.peer_domain,
        username: p.username,
        avatarColor: p.avatar_color,
        inboxUrl: p.inbox_url || `https://${p.peer_domain}/api/p2p/inbox`,
        status: p.status as any,
        direction: p.direction as any,
        addedAt: p.added_at,
        lastSeen: p.last_seen,
      }));

      res.json({
        myDomain: cleanUser,
        myUsername: nodeConfig.username,
        myAvatarColor: nodeConfig.avatarColor,
        customStatus: nodeConfig.customStatus,
        channels:
          formattedChannels.length > 0
            ? formattedChannels
            : [{ id: "general", name: "general", createdAt: Date.now(), isDefault: true }],
        messages: formattedMessages,
        peers: formattedPeers,
        databaseConfigured: neonDb.isConfigured(),
        serverTime: Date.now(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 11. SSE Stream
  app.get("/api/chat/stream", (req, res) => {
    const clientId = (req.query.clientId as string) || "";
    const userIdentifier = (req.query.userIdentifier as string) || "";

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify({ type: "connected", serverTime: Date.now() })}\n\n`);

    const client: SseClient = { res, clientId, userIdentifier };
    sseClients.add(client);

    const ping = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch (_) {
        clearInterval(ping);
        sseClients.delete(client);
      }
    }, 15000);

    req.on("close", () => {
      clearInterval(ping);
      sseClients.delete(client);
    });
  });

  // 12. Send Message (Persisted directly to Neon DB)
  app.post("/api/chat/message", async (req, res) => {
    const {
      targetId,
      targetType = "channel",
      text = "",
      imageUrl,
      replyTo,
      clientId,
      senderId,
      senderName,
      senderColor,
    } = req.body;

    const myDomain = senderId || getAppDomain(req);
    const cleanSenderDomain = cleanDomain(myDomain);

    if (!targetId || (!text.trim() && !imageUrl)) {
      return res.status(400).json({ error: "Missing required message fields" });
    }

    const newMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const msgRecord: MessageRecord = {
      id: newMessageId,
      target_id: targetId,
      target_type: targetType,
      sender_id: cleanSenderDomain,
      sender_domain: cleanSenderDomain,
      sender_name: senderName || nodeConfig.username,
      sender_color: senderColor || nodeConfig.avatarColor,
      text: text.trim(),
      image_url: imageUrl || undefined,
      reply_to: replyTo || undefined,
      timestamp: Date.now(),
    };

    // Save to Neon PostgreSQL
    await neonDb.insertMessage(msgRecord);

    const newMessage: ChatMessage = {
      id: msgRecord.id,
      targetId,
      targetType,
      senderId: cleanSenderDomain,
      senderDomain: cleanSenderDomain,
      senderName: msgRecord.sender_name,
      senderColor: msgRecord.sender_color,
      text: msgRecord.text || "",
      imageUrl: msgRecord.image_url,
      replyTo: msgRecord.reply_to,
      reactions: {},
      timestamp: msgRecord.timestamp,
      status: "delivered",
    };

    broadcast("message_new", newMessage, clientId);

    // Cross-domain forward if P2P and target has domain structure
    if (targetType === "p2p") {
      const cleanPeerDomain = cleanDomain(targetId);
      if (cleanPeerDomain.includes(".") && !cleanPeerDomain.includes("@")) {
        (async () => {
          for (const proto of ["https", "http"]) {
            try {
              const remoteUrl = `${proto}://${cleanPeerDomain}/api/p2p/inbox`;
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 4000);
              const response = await fetch(remoteUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  id: newMessage.id,
                  fromDomain: cleanSenderDomain,
                  fromUsername: msgRecord.sender_name,
                  fromAvatarColor: msgRecord.sender_color,
                  text: newMessage.text,
                  imageUrl: newMessage.imageUrl,
                  replyTo: newMessage.replyTo,
                  timestamp: newMessage.timestamp,
                }),
                signal: controller.signal,
              });
              clearTimeout(timeout);
              if (response.ok) break;
            } catch (_) {}
          }
        })();
      }
    }

    res.json({ success: true, message: newMessage });
  });

  // 13. Create Channel (Saved in Neon DB)
  app.post("/api/chat/channel", async (req, res) => {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: "Missing channel name" });

    const cleanName = name.toLowerCase().trim().replace(/[^a-z0-9_-]/g, "-");
    const newChan: ChatChannel = {
      id: `chan_${cleanName}`,
      name: cleanName,
      description: (description || "").trim(),
      createdAt: Date.now(),
    };

    await neonDb.createChannel({
      id: newChan.id,
      name: newChan.name,
      description: newChan.description || "",
      created_at: newChan.createdAt,
    });

    broadcast("channel_new", newChan);
    res.json({ success: true, channel: newChan });
  });

  // 14. Delete Peer
  app.delete("/api/peer/:domain", async (req, res) => {
    const clean = cleanDomain(req.params.domain);
    const ownerDomain = cleanDomain((req.query.ownerDomain as string) || getAppDomain(req));
    await neonDb.deletePeer(ownerDomain, clean);
    await neonDb.clearMessages(clean);
    broadcast("peer_deleted", { domain: clean, ownerDomain });
    res.json({ success: true, domain: clean });
  });

  // 15. Clear Chat
  app.post("/api/chat/clear", async (req, res) => {
    const { targetId } = req.body;
    if (targetId) {
      await neonDb.clearMessages(targetId);
      broadcast("chat_cleared", { targetId });
    }
    res.json({ success: true, targetId });
  });

  // 16. Configure Node
  app.post("/api/node/configure", (req, res) => {
    const { domain, username, avatarColor, customStatus } = req.body;
    if (domain !== undefined) nodeConfig.domain = cleanDomain(domain);
    if (username !== undefined) nodeConfig.username = username.trim();
    if (avatarColor !== undefined) nodeConfig.avatarColor = avatarColor;
    if (customStatus !== undefined) nodeConfig.customStatus = customStatus;
    broadcast("node_config_updated", nodeConfig);
    res.json({ success: true, nodeConfig });
  });

  // 17. Sync client state from localStorage
  app.post("/api/chat/sync-client-state", async (req, res) => {
    try {
      const { clientDomain, clientUsername, clientAvatarColor, clientPeers, clientMessages } =
        req.body || {};

      const myDom = cleanDomain(clientDomain || nodeConfig.domain || getAppDomain(req));

      if (Array.isArray(clientPeers) && clientPeers.length > 0) {
        for (const p of clientPeers) {
          if (p && p.domain) {
            await neonDb.upsertPeer({
              id: `${myDom}_${cleanDomain(p.domain)}`,
              owner_domain: myDom,
              peer_domain: cleanDomain(p.domain),
              username: p.username || p.domain,
              avatar_color: p.avatarColor || "indigo",
              inbox_url: p.inboxUrl || `https://${cleanDomain(p.domain)}/api/p2p/inbox`,
              status: p.status || "accepted",
              direction: p.direction || "incoming",
              added_at: p.addedAt || Date.now(),
              last_seen: p.lastSeen || Date.now(),
            });
          }
        }
      }

      if (Array.isArray(clientMessages) && clientMessages.length > 0) {
        for (const m of clientMessages.slice(-50)) {
          if (m && m.id && (m.text || m.imageUrl)) {
            await neonDb.insertMessage({
              id: m.id,
              target_id: m.targetId || "general",
              target_type: m.targetType || "channel",
              sender_id: m.senderId || myDom,
              sender_domain: m.senderDomain || myDom,
              sender_name: m.senderName || clientUsername || "User",
              sender_color: m.senderColor || clientAvatarColor || "indigo",
              text: m.text || "",
              image_url: m.imageUrl,
              reply_to: m.replyTo,
              timestamp: m.timestamp || Date.now(),
            });
          }
        }
      }

      res.json({ success: true, syncedAt: Date.now() });
    } catch (err: any) {
      res.json({ success: false, error: err.message });
    }
  });

  return app;
}
