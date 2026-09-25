import express from "express";
import cors from "cors";
import { neonDb, MessageRecord, PeerRecord, UserRecord } from "./db/neon";
import { cleanDomain, deriveSubdomain, resolveTargetHost } from "./utils/domain";

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
  crawlerTags?: string[];
}

export function getUserCrawlerTags(username: string, domain: string): string[] {
  const safeUser = (username || "node").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const safeDomain = (domain || "node").toLowerCase().replace(/^https?:\/\//, "").replace(/:\d+$/, "");
  return [
    `#${safeUser}`,
    `@${safeDomain}`,
    `tag:${safeUser}`,
    `crawler-ping:active`,
    `method:web-crawler`,
    `db-sync:live`,
  ];
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
  crawlerPingAck?: boolean;
}

let nodeConfig = {
  domain: "",
  username: "",
  avatarColor: "indigo",
  customStatus: "Decentralized Crawler Node Ready",
};

export { cleanDomain, deriveSubdomain, resolveTargetHost };

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

  app.use(
    cors({
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "x-node-id", "x-client-id"],
    })
  );

  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: true, limit: "25mb" }));

  // Helper: Extract current app domain from request
  function getAppDomain(req?: express.Request): string {
    if (nodeConfig.domain && nodeConfig.domain.trim()) {
      return cleanDomain(nodeConfig.domain);
    }
    if (req) {
      const customNode = (req.query?.node as string) || (req.headers["x-node-id"] as string);
      if (customNode && customNode.trim()) {
        return cleanDomain(`${customNode.trim()}.local:3000`);
      }
      const hostHeader = (req.headers["x-forwarded-host"] as string) || req.headers.host;
      if (hostHeader) {
        return cleanDomain(hostHeader);
      }
    }
    return "node.local:3000";
  }

  // Helper: Auto-assign username as subdomain or domain of deployment!
  function getNodeIdentity(req?: express.Request): { domain: string; username: string; subdomain: string } {
    const domain = getAppDomain(req);
    const subdomain = deriveSubdomain(domain);
    const username = nodeConfig.username && nodeConfig.username.trim() && !nodeConfig.username.startsWith("PeerNode_")
      ? nodeConfig.username.trim()
      : subdomain;
    return { domain, username, subdomain };
  }

  // Health and routing ping for /api
  app.get(["/api", "/api/", "/api/index"], (_req, res) => {
    res.json({
      status: "ok",
      service: "D-Connect Web Crawler Messenger",
      database: neonDb.isConfigured() ? "Neon PostgreSQL Active" : "Persistent Local Store",
      time: Date.now(),
    });
  });

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
      });
    } catch (err: any) {
      res.json({
        configured: false,
        engine: "Neon (Error)",
        message: err.message || "Failed to query Neon PostgreSQL status",
        detectedEnvKeys: [],
        stats: { usersCount: 0, peersCount: 0, messagesCount: 0, channelsCount: 1 },
      });
    }
  });

  // CONFIGURE NEON DB CONNECTION DYNAMICALLY
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

  // GET REGISTERED USERS
  app.get("/api/users", async (_req, res) => {
    try {
      const users = await neonDb.getAllUsers();
      res.json({ users });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GOOGLE AUTH CONFIG
  app.get("/api/auth/config", (req, res) => {
    const domain = getAppDomain(req);
    const username = deriveSubdomain(domain);
    const clientId = process.env.VITE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
    res.json({
      configured: Boolean(clientId),
      clientId,
      domain,
      username,
    });
  });

  // USER SYNC (Direct profile registration)
  app.post("/api/users/sync", async (req, res) => {
    try {
      const { profile } = req.body;
      if (!profile || !profile.email) {
        return res.status(400).json({ error: "Missing profile or email" });
      }
      const currentDomain = getAppDomain(req);
      const user = await neonDb.upsertUser({
        id: profile.id || `usr_${cleanDomain(profile.email).replace(/[^a-zA-Z0-9]/g, "_")}`,
        email: cleanDomain(profile.email),
        name: profile.name || deriveSubdomain(currentDomain),
        picture: profile.picture,
        domain: currentDomain,
      });
      res.json({ success: true, user });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GOOGLE AUTH TOKEN VERIFICATION
  app.post("/api/auth/google", async (req, res) => {
    const { credential, email: directEmail, name: directName } = req.body;
    let email = directEmail;
    let name = directName;
    let userId = "";
    let picture = "";

    if (credential) {
      const payload = parseJwtPayload(credential);
      if (payload) {
        email = payload.email || email;
        name = payload.name || payload.given_name || name;
        userId = payload.sub || "";
        picture = payload.picture || "";
      }
    }

    if (!email) {
      return res.status(400).json({ error: "Missing Google credential or email" });
    }

    const currentDomain = getAppDomain(req);
    const subdomainUsername = name || deriveSubdomain(currentDomain);
    userId = userId || `usr_${cleanDomain(email).replace(/[^a-zA-Z0-9]/g, "_")}`;

    try {
      const user = await neonDb.upsertUser({
        id: userId,
        email: cleanDomain(email),
        name: subdomainUsername,
        picture,
        domain: currentDomain,
      });

      res.json({
        success: true,
        user,
        nodeUsername: subdomainUsername,
        message: `Successfully authenticated ${email}. Saved to database.`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // =========================================================================
  // WEB CRAWLER METHOD CORE ENGINE
  // =========================================================================

  // 1. CRAWLER MANIFEST & DISCOVERY TAGS
  const handleCrawlerManifest = (req: express.Request, res: express.Response) => {
    const { domain, username } = getNodeIdentity(req);
    const protocol = req.secure || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const tags = getUserCrawlerTags(username, domain);
    res.json({
      protocol: "crawler-ping/2.1",
      domain: domain,
      username: username,
      avatarColor: nodeConfig.avatarColor,
      status: "online",
      method: "web-crawler",
      database: neonDb.isConfigured() ? "Neon PostgreSQL Live" : "Persistent Database",
      endpoints: {
        ping: `${protocol}://${domain}/api/crawler/ping`,
        webhook: `${protocol}://${domain}/api/crawler/webhook`,
        probe: `${protocol}://${domain}/api/crawler/probe`,
        manifest: `${protocol}://${domain}/api/crawler/manifest`,
        sync: `${protocol}://${domain}/api/crawler/sync`,
      },
      crawlerTags: tags,
      timestamp: Date.now(),
    });
  };

  app.get("/api/crawler/manifest", handleCrawlerManifest);
  app.get("/.well-known/crawler-manifest.json", handleCrawlerManifest);
  app.get("/.well-known/imagxp-agent.json", handleCrawlerManifest);
  app.get("/api/p2p/manifest", handleCrawlerManifest);

  // 2. CRAWLER PROBE (Crawls target domain/subdomain, verifies tags & endpoints)
  app.get("/api/crawler/probe", async (req, res) => {
    try {
      const targetInput = (req.query.target as string) || "";
      if (!targetInput.trim()) {
        return res.status(400).json({ error: "Missing target parameter" });
      }

      const currentDomain = getAppDomain(req);
      const resolvedHost = resolveTargetHost(targetInput, currentDomain);
      const cleanTarget = cleanDomain(resolvedHost || targetInput);
      const now = Date.now();

      // If probing self or local registered user
      if (cleanTarget === cleanDomain(currentDomain) || !cleanTarget.includes(".")) {
        const targetUser = await neonDb.getUser(cleanTarget);
        const safeName = targetUser?.name || deriveSubdomain(cleanTarget);
        const tags = [
          { name: "crawler-protocol", value: "crawler-ping/2.1" },
          { name: "crawler-node", value: cleanTarget },
          { name: "crawler-status", value: "online" },
          { name: "crawler-tag", value: `#${safeName.toLowerCase().replace(/[^a-z0-9]/g, "")}` },
          { name: "method", value: "web-crawler" },
          { name: "database-persisted", value: "true" },
        ];
        return res.json({
          success: true,
          target: cleanTarget,
          tags,
          crawledAt: now,
          nodeInfo: {
            username: safeName,
            domain: cleanTarget,
            status: "ready",
          },
        });
      }

      // Crawl the remote target over HTTP/HTTPS
      let remoteSuccess = false;
      let remoteNodeInfo: any = null;
      let remoteTags: Array<{ name: string; value: string }> = [];

      for (const proto of ["https", "http"]) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3500);
          const manifestRes = await fetch(`${proto}://${resolvedHost}/api/crawler/manifest`, {
            headers: { Accept: "application/json", "User-Agent": "D-Connect-Crawler/2.1" },
            signal: controller.signal,
          });
          clearTimeout(timeout);

          if (manifestRes.ok) {
            const data = await manifestRes.json();
            remoteSuccess = true;
            remoteNodeInfo = {
              username: data.username || deriveSubdomain(resolvedHost),
              domain: data.domain || resolvedHost,
              avatarColor: data.avatarColor || "purple",
              status: data.status || "online",
            };
            if (Array.isArray(data.crawlerTags)) {
              remoteTags = data.crawlerTags.map((t: string) => ({ name: "crawler-tag", value: t }));
            }
            break;
          }
        } catch (_) {
          // Try next protocol or fallback
        }
      }

      if (!remoteSuccess) {
        // Fallback: Check local Neon DB
        const targetUser = await neonDb.getUser(cleanTarget);
        const safeName = targetUser?.name || deriveSubdomain(cleanTarget);
        remoteNodeInfo = {
          username: safeName,
          domain: cleanTarget,
          status: "ready",
        };
        remoteTags = [
          { name: "crawler-protocol", value: "crawler-ping/2.1" },
          { name: "crawler-node", value: cleanTarget },
          { name: "crawler-status", value: "online" },
          { name: "crawler-tag", value: `#${safeName.toLowerCase().replace(/[^a-z0-9]/g, "")}` },
          { name: "database-persisted", value: "true" },
        ];
      }

      res.json({
        success: true,
        target: cleanTarget,
        resolvedHost,
        tags: remoteTags,
        crawledAt: now,
        nodeInfo: remoteNodeInfo,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to crawl target" });
    }
  });

  // 3. CRAWLER PING SENDER + WEBHOOK ENDPOINT
  // Receives crawler pings, persists everything directly to database, forwards to remote nodes
  app.post(["/api/crawler/ping", "/api/crawler/webhook"], async (req, res) => {
    try {
      const {
        action = "friend_request",
        senderDomain,
        senderUsername,
        senderAvatarColor = "indigo",
        senderTags = [],
        targetIdentifier,
        note,
        message,
      } = req.body;

      if (!senderDomain || !targetIdentifier) {
        return res.status(400).json({ error: "Missing senderDomain or targetIdentifier" });
      }

      const currentDomain = getAppDomain(req);
      const cleanSender = cleanDomain(senderDomain);
      const resolvedTarget = resolveTargetHost(targetIdentifier, currentDomain);
      const cleanTarget = cleanDomain(resolvedTarget || targetIdentifier);
      const now = Date.now();

      // Check if target is a known local user
      const targetUser = await neonDb.getUser(cleanTarget);
      const targetDisplayName = targetUser?.name || deriveSubdomain(cleanTarget);
      const targetDomainOrEmail = targetUser?.email || cleanTarget;

      const targetTags = [
        { name: "crawler-protocol", value: "crawler-ping/2.1" },
        { name: "crawler-node", value: cleanTarget },
        { name: "crawler-tag", value: `#${targetDisplayName.toLowerCase().replace(/[^a-z0-9]/g, "")}` },
        { name: "db-persisted", value: "true" },
      ];

      // ACTION 1: FRIEND REQUEST
      if (action === "friend_request") {
        if (cleanSender === cleanTarget || (resolvedTarget && cleanSender === resolvedTarget)) {
          return res.status(400).json({ error: "Cannot send friend request to yourself" });
        }

        await neonDb.deletePeer(cleanSender, targetDomainOrEmail);
        await neonDb.deletePeer(cleanSender, cleanTarget);

        // 1. Sender Outgoing Record
        const senderRecord: PeerRecord = {
          id: `${cleanSender}_${cleanTarget}`,
          owner_domain: cleanSender,
          peer_domain: cleanTarget,
          username: targetDisplayName,
          avatar_color: "purple",
          inbox_url: `https://${cleanTarget}/api/crawler/ping`,
          status: "pending",
          direction: "outgoing",
          added_at: now,
          last_seen: now,
        };
        await neonDb.upsertPeer(senderRecord);

        // 2. Target Incoming Records (Persist for all target aliases: domain, subdomain, user)
        const targetAliases = new Set<string>([targetDomainOrEmail, cleanTarget]);
        if (resolvedTarget) targetAliases.add(resolvedTarget);
        const targetSub = deriveSubdomain(cleanTarget);
        if (targetSub) targetAliases.add(targetSub);
        if (targetUser?.email) targetAliases.add(cleanDomain(targetUser.email));
        if (targetUser?.id) targetAliases.add(cleanDomain(targetUser.id));

        for (const alias of targetAliases) {
          if (!alias || alias === cleanSender) continue;
          await neonDb.upsertPeer({
            id: `${alias}_${cleanSender}`,
            owner_domain: alias,
            peer_domain: cleanSender,
            username: senderUsername || deriveSubdomain(cleanSender),
            avatar_color: senderAvatarColor,
            inbox_url: `https://${cleanSender}/api/crawler/ping`,
            status: "pending",
            direction: "incoming",
            added_at: now,
            last_seen: now,
          });
        }

        const computedSenderTags =
          senderTags && senderTags.length > 0
            ? senderTags
            : getUserCrawlerTags(senderUsername || cleanSender, cleanSender);

        // 3. Remote crawler forward if target is on a remote host
        const remoteHost = resolvedTarget.includes(".") ? resolvedTarget : (cleanTarget.includes(".") ? cleanTarget : null);
        if (remoteHost && remoteHost !== cleanDomain(currentDomain) && !remoteHost.includes("@")) {
          for (const proto of ["https", "http"]) {
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 3500);
              const forwardRes = await fetch(`${proto}://${remoteHost}/api/crawler/ping`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "friend_request",
                  senderDomain: cleanSender,
                  senderUsername: senderUsername || cleanSender,
                  senderAvatarColor,
                  senderTags: computedSenderTags,
                  targetIdentifier: remoteHost,
                  note,
                  timestamp: now,
                }),
                signal: controller.signal,
              });
              clearTimeout(timeout);
              if (forwardRes.ok) break;
            } catch (_) {
              // Non-blocking
            }
          }
        }

        return res.json({
          success: true,
          pong: true,
          action: "friend_request",
          crawledAt: now,
          targetTags,
          peer: senderRecord,
          message: `Crawler Ping sent to ${targetDomainOrEmail} and saved to database.`,
        });
      }

      // ACTION 2: FRIEND ACCEPT / DECLINE
      if (action === "friend_accept" || action === "friend_decline") {
        const accept = action === "friend_accept";
        const newStatus = accept ? "accepted" : "rejected";

        if (accept) {
          await neonDb.updatePeerStatus(cleanSender, cleanTarget, "accepted");
          await neonDb.updatePeerStatus(cleanTarget, cleanSender, "accepted");
        } else {
          await neonDb.deletePeer(cleanSender, cleanTarget);
          await neonDb.deletePeer(cleanTarget, cleanSender);
        }

        if (cleanTarget.includes(".") && cleanTarget !== cleanDomain(currentDomain) && !cleanTarget.includes("@")) {
          for (const proto of ["https", "http"]) {
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 3500);
              const forwardRes = await fetch(`${proto}://${cleanTarget}/api/crawler/ping`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: accept ? "friend_accept" : "friend_decline",
                  senderDomain: cleanSender,
                  senderUsername,
                  targetIdentifier: cleanTarget,
                  timestamp: now,
                }),
                signal: controller.signal,
              });
              clearTimeout(timeout);
              if (forwardRes.ok) break;
            } catch (_) {}
          }
        }

        return res.json({
          success: true,
          pong: true,
          action,
          status: newStatus,
          crawledAt: now,
          targetTags,
        });
      }

      // ACTION 3: CHAT MESSAGE OVER CRAWLER PING
      if (action === "message") {
        if (!message || (!message.text && !message.imageUrl)) {
          return res.status(400).json({ error: "Missing message payload" });
        }

        const msgId = message.id || `msg_${now}_${Math.random().toString(36).slice(2, 6)}`;
        const msgRecord: MessageRecord = {
          id: msgId,
          target_id: cleanTarget,
          target_type: "p2p",
          sender_id: cleanSender,
          sender_domain: cleanSender,
          sender_name: senderUsername || deriveSubdomain(cleanSender),
          sender_color: senderAvatarColor,
          text: (message.text || "").trim(),
          image_url: message.imageUrl,
          reply_to: message.replyTo,
          timestamp: message.timestamp || now,
        };

        await neonDb.insertMessage(msgRecord);
        await neonDb.updatePeerStatus(cleanSender, cleanTarget, "accepted");
        await neonDb.updatePeerStatus(cleanTarget, cleanSender, "accepted");

        const chatMsg: ChatMessage = {
          id: msgRecord.id,
          targetId: cleanTarget,
          targetType: "p2p",
          senderId: cleanSender,
          senderDomain: cleanSender,
          senderName: msgRecord.sender_name,
          senderColor: msgRecord.sender_color,
          text: msgRecord.text || "",
          imageUrl: msgRecord.image_url,
          replyTo: msgRecord.reply_to,
          reactions: {},
          timestamp: msgRecord.timestamp,
          status: "delivered",
          crawlerPingAck: true,
        };

        // Forward to remote node if external host
        if (cleanTarget.includes(".") && cleanTarget !== cleanDomain(currentDomain) && !cleanTarget.includes("@")) {
          for (const proto of ["https", "http"]) {
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 3500);
              const forwardRes = await fetch(`${proto}://${cleanTarget}/api/crawler/ping`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "message",
                  senderDomain: cleanSender,
                  senderUsername: msgRecord.sender_name,
                  senderAvatarColor: msgRecord.sender_color,
                  targetIdentifier: cleanTarget,
                  message: {
                    id: chatMsg.id,
                    text: chatMsg.text,
                    imageUrl: chatMsg.imageUrl,
                    replyTo: chatMsg.replyTo,
                    timestamp: chatMsg.timestamp,
                  },
                  timestamp: now,
                }),
                signal: controller.signal,
              });
              clearTimeout(timeout);
              if (forwardRes.ok) break;
            } catch (_) {}
          }
        }

        return res.json({
          success: true,
          pong: true,
          action: "message",
          messageId: chatMsg.id,
          crawledAt: now,
          targetTags,
          status: "delivered",
        });
      }

      // Default probe pong
      return res.json({
        success: true,
        pong: true,
        action: "probe",
        crawledAt: now,
        targetTags,
      });
    } catch (err: any) {
      console.error("api/crawler/ping error:", err);
      res.status(500).json({ error: err.message || "Failed to process crawler ping" });
    }
  });

  // 4. ON-DEMAND CRAWLER SYNC (Fast, zero polling, zero browser hang!)
  app.get("/api/crawler/sync", async (req, res) => {
    try {
      const userIdentifier = (req.query.userIdentifier as string) || "";
      const targetId = (req.query.targetId as string) || "";
      const cleanUser = cleanDomain(userIdentifier);

      const [dbPeers, dbMessages] = await Promise.all([
        cleanUser ? neonDb.getPeers(cleanUser) : Promise.resolve([]),
        neonDb.getMessages(targetId || "general", cleanUser),
      ]);

      const formattedPeers: PeerIdentity[] = (dbPeers as PeerRecord[]).map((p: PeerRecord) => ({
        domain: p.peer_domain,
        username: p.username,
        avatarColor: p.avatar_color,
        inboxUrl: p.inbox_url || `https://${p.peer_domain}/api/crawler/ping`,
        status: p.status as any,
        direction: p.direction as any,
        addedAt: p.added_at,
        lastSeen: p.last_seen,
        crawlerTags: getUserCrawlerTags(p.username, p.peer_domain),
      }));

      const formattedMessages: ChatMessage[] = (dbMessages as MessageRecord[]).map((m: MessageRecord) => ({
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
        crawlerPingAck: true,
      }));

      res.json({
        success: true,
        syncedAt: Date.now(),
        peers: formattedPeers,
        messages: formattedMessages,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5. CHAT BOOTSTRAP (Loads state on launch)
  app.get("/api/chat/bootstrap", async (req, res) => {
    const userIdentifier = (req.query.userIdentifier as string) || "";
    const cleanUser = cleanDomain(userIdentifier);

    try {
      const [dbChannels, dbMessages, dbPeers] = await Promise.all([
        neonDb.getChannels(),
        neonDb.getMessages("general", cleanUser),
        cleanUser ? neonDb.getPeers(cleanUser) : Promise.resolve([]),
      ]);

      const formattedChannels: ChatChannel[] = (dbChannels as any[]).map((c: any) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        createdAt: c.created_at,
        isDefault: c.id === "general",
      }));

      const formattedMessages: ChatMessage[] = (dbMessages as MessageRecord[]).map((m: MessageRecord) => ({
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

      const formattedPeers: PeerIdentity[] = (dbPeers as PeerRecord[]).map((p: PeerRecord) => ({
        domain: p.peer_domain,
        username: p.username,
        avatarColor: p.avatar_color,
        inboxUrl: p.inbox_url || `https://${p.peer_domain}/api/crawler/ping`,
        status: p.status as any,
        direction: p.direction as any,
        addedAt: p.added_at,
        lastSeen: p.last_seen,
        crawlerTags: getUserCrawlerTags(p.username, p.peer_domain),
      }));

      const { domain: autoDomain, username: autoUsername } = getNodeIdentity(req);
      const effectiveUser = cleanUser || autoDomain;
      const effectiveUsername = autoUsername || deriveSubdomain(effectiveUser);

      res.json({
        myDomain: effectiveUser,
        myUsername: effectiveUsername,
        myAvatarColor: nodeConfig.avatarColor,
        customStatus: nodeConfig.customStatus,
        crawlerTags: getUserCrawlerTags(effectiveUsername, effectiveUser),
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
      const { domain: autoDomain, username: autoUsername } = getNodeIdentity(req);
      const effectiveUser = cleanUser || autoDomain;
      const effectiveUsername = autoUsername || deriveSubdomain(effectiveUser);
      res.json({
        myDomain: effectiveUser,
        myUsername: effectiveUsername,
        myAvatarColor: nodeConfig.avatarColor,
        customStatus: nodeConfig.customStatus,
        crawlerTags: getUserCrawlerTags(effectiveUsername, effectiveUser),
        channels: [{ id: "general", name: "general", description: "Global broadcast channel for all connected peers.", createdAt: 1700000000000, isDefault: true }],
        messages: [],
        peers: [],
        databaseConfigured: neonDb.isConfigured(),
        databaseError: err.message || "Failed to load database state",
        serverTime: Date.now(),
      });
    }
  });

  // 6. CHANNEL & DIRECT MESSAGES
  app.post("/api/chat/message", async (req, res) => {
    try {
      const payload = req.body?.message || req.body || {};
      const {
        targetId,
        targetType = "channel",
        text = "",
        imageUrl,
        replyTo,
        senderId,
        senderName,
        senderColor,
        id: customId,
        timestamp: customTimestamp,
      } = payload;

      const myDomain = senderId || getAppDomain(req);
      const cleanSenderDomain = cleanDomain(myDomain);
      const cleanTargetId = targetType === "channel" ? (targetId || "general").trim().toLowerCase() : cleanDomain(targetId);

      if (!targetId || (!String(text).trim() && !imageUrl)) {
        return res.status(400).json({ error: "Missing required message fields" });
      }

      const newMessageId = customId || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const now = customTimestamp || Date.now();
      const msgRecord: MessageRecord = {
        id: newMessageId,
        target_id: cleanTargetId,
        target_type: targetType,
        sender_id: cleanSenderDomain,
        sender_domain: cleanSenderDomain,
        sender_name: senderName || nodeConfig.username,
        sender_color: senderColor || nodeConfig.avatarColor,
        text: String(text).trim(),
        image_url: imageUrl || undefined,
        reply_to: replyTo || undefined,
        timestamp: now,
      };

      await neonDb.insertMessage(msgRecord);

      const newMessage: ChatMessage = {
        id: msgRecord.id,
        targetId: cleanTargetId,
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
        crawlerPingAck: true,
      };

      res.json({ success: true, message: newMessage });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to save message" });
    }
  });

  // 7. CREATE CHANNEL
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

    res.json({ success: true, channel: newChan });
  });

  // 8. DELETE / CANCEL PEER
  app.delete("/api/peer/:domain", async (req, res) => {
    const rawTarget = req.params.domain || "";
    const clean = cleanDomain(rawTarget).replace(/^[#@]+/, "");
    const peerUsername = req.query.peerUsername ? String(req.query.peerUsername).trim().toLowerCase().replace(/^[#@]+/, "") : "";
    const currentDomain = getAppDomain(req);
    const resolvedTarget = resolveTargetHost(clean, currentDomain);
    const ownerDomain = cleanDomain((req.query.ownerDomain as string) || currentDomain);

    const targetsToDelete = Array.from(new Set([clean, peerUsername, resolvedTarget, deriveSubdomain(clean)].filter(Boolean)));
    for (const t of targetsToDelete) {
      await neonDb.deletePeer(ownerDomain, t);
      await neonDb.deletePeer(t, ownerDomain);
      await neonDb.deletePeer(currentDomain, t);
    }

    // Forward decline/cancel to remote if remote host
    const remoteHost = resolvedTarget.includes(".") ? resolvedTarget : (clean.includes(".") ? clean : null);
    if (remoteHost && remoteHost !== cleanDomain(currentDomain) && !remoteHost.includes("@")) {
      for (const proto of ["https", "http"]) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 2000);
          await fetch(`${proto}://${remoteHost}/api/crawler/ping`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "friend_decline",
              senderDomain: ownerDomain,
              targetIdentifier: remoteHost,
              timestamp: Date.now(),
            }),
            signal: controller.signal,
          });
          clearTimeout(timeout);
          break;
        } catch (_) {}
      }
    }

    res.json({ success: true, domain: clean });
  });

  // 9. CLEAR CHAT
  app.post("/api/chat/clear", async (req, res) => {
    const { targetId } = req.body;
    if (targetId) {
      await neonDb.clearMessages(targetId);
    }
    res.json({ success: true, targetId });
  });

  // 10. CONFIGURE NODE
  app.post("/api/node/configure", (req, res) => {
    const { domain, username, avatarColor, customStatus } = req.body;
    if (domain !== undefined) nodeConfig.domain = cleanDomain(domain);
    if (username !== undefined) nodeConfig.username = username.trim();
    if (avatarColor !== undefined) nodeConfig.avatarColor = avatarColor;
    if (customStatus !== undefined) nodeConfig.customStatus = customStatus;
    res.json({ success: true, nodeConfig });
  });

  // Global catch-all error middleware
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Express uncaught error:", err);
    if (!res.headersSent) {
      res.status(200).json({
        error: err?.message || "Internal server error",
        failed: true,
      });
    }
  });

  return app;
}
