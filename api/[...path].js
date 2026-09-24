// src/app-server.ts
import express from "express";
import cors from "cors";

// src/db/neon.ts
import { neon } from "@neondatabase/serverless";
import fs from "fs";
import path from "path";
function getWritableStorePath(filename) {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NODE_ENV === "production") {
    return path.join("/tmp", filename);
  }
  try {
    return path.resolve(process.cwd(), filename);
  } catch (_) {
    return path.join("/tmp", filename);
  }
}
var STORE_PATH = getWritableStorePath("dconnect_data_store.json");
var PersistentStore = class {
  constructor() {
    this.users = /* @__PURE__ */ new Map();
    this.channels = /* @__PURE__ */ new Map();
    this.messages = [];
    this.peers = /* @__PURE__ */ new Map();
    this.channels.set("general", {
      id: "general",
      name: "general",
      description: "Global broadcast channel for all connected peers.",
      created_at: 17e11
    });
    this.loadFromDisk();
  }
  loadFromDisk() {
    try {
      if (fs.existsSync(STORE_PATH)) {
        const raw = fs.readFileSync(STORE_PATH, "utf-8");
        const data = JSON.parse(raw);
        if (data.users && Array.isArray(data.users)) {
          this.users = new Map(data.users.map((u) => [u.id, u]));
        }
        if (data.channels && Array.isArray(data.channels)) {
          this.channels = new Map(data.channels.map((c) => [c.id, c]));
        }
        if (data.messages && Array.isArray(data.messages)) {
          this.messages = data.messages;
        }
        if (data.peers && Array.isArray(data.peers)) {
          this.peers = new Map(data.peers.map((p) => [p.id, p]));
        }
      }
    } catch (_) {
    }
  }
  saveToDisk() {
    try {
      const data = {
        users: Array.from(this.users.values()),
        channels: Array.from(this.channels.values()),
        messages: this.messages.slice(-500),
        peers: Array.from(this.peers.values())
      };
      fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf-8");
    } catch (_) {
    }
  }
};
var memoryStore = new PersistentStore();
function cleanPostgresUrl(val) {
  if (!val || typeof val !== "string") return null;
  let cleaned = val.trim();
  if (cleaned.startsWith("psql ")) {
    cleaned = cleaned.slice(5).trim();
  }
  cleaned = cleaned.replace(/^['"]+/, "").replace(/['"]+$/, "").trim();
  if (cleaned.startsWith("postgres://") || cleaned.startsWith("postgresql://")) {
    if (cleaned.includes("neon.tech") && !cleaned.includes("sslmode=")) {
      cleaned += cleaned.includes("?") ? "&sslmode=require" : "?sslmode=require";
    }
    return cleaned;
  }
  return null;
}
var ALL_DB_ENV_KEYS = [
  "POSTGRES_URL",
  "DATABASE_URL",
  "POSTGRES_HOST",
  "PGPASSWORD",
  "POSTGRES_DATABASE",
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NO_SSL",
  "POSTGRESQL_URL",
  "NEON_DATABASE_URL",
  "NEON_DB_URL",
  "DB_URL",
  "PGHOST",
  "POSTGRES_USER",
  "PGUSER"
];
function getDetectedDbEnvKeys() {
  return ALL_DB_ENV_KEYS.filter((k) => Boolean(process.env[k] && process.env[k]?.trim()));
}
function getDbUrl() {
  const envCandidates = [
    process.env.POSTGRES_URL,
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.DATABASE_URL_UNPOOLED,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL_NO_SSL,
    process.env.POSTGRESQL_URL,
    process.env.NEON_DATABASE_URL,
    process.env.NEON_DB_URL,
    process.env.DB_URL
  ];
  for (const candidate of envCandidates) {
    const cleaned = cleanPostgresUrl(candidate);
    if (cleaned) return cleaned;
  }
  const host = process.env.POSTGRES_HOST || process.env.PGHOST;
  const password = process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD;
  const database = process.env.POSTGRES_DATABASE || process.env.PGDATABASE || "neondb";
  const user = process.env.POSTGRES_USER || process.env.PGUSER || "neondb_owner";
  if (host && password) {
    const cleanHost = host.trim().replace(/^['"]+/, "").replace(/['"]+$/, "");
    const cleanUser = user.trim().replace(/^['"]+/, "").replace(/['"]+$/, "");
    const cleanPass = password.trim().replace(/^['"]+/, "").replace(/['"]+$/, "");
    const cleanDb = database.trim().replace(/^['"]+/, "").replace(/['"]+$/, "");
    return `postgres://${encodeURIComponent(cleanUser)}:${encodeURIComponent(cleanPass)}@${cleanHost}/${cleanDb}?sslmode=require`;
  }
  return null;
}
var tableInitPromise = null;
async function initTables(sql) {
  if (tableInitPromise) return tableInitPromise;
  tableInitPromise = (async () => {
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          name TEXT NOT NULL,
          picture TEXT,
          domain TEXT,
          created_at BIGINT NOT NULL,
          last_active BIGINT NOT NULL
        );
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS channels (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          created_at BIGINT NOT NULL,
          created_by TEXT
        );
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          target_id TEXT NOT NULL,
          target_type TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          sender_domain TEXT NOT NULL,
          sender_name TEXT NOT NULL,
          sender_color TEXT NOT NULL,
          text TEXT,
          image_url TEXT,
          reply_to TEXT,
          timestamp BIGINT NOT NULL
        );
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS peers (
          id TEXT PRIMARY KEY,
          owner_domain TEXT NOT NULL,
          peer_domain TEXT NOT NULL,
          username TEXT NOT NULL,
          avatar_color TEXT NOT NULL,
          inbox_url TEXT,
          status TEXT NOT NULL,
          direction TEXT NOT NULL,
          added_at BIGINT NOT NULL,
          last_seen BIGINT NOT NULL
        );
      `;
      await sql`
        INSERT INTO channels (id, name, description, created_at, created_by)
        VALUES ('general', 'general', 'Global broadcast channel for all connected peers.', ${Date.now()}, 'system')
        ON CONFLICT (id) DO NOTHING;
      `;
    } catch (err) {
      console.error("Neon table initialization error:", err);
      tableInitPromise = null;
      throw err;
    }
  })();
  return tableInitPromise;
}
var neonDb = {
  isConfigured() {
    return Boolean(getDbUrl());
  },
  setDbUrl(_url) {
  },
  async getStatus() {
    const detectedEnvKeys = getDetectedDbEnvKeys();
    const url = getDbUrl();
    const isDeployed = Boolean(
      process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NODE_ENV === "production"
    );
    if (!url) {
      return {
        configured: false,
        engine: isDeployed ? "Error: Database Environment Variable Missing" : "Local Memory Fallback (Dev Only)",
        error: isDeployed ? "DATABASE_URL_NOT_FOUND" : "NO_DATABASE_URL_CONFIGURED",
        message: isDeployed ? `No PostgreSQL database URL detected in environment variables on Vercel. Checked candidate keys: ${ALL_DB_ENV_KEYS.join(", ")}. If you already added POSTGRES_URL or DATABASE_URL in Vercel Project Settings, ensure it is assigned to both Production and Preview environments, then trigger a REDEPLOY in Vercel.` : "Running in local development without a database URL. Set POSTGRES_URL or DATABASE_URL in .env to connect Neon.",
        detectedEnvKeys,
        checkedEnvKeys: ALL_DB_ENV_KEYS,
        stats: {
          usersCount: memoryStore.users.size,
          peersCount: memoryStore.peers.size,
          messagesCount: memoryStore.messages.length,
          channelsCount: memoryStore.channels.size
        }
      };
    }
    try {
      const sql = neon(url);
      await initTables(sql);
      const res = await sql`SELECT current_database() as db, version() as ver;`;
      let usersCount = 0;
      let peersCount = 0;
      let messagesCount = 0;
      let channelsCount = 0;
      try {
        const u = await sql`SELECT count(*) as count FROM users;`;
        usersCount = Number(u[0]?.count || 0);
        const p = await sql`SELECT count(*) as count FROM peers;`;
        peersCount = Number(p[0]?.count || 0);
        const m = await sql`SELECT count(*) as count FROM messages;`;
        messagesCount = Number(m[0]?.count || 0);
        const c = await sql`SELECT count(*) as count FROM channels;`;
        channelsCount = Number(c[0]?.count || 0);
      } catch (_) {
      }
      return {
        configured: true,
        engine: "Neon Serverless PostgreSQL (Live)",
        database: res[0]?.db,
        message: `Connected successfully to Neon PostgreSQL database via ${detectedEnvKeys.join(", ")}. All friend requests, messages, and accounts are persisted.`,
        detectedEnvKeys,
        checkedEnvKeys: ALL_DB_ENV_KEYS,
        stats: {
          usersCount,
          peersCount,
          messagesCount,
          channelsCount
        }
      };
    } catch (err) {
      return {
        configured: false,
        engine: "Neon PostgreSQL Connection Failed",
        error: err?.message || "Database connection error",
        message: `Database URL was detected (${detectedEnvKeys.join(", ")}), but connection failed: ${err.message}. Please check your Neon project status, database password, and network access.`,
        detectedEnvKeys,
        checkedEnvKeys: ALL_DB_ENV_KEYS,
        stats: {
          usersCount: memoryStore.users.size,
          peersCount: memoryStore.peers.size,
          messagesCount: memoryStore.messages.length,
          channelsCount: memoryStore.channels.size
        }
      };
    }
  },
  // USERS
  async upsertUser(user) {
    const now = Date.now();
    const url = getDbUrl();
    const existing = memoryStore.users.get(user.id) || memoryStore.users.get(user.email.toLowerCase().trim());
    const updated = {
      id: user.id,
      email: user.email.toLowerCase().trim(),
      name: user.name || user.email.split("@")[0],
      picture: user.picture || existing?.picture,
      domain: user.domain || existing?.domain,
      created_at: existing ? existing.created_at : now,
      last_active: now
    };
    memoryStore.users.set(user.id, updated);
    memoryStore.users.set(updated.email, updated);
    memoryStore.saveToDisk();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        await sql`
          INSERT INTO users (id, email, name, picture, domain, created_at, last_active)
          VALUES (${updated.id}, ${updated.email}, ${updated.name}, ${updated.picture || null}, ${updated.domain || null}, ${updated.created_at}, ${updated.last_active})
          ON CONFLICT (id) DO UPDATE SET
            email = EXCLUDED.email,
            name = EXCLUDED.name,
            picture = COALESCE(EXCLUDED.picture, users.picture),
            domain = COALESCE(EXCLUDED.domain, users.domain),
            last_active = EXCLUDED.last_active;
        `;
      } catch (err) {
        console.error("Neon upsertUser error:", err);
      }
    }
    return updated;
  },
  async getUser(idOrEmail) {
    const clean = (idOrEmail || "").toLowerCase().trim();
    const url = getDbUrl();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        const rows = await sql`
          SELECT * FROM users WHERE id = ${idOrEmail} OR LOWER(email) = ${clean} LIMIT 1;
        `;
        if (rows && rows.length > 0) {
          const row = rows[0];
          return {
            id: row.id,
            email: row.email,
            name: row.name,
            picture: row.picture,
            domain: row.domain,
            created_at: Number(row.created_at),
            last_active: Number(row.last_active)
          };
        }
      } catch (err) {
        console.error("Neon getUser error:", err);
      }
    }
    return memoryStore.users.get(idOrEmail) || memoryStore.users.get(clean) || null;
  },
  async getAllUsers() {
    const url = getDbUrl();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        const rows = await sql`SELECT * FROM users ORDER BY last_active DESC LIMIT 100;`;
        return rows.map((row) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          picture: row.picture,
          domain: row.domain,
          created_at: Number(row.created_at),
          last_active: Number(row.last_active)
        }));
      } catch (err) {
        console.error("Neon getAllUsers error:", err);
      }
    }
    return Array.from(memoryStore.users.values()).sort((a, b) => b.last_active - a.last_active);
  },
  // CHANNELS
  async getChannels() {
    const url = getDbUrl();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        const rows = await sql`SELECT * FROM channels ORDER BY created_at ASC;`;
        if (rows.length > 0) {
          return rows.map((row) => ({
            id: row.id,
            name: row.name,
            description: row.description || "",
            created_at: Number(row.created_at),
            created_by: row.created_by
          }));
        }
      } catch (err) {
        console.error("Neon getChannels error:", err);
      }
    }
    return Array.from(memoryStore.channels.values());
  },
  async createChannel(channel) {
    memoryStore.channels.set(channel.id, channel);
    memoryStore.saveToDisk();
    const url = getDbUrl();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        await sql`
          INSERT INTO channels (id, name, description, created_at, created_by)
          VALUES (${channel.id}, ${channel.name}, ${channel.description || ""}, ${channel.created_at}, ${channel.created_by || null})
          ON CONFLICT (id) DO NOTHING;
        `;
      } catch (err) {
        console.error("Neon createChannel error:", err);
      }
    }
    return channel;
  },
  // MESSAGES
  async insertMessage(message) {
    memoryStore.messages.push(message);
    if (memoryStore.messages.length > 500) {
      memoryStore.messages = memoryStore.messages.slice(-500);
    }
    memoryStore.saveToDisk();
    const url = getDbUrl();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        const serializedReply = message.reply_to ? JSON.stringify(message.reply_to) : null;
        await sql`
          INSERT INTO messages (id, target_id, target_type, sender_id, sender_domain, sender_name, sender_color, text, image_url, reply_to, timestamp)
          VALUES (
            ${message.id},
            ${message.target_id},
            ${message.target_type},
            ${message.sender_id},
            ${message.sender_domain},
            ${message.sender_name},
            ${message.sender_color},
            ${message.text || null},
            ${message.image_url || null},
            ${serializedReply},
            ${message.timestamp}
          )
          ON CONFLICT (id) DO NOTHING;
        `;
      } catch (err) {
        console.error("Neon insertMessage error:", err);
      }
    }
    return message;
  },
  async getMessages(targetId, userIdentifierOrLimit, limitNum = 200) {
    let target = targetId ? targetId.trim().toLowerCase() : void 0;
    let userIdentifier;
    let limit = 200;
    if (typeof userIdentifierOrLimit === "number") {
      limit = userIdentifierOrLimit;
    } else if (typeof userIdentifierOrLimit === "string") {
      const parsed = parseInt(userIdentifierOrLimit, 10);
      if (!isNaN(parsed) && String(parsed) === userIdentifierOrLimit.trim()) {
        limit = parsed;
      } else {
        userIdentifier = userIdentifierOrLimit.trim().toLowerCase();
      }
    }
    if (typeof limitNum === "number") {
      limit = limitNum;
    }
    const url = getDbUrl();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        let rows;
        if (target && userIdentifier) {
          rows = await sql`
            SELECT * FROM messages 
            WHERE (target_id = ${target})
               OR (target_type = 'p2p' AND (
                    (LOWER(sender_id) = ${userIdentifier} AND LOWER(target_id) = ${target}) OR
                    (LOWER(sender_id) = ${target} AND LOWER(target_id) = ${userIdentifier}) OR
                    (LOWER(sender_domain) = ${userIdentifier} AND LOWER(target_id) = ${target}) OR
                    (LOWER(sender_domain) = ${target} AND LOWER(target_id) = ${userIdentifier})
                  ))
            ORDER BY timestamp ASC 
            LIMIT ${limit};
          `;
        } else if (userIdentifier) {
          rows = await sql`
            SELECT * FROM messages 
            WHERE target_type = 'channel'
               OR target_id = 'general'
               OR LOWER(target_id) = ${userIdentifier}
               OR LOWER(sender_id) = ${userIdentifier}
               OR LOWER(sender_domain) = ${userIdentifier}
            ORDER BY timestamp ASC 
            LIMIT ${limit};
          `;
        } else if (target) {
          rows = await sql`
            SELECT * FROM messages 
            WHERE target_id = ${target} OR LOWER(sender_domain) = ${target} OR LOWER(sender_id) = ${target}
            ORDER BY timestamp ASC 
            LIMIT ${limit};
          `;
        } else {
          rows = await sql`
            SELECT * FROM messages 
            ORDER BY timestamp ASC 
            LIMIT ${limit};
          `;
        }
        return rows.map((row) => ({
          id: row.id,
          target_id: row.target_id,
          target_type: row.target_type,
          sender_id: row.sender_id,
          sender_domain: row.sender_domain,
          sender_name: row.sender_name,
          sender_color: row.sender_color,
          text: row.text || "",
          image_url: row.image_url,
          reply_to: row.reply_to ? typeof row.reply_to === "string" ? JSON.parse(row.reply_to) : row.reply_to : void 0,
          timestamp: Number(row.timestamp)
        }));
      } catch (err) {
        console.error("Neon getMessages error:", err);
      }
    }
    if (userIdentifier) {
      return memoryStore.messages.filter(
        (m) => m.target_type === "channel" || m.target_id === "general" || m.target_id.toLowerCase() === userIdentifier || m.sender_id.toLowerCase() === userIdentifier || m.sender_domain.toLowerCase() === userIdentifier
      );
    }
    if (target) {
      return memoryStore.messages.filter(
        (m) => m.target_id === target || m.sender_domain.toLowerCase() === target || m.sender_id.toLowerCase() === target
      );
    }
    return memoryStore.messages.slice(-limit);
  },
  async clearMessages(targetId) {
    if (targetId) {
      memoryStore.messages = memoryStore.messages.filter((m) => m.target_id !== targetId);
    } else {
      memoryStore.messages = [];
    }
    memoryStore.saveToDisk();
    const url = getDbUrl();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        if (targetId) {
          await sql`DELETE FROM messages WHERE target_id = ${targetId};`;
        } else {
          await sql`DELETE FROM messages;`;
        }
      } catch (err) {
        console.error("Neon clearMessages error:", err);
      }
    }
  },
  // PEERS
  async upsertPeer(peer) {
    memoryStore.peers.set(peer.id, peer);
    memoryStore.saveToDisk();
    const url = getDbUrl();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        await sql`
          INSERT INTO peers (id, owner_domain, peer_domain, username, avatar_color, inbox_url, status, direction, added_at, last_seen)
          VALUES (
            ${peer.id},
            ${peer.owner_domain},
            ${peer.peer_domain},
            ${peer.username},
            ${peer.avatar_color},
            ${peer.inbox_url || null},
            ${peer.status},
            ${peer.direction},
            ${peer.added_at},
            ${peer.last_seen}
          )
          ON CONFLICT (id) DO UPDATE SET
            username = EXCLUDED.username,
            avatar_color = EXCLUDED.avatar_color,
            inbox_url = COALESCE(EXCLUDED.inbox_url, peers.inbox_url),
            status = EXCLUDED.status,
            direction = EXCLUDED.direction,
            last_seen = EXCLUDED.last_seen;
        `;
      } catch (err) {
        console.error("Neon upsertPeer error:", err);
      }
    }
    return peer;
  },
  async updatePeerStatus(ownerDomain, peerDomain, status) {
    const cleanOwner = (ownerDomain || "").trim().toLowerCase();
    const cleanPeer = (peerDomain || "").trim().toLowerCase();
    if (!cleanOwner || !cleanPeer) return;
    const id1 = `${cleanOwner}_${cleanPeer}`;
    const id2 = `${cleanPeer}_${cleanOwner}`;
    const now = Date.now();
    const p1 = memoryStore.peers.get(id1);
    if (p1) {
      p1.status = status;
      p1.last_seen = now;
      memoryStore.peers.set(id1, p1);
    }
    const p2 = memoryStore.peers.get(id2);
    if (p2) {
      p2.status = status;
      p2.last_seen = now;
      memoryStore.peers.set(id2, p2);
    }
    memoryStore.saveToDisk();
    const url = getDbUrl();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        await sql`
          UPDATE peers
          SET status = ${status}, last_seen = ${now}
          WHERE (LOWER(owner_domain) = ${cleanOwner} AND LOWER(peer_domain) = ${cleanPeer})
             OR (LOWER(owner_domain) = ${cleanPeer} AND LOWER(peer_domain) = ${cleanOwner})
             OR id = ${id1}
             OR id = ${id2};
        `;
        if (status === "accepted") {
          const rows = await sql`
            SELECT * FROM peers 
            WHERE (LOWER(owner_domain) = ${cleanOwner} AND LOWER(peer_domain) = ${cleanPeer})
               OR (LOWER(owner_domain) = ${cleanPeer} AND LOWER(peer_domain) = ${cleanOwner});
          `;
          const hasOwner = rows.some((r) => (r.owner_domain || "").toLowerCase() === cleanOwner);
          const hasPeer = rows.some((r) => (r.owner_domain || "").toLowerCase() === cleanPeer);
          if (!hasOwner) {
            const cp = rows.find((r) => (r.owner_domain || "").toLowerCase() === cleanPeer);
            await sql`
              INSERT INTO peers (id, owner_domain, peer_domain, username, avatar_color, inbox_url, status, direction, added_at, last_seen)
              VALUES (${id1}, ${cleanOwner}, ${cleanPeer}, ${cp?.username || cleanPeer.split("@")[0]}, ${cp?.avatar_color || "purple"}, ${cp?.inbox_url || null}, 'accepted', 'incoming', ${now}, ${now})
              ON CONFLICT (id) DO UPDATE SET status = 'accepted', last_seen = ${now};
            `;
          }
          if (!hasPeer) {
            const cp = rows.find((r) => (r.owner_domain || "").toLowerCase() === cleanOwner);
            await sql`
              INSERT INTO peers (id, owner_domain, peer_domain, username, avatar_color, inbox_url, status, direction, added_at, last_seen)
              VALUES (${id2}, ${cleanPeer}, ${cleanOwner}, ${cp?.username || cleanOwner.split("@")[0]}, ${cp?.avatar_color || "indigo"}, ${cp?.inbox_url || null}, 'accepted', 'incoming', ${now}, ${now})
              ON CONFLICT (id) DO UPDATE SET status = 'accepted', last_seen = ${now};
            `;
          }
        }
      } catch (err) {
        console.error("Neon updatePeerStatus error:", err);
      }
    }
  },
  async getPeers(ownerDomain) {
    const cleanOwner = (ownerDomain || "").trim().toLowerCase();
    const url = getDbUrl();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        const rows = await sql`
          SELECT * FROM peers 
          WHERE LOWER(owner_domain) = ${cleanOwner} OR LOWER(peer_domain) = ${cleanOwner}
          ORDER BY last_seen DESC;
        `;
        const peersMap = /* @__PURE__ */ new Map();
        const peersToHealAccepted = [];
        for (const row of rows) {
          const rOwner = (row.owner_domain || "").toLowerCase();
          const rPeer = (row.peer_domain || "").toLowerCase();
          const otherDomain = rOwner === cleanOwner ? rPeer : rOwner;
          if (!otherDomain) continue;
          let status = row.status;
          let direction = row.direction;
          if (rOwner !== cleanOwner) {
            direction = direction === "outgoing" ? "incoming" : "outgoing";
          }
          const existing = peersMap.get(otherDomain);
          if (existing) {
            if (status === "accepted" || existing.status === "accepted") {
              existing.status = "accepted";
              peersToHealAccepted.push(otherDomain);
            }
          } else {
            peersMap.set(otherDomain, {
              id: `${cleanOwner}_${otherDomain}`,
              owner_domain: cleanOwner,
              peer_domain: otherDomain,
              username: row.username,
              avatar_color: row.avatar_color,
              inbox_url: row.inbox_url,
              status,
              direction,
              added_at: Number(row.added_at),
              last_seen: Number(row.last_seen)
            });
          }
        }
        try {
          const conversed = await sql`
            SELECT DISTINCT
              CASE 
                WHEN LOWER(sender_id) = ${cleanOwner} OR LOWER(sender_domain) = ${cleanOwner} THEN LOWER(target_id)
                ELSE LOWER(sender_id)
              END as peer_domain
            FROM messages
            WHERE target_type = 'p2p'
              AND (
                LOWER(sender_id) = ${cleanOwner} OR 
                LOWER(sender_domain) = ${cleanOwner} OR 
                LOWER(target_id) = ${cleanOwner}
              );
          `;
          for (const c of conversed) {
            const pd = (c.peer_domain || "").toLowerCase();
            if (pd && pd !== cleanOwner && peersMap.has(pd)) {
              const p = peersMap.get(pd);
              if (p.status !== "accepted") {
                p.status = "accepted";
                peersToHealAccepted.push(pd);
              }
            }
          }
        } catch (_) {
        }
        if (peersToHealAccepted.length > 0) {
          (async () => {
            try {
              for (const pDomain of peersToHealAccepted) {
                await sql`
                  UPDATE peers
                  SET status = 'accepted'
                  WHERE (LOWER(owner_domain) = ${cleanOwner} AND LOWER(peer_domain) = ${pDomain})
                     OR (LOWER(owner_domain) = ${pDomain} AND LOWER(peer_domain) = ${cleanOwner});
                `;
              }
            } catch (_) {
            }
          })();
        }
        return Array.from(peersMap.values());
      } catch (err) {
        console.error("Neon getPeers error:", err);
      }
    }
    return Array.from(memoryStore.peers.values()).filter((p) => p.owner_domain === cleanOwner);
  },
  async deletePeer(ownerDomain, peerDomain) {
    const id = `${ownerDomain}_${peerDomain}`;
    memoryStore.peers.delete(id);
    memoryStore.saveToDisk();
    const url = getDbUrl();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        await sql`
          DELETE FROM peers 
          WHERE owner_domain = ${ownerDomain} AND peer_domain = ${peerDomain};
        `;
      } catch (err) {
        console.error("Neon deletePeer error:", err);
      }
    }
  }
};

// src/app-server.ts
var nodeConfig = {
  domain: "",
  username: "PeerNode_" + Math.floor(1e3 + Math.random() * 9e3),
  avatarColor: "indigo",
  customStatus: "Decentralized node ready"
};
var sseClients = /* @__PURE__ */ new Set();
function broadcast(eventType, payload, excludeClientId) {
  const data = `data: ${JSON.stringify({ type: eventType, payload })}

`;
  for (const client of Array.from(sseClients)) {
    if (excludeClientId && client.clientId && client.clientId === excludeClientId) {
      continue;
    }
    try {
      client.res.write(data);
      if (typeof client.res.flush === "function") {
        client.res.flush();
      }
    } catch (_) {
      sseClients.delete(client);
    }
  }
}
function cleanDomain(input) {
  let cleaned = (input || "").trim().toLowerCase();
  cleaned = cleaned.replace(/^https?:\/\//, "");
  cleaned = cleaned.replace(/\/.*$/, "");
  return cleaned;
}
function deriveSubdomain(domainOrHost) {
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
function parseJwtPayload(token) {
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
function createApp() {
  const app2 = express();
  app2.use(
    cors({
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["*"]
    })
  );
  app2.options("*", cors());
  app2.use(express.json({ limit: "15mb" }));
  app2.use((req, _res, next) => {
    if (req.url && !req.url.startsWith("/api") && !req.url.startsWith("/.well-known") && req.url !== "/favicon.ico") {
      req.url = "/api" + (req.url.startsWith("/") ? req.url : "/" + req.url);
    }
    next();
  });
  app2.get(["/api", "/api/", "/api/index"], (_req, res) => {
    res.json({
      status: "ok",
      service: "D-Connect Decentralized P2P Network",
      database: neonDb.isConfigured() ? "Neon PostgreSQL Active" : "Persistent Local RAM/Disk",
      time: Date.now()
    });
  });
  function getAppDomain(req) {
    if (nodeConfig.domain && nodeConfig.domain.trim()) {
      return nodeConfig.domain;
    }
    const hostHeader = req.headers.host;
    if (hostHeader && !hostHeader.includes("localhost") && !hostHeader.includes("127.0.0.1")) {
      return hostHeader;
    }
    return "my-node.local:3000";
  }
  app2.get("/api/db/status", async (_req, res) => {
    try {
      const status = await neonDb.getStatus();
      res.json({
        ...status,
        envVarsFound: {
          DATABASE_URL: Boolean(process.env.DATABASE_URL),
          POSTGRES_URL: Boolean(process.env.POSTGRES_URL),
          POSTGRES_URL_NON_POOLING: Boolean(process.env.POSTGRES_URL_NON_POOLING)
        },
        guideUrl: "https://neon.com/docs/guides/vercel-managed-integration"
      });
    } catch (err) {
      console.error("api/db/status error:", err);
      res.json({
        configured: false,
        engine: "Neon (Error)",
        message: err.message || "Failed to query Neon PostgreSQL status",
        detectedEnvKeys: [],
        stats: { usersCount: 0, peersCount: 0, messagesCount: 0, channelsCount: 1 },
        envVarsFound: {
          DATABASE_URL: Boolean(process.env.DATABASE_URL),
          POSTGRES_URL: Boolean(process.env.POSTGRES_URL),
          POSTGRES_URL_NON_POOLING: Boolean(process.env.POSTGRES_URL_NON_POOLING)
        },
        guideUrl: "https://neon.com/docs/guides/vercel-managed-integration"
      });
    }
  });
  app2.post("/api/db/configure", async (req, res) => {
    try {
      const { databaseUrl } = req.body;
      if (databaseUrl !== void 0) {
        neonDb.setDbUrl(databaseUrl ? databaseUrl.trim() : null);
      }
      const status = await neonDb.getStatus();
      res.json({ success: true, status });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/users", async (_req, res) => {
    try {
      const users = await neonDb.getAllUsers();
      res.json({ users });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/auth/config", (req, res) => {
    const domain = getAppDomain(req);
    const username = deriveSubdomain(domain);
    const rawAllowed = (process.env.ALLOWED_GMAIL || process.env.ALLOWED_EMAILS || process.env.VITE_ALLOWED_EMAILS || "").trim();
    let allowedEmails = rawAllowed ? rawAllowed.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
    const isWildcard = allowedEmails.some(
      (e) => e === "*" || e === "*@*" || e === "*@gmail.com"
    );
    res.json({
      allowedEmails,
      hasRestriction: allowedEmails.length > 0 && !isWildcard,
      clientId: process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "962902289698-dk7vjl1smbdeckdg9oe9j5a01m1lrknt.apps.googleusercontent.com",
      domain,
      username
    });
  });
  app2.post("/api/auth/google", async (req, res) => {
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
    const rawAllowed = (process.env.ALLOWED_GMAIL || process.env.ALLOWED_EMAILS || process.env.VITE_ALLOWED_EMAILS || "").trim();
    if (rawAllowed) {
      const allowedList = rawAllowed.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
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
          attemptedEmail: email
        });
      }
    }
    try {
      const user = await neonDb.upsertUser({
        id: userId,
        email,
        name: subdomainUsername,
        picture,
        domain: currentDomain
      });
      res.json({
        success: true,
        user,
        nodeUsername: subdomainUsername,
        message: `Successfully authenticated Google account ${email}. Saved to Neon DB.`
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/auth/callback/google", (_req, res) => {
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
  const handleManifest = (req, res) => {
    const domain = getAppDomain(req);
    const protocol = req.secure || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    res.json({
      protocol: "IMAGXP-P2P/1.0",
      domain,
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
        dbStatus: `${protocol}://${domain}/api/db/status`
      },
      timestamp: Date.now()
    });
  };
  app2.get("/.well-known/imagxp-agent.json", handleManifest);
  app2.get("/api/p2p/manifest", handleManifest);
  app2.post("/api/peer/send-request", async (req, res) => {
    try {
      const {
        senderDomain,
        senderUsername,
        senderAvatarColor = "indigo",
        targetIdentifier,
        note
      } = req.body;
      if (!senderDomain || !targetIdentifier) {
        return res.status(400).json({ error: "Missing senderDomain or targetIdentifier" });
      }
      const cleanSender = cleanDomain(senderDomain);
      const cleanTarget = cleanDomain(targetIdentifier);
      if (cleanSender === cleanTarget) {
        return res.status(400).json({ error: "Cannot send friend request to yourself" });
      }
      const targetUser = await neonDb.getUser(cleanTarget);
      const targetDisplayName = targetUser?.name || cleanTarget.split("@")[0].split(".")[0];
      const targetDomainOrEmail = targetUser?.email || cleanTarget;
      const now = Date.now();
      const senderRecord = {
        id: `${cleanSender}_${targetDomainOrEmail}`,
        owner_domain: cleanSender,
        peer_domain: targetDomainOrEmail,
        username: targetDisplayName,
        avatar_color: "purple",
        inbox_url: `https://${targetDomainOrEmail}/api/p2p/inbox`,
        status: "pending",
        direction: "outgoing",
        added_at: now,
        last_seen: now
      };
      await neonDb.upsertPeer(senderRecord);
      const targetRecord = {
        id: `${targetDomainOrEmail}_${cleanSender}`,
        owner_domain: targetDomainOrEmail,
        peer_domain: cleanSender,
        username: senderUsername || cleanSender.split("@")[0].split(".")[0],
        avatar_color: senderAvatarColor,
        inbox_url: `https://${cleanSender}/api/p2p/inbox`,
        status: "pending",
        direction: "incoming",
        added_at: now,
        last_seen: now
      };
      await neonDb.upsertPeer(targetRecord);
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
        addedAt: now
      });
      broadcast("peer_updated", {
        domain: targetDomainOrEmail,
        ownerDomain: cleanSender,
        username: targetDisplayName,
        avatarColor: "purple",
        status: "pending",
        direction: "outgoing",
        lastSeen: now
      });
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
                timestamp: now
              }),
              signal: controller.signal
            });
            clearTimeout(timeout);
          } catch (_) {
          }
        })();
      }
      res.json({
        success: true,
        message: `Friend request sent to ${targetDomainOrEmail} and saved to Neon DB.`,
        peer: senderRecord
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.post("/api/peer/respond-request", async (req, res) => {
    try {
      const { ownerDomain, peerDomain, accept } = req.body;
      if (!ownerDomain || !peerDomain) {
        return res.status(400).json({ error: "Missing ownerDomain or peerDomain" });
      }
      const cleanOwner = cleanDomain(ownerDomain);
      const cleanPeer = cleanDomain(peerDomain);
      const newStatus = accept ? "accepted" : "rejected";
      await neonDb.updatePeerStatus(cleanOwner, cleanPeer, newStatus);
      await neonDb.updatePeerStatus(cleanPeer, cleanOwner, newStatus);
      broadcast("peer_updated", {
        domain: cleanPeer,
        ownerDomain: cleanOwner,
        status: newStatus,
        lastSeen: Date.now()
      });
      broadcast("peer_updated", {
        domain: cleanOwner,
        ownerDomain: cleanPeer,
        status: newStatus,
        lastSeen: Date.now()
      });
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
                accepted: Boolean(accept)
              }),
              signal: controller.signal
            });
            clearTimeout(timeout);
          } catch (_) {
          }
        })();
      }
      res.json({ success: true, status: newStatus });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.post("/api/p2p/friend-request", async (req, res) => {
    const { fromDomain, fromUsername, fromAvatarColor, fromInboxUrl, note } = req.body;
    if (!fromDomain || !fromUsername) {
      return res.status(400).json({ error: "Missing required peer fields" });
    }
    const domain = cleanDomain(fromDomain);
    const myDomain = getAppDomain(req);
    const now = Date.now();
    const peerObj = {
      id: `${myDomain}_${domain}`,
      owner_domain: myDomain,
      peer_domain: domain,
      username: fromUsername,
      avatar_color: fromAvatarColor || "indigo",
      inbox_url: fromInboxUrl || `https://${domain}/api/p2p/inbox`,
      status: "pending",
      direction: "incoming",
      added_at: now,
      last_seen: now
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
      addedAt: peerObj.added_at
    });
    res.json({ success: true, status: "pending", message: "Friend request received and saved to Neon DB" });
  });
  app2.post("/api/p2p/friend-response", async (req, res) => {
    const { fromDomain, accepted, fromUsername, fromAvatarColor } = req.body;
    if (!fromDomain) {
      return res.status(400).json({ error: "Missing fromDomain" });
    }
    const domain = cleanDomain(fromDomain);
    const myDomain = getAppDomain(req);
    const newStatus = accepted ? "accepted" : "rejected";
    const peerObj = {
      id: `${myDomain}_${domain}`,
      owner_domain: myDomain,
      peer_domain: domain,
      username: fromUsername || domain.split(".")[0],
      avatar_color: fromAvatarColor || "indigo",
      status: newStatus,
      direction: "incoming",
      added_at: Date.now(),
      last_seen: Date.now()
    };
    await neonDb.upsertPeer(peerObj);
    await neonDb.updatePeerStatus(myDomain, domain, newStatus);
    await neonDb.updatePeerStatus(domain, myDomain, newStatus);
    broadcast("peer_updated", {
      domain,
      ownerDomain: myDomain,
      username: peerObj.username,
      avatarColor: peerObj.avatar_color,
      status: peerObj.status,
      direction: peerObj.direction,
      lastSeen: peerObj.last_seen
    });
    res.json({ success: true });
  });
  app2.post("/api/p2p/inbox", async (req, res) => {
    const { id, fromDomain, fromUsername, fromAvatarColor, text, imageUrl, replyTo, timestamp } = req.body;
    if (!fromDomain || !text && !imageUrl) {
      return res.status(400).json({ error: "Invalid message payload" });
    }
    const senderDomain = cleanDomain(fromDomain);
    const myDomain = getAppDomain(req);
    const peerRecord = {
      id: `${myDomain}_${senderDomain}`,
      owner_domain: myDomain,
      peer_domain: senderDomain,
      username: fromUsername || senderDomain,
      avatar_color: fromAvatarColor || "indigo",
      inbox_url: `https://${senderDomain}/api/p2p/inbox`,
      status: "accepted",
      direction: "incoming",
      added_at: Date.now(),
      last_seen: Date.now()
    };
    await neonDb.upsertPeer(peerRecord);
    await neonDb.updatePeerStatus(myDomain, senderDomain, "accepted");
    await neonDb.updatePeerStatus(senderDomain, myDomain, "accepted");
    const messageRecord = {
      id: id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      target_id: senderDomain,
      target_type: "p2p",
      sender_id: senderDomain,
      sender_domain: senderDomain,
      sender_name: fromUsername || peerRecord.username,
      sender_color: fromAvatarColor || peerRecord.avatar_color,
      text: (text || "").trim(),
      image_url: imageUrl || void 0,
      reply_to: replyTo || void 0,
      timestamp: timestamp || Date.now()
    };
    await neonDb.insertMessage(messageRecord);
    const chatMsg = {
      id: messageRecord.id,
      targetId: senderDomain,
      targetType: "p2p",
      senderId: senderDomain,
      senderDomain,
      senderName: messageRecord.sender_name,
      senderColor: messageRecord.sender_color,
      text: messageRecord.text || "",
      imageUrl: messageRecord.image_url,
      replyTo: messageRecord.reply_to,
      reactions: {},
      timestamp: messageRecord.timestamp,
      status: "delivered"
    };
    broadcast("message_new", chatMsg);
    res.json({ success: true, messageId: chatMsg.id, status: "delivered" });
  });
  app2.get("/api/p2p/sync", async (req, res) => {
    const peerDomain = cleanDomain(req.query.peerDomain || "");
    const since = parseInt(req.query.since || "0", 10);
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
        targetType: m.target_type,
        senderId: m.sender_id,
        senderDomain: m.sender_domain,
        senderName: m.sender_name,
        senderColor: m.sender_color,
        text: m.text || "",
        imageUrl: m.image_url,
        replyTo: m.reply_to,
        timestamp: m.timestamp,
        status: "delivered"
      })),
      timestamp: Date.now()
    });
  });
  app2.get("/api/chat/bootstrap", async (req, res) => {
    const userIdentifier = (req.query.userIdentifier || req.query.userEmail || getAppDomain(req)).trim();
    const cleanUser = cleanDomain(userIdentifier);
    try {
      const [dbChannels, dbMessages, dbPeers] = await Promise.all([
        neonDb.getChannels(),
        neonDb.getMessages(void 0, cleanUser),
        neonDb.getPeers(cleanUser)
      ]);
      const formattedChannels = dbChannels.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        createdAt: c.created_at,
        isDefault: c.id === "general"
      }));
      const formattedMessages = dbMessages.map((m) => ({
        id: m.id,
        targetId: m.target_id,
        targetType: m.target_type,
        senderId: m.sender_id,
        senderDomain: m.sender_domain,
        senderName: m.sender_name,
        senderColor: m.sender_color,
        text: m.text || "",
        imageUrl: m.image_url,
        replyTo: m.reply_to,
        reactions: {},
        timestamp: m.timestamp,
        status: "delivered"
      }));
      const formattedPeers = dbPeers.map((p) => ({
        domain: p.peer_domain,
        username: p.username,
        avatarColor: p.avatar_color,
        inboxUrl: p.inbox_url || `https://${p.peer_domain}/api/p2p/inbox`,
        status: p.status,
        direction: p.direction,
        addedAt: p.added_at,
        lastSeen: p.last_seen
      }));
      res.json({
        myDomain: cleanUser,
        myUsername: nodeConfig.username,
        myAvatarColor: nodeConfig.avatarColor,
        customStatus: nodeConfig.customStatus,
        channels: formattedChannels.length > 0 ? formattedChannels : [{ id: "general", name: "general", createdAt: Date.now(), isDefault: true }],
        messages: formattedMessages,
        peers: formattedPeers,
        databaseConfigured: neonDb.isConfigured(),
        serverTime: Date.now()
      });
    } catch (err) {
      console.error("Bootstrap error, falling back to in-memory store:", err);
      res.json({
        myDomain: cleanUser,
        myUsername: nodeConfig.username,
        myAvatarColor: nodeConfig.avatarColor,
        customStatus: nodeConfig.customStatus,
        channels: [{ id: "general", name: "general", description: "Global broadcast channel for all connected peers.", createdAt: 17e11, isDefault: true }],
        messages: [],
        peers: [],
        databaseConfigured: neonDb.isConfigured(),
        databaseError: err.message || "Failed to load database state",
        serverTime: Date.now()
      });
    }
  });
  app2.get("/api/chat/stream", (req, res) => {
    const clientId = req.query.clientId || "";
    const userIdentifier = req.query.userIdentifier || "";
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders?.();
    res.write(`data: ${JSON.stringify({ type: "connected", serverTime: Date.now() })}

`);
    const client = { res, clientId, userIdentifier };
    sseClients.add(client);
    const ping = setInterval(() => {
      try {
        res.write(`: ping

`);
      } catch (_) {
        clearInterval(ping);
        sseClients.delete(client);
      }
    }, 15e3);
    req.on("close", () => {
      clearInterval(ping);
      sseClients.delete(client);
    });
  });
  app2.post("/api/chat/sync", async (req, res) => {
    try {
      const { userIdentifier, peers, messages } = req.body;
      const cleanUser = cleanDomain(userIdentifier);
      if (!cleanUser) {
        return res.status(400).json({ error: "Missing userIdentifier" });
      }
      let savedPeers = 0;
      let savedMessages = 0;
      if (Array.isArray(peers) && peers.length > 0) {
        for (const p of peers) {
          const peerDomain = cleanDomain(p.domain);
          if (!peerDomain || peerDomain === cleanUser) continue;
          await neonDb.upsertPeer({
            id: `${cleanUser}_${peerDomain}`,
            owner_domain: cleanUser,
            peer_domain: peerDomain,
            username: p.username || peerDomain.split("@")[0].split(".")[0],
            avatar_color: p.avatarColor || "purple",
            inbox_url: p.inboxUrl || `https://${peerDomain}/api/p2p/inbox`,
            status: p.status || "accepted",
            direction: p.direction || "outgoing",
            added_at: p.addedAt || Date.now(),
            last_seen: p.lastSeen || Date.now()
          });
          if (p.status === "accepted") {
            await neonDb.upsertPeer({
              id: `${peerDomain}_${cleanUser}`,
              owner_domain: peerDomain,
              peer_domain: cleanUser,
              username: cleanUser.split("@")[0].split(".")[0],
              avatar_color: "indigo",
              inbox_url: `https://${cleanUser}/api/p2p/inbox`,
              status: "accepted",
              direction: "incoming",
              added_at: p.addedAt || Date.now(),
              last_seen: p.lastSeen || Date.now()
            });
          }
          savedPeers++;
        }
      }
      if (Array.isArray(messages) && messages.length > 0) {
        for (const m of messages) {
          if (!m.id || !m.text && !m.imageUrl) continue;
          await neonDb.insertMessage({
            id: m.id,
            target_id: m.targetId || "general",
            target_type: m.targetType || "p2p",
            sender_id: cleanDomain(m.senderId || cleanUser),
            sender_domain: cleanDomain(m.senderDomain || cleanUser),
            sender_name: m.senderName || cleanUser.split("@")[0].split(".")[0],
            sender_color: m.senderColor || "indigo",
            text: m.text || "",
            image_url: m.imageUrl,
            reply_to: m.replyTo,
            timestamp: m.timestamp || Date.now()
          });
          savedMessages++;
        }
      }
      res.json({ success: true, savedPeers, savedMessages });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.post("/api/chat/message", async (req, res) => {
    const {
      targetId,
      targetType = "channel",
      text = "",
      imageUrl,
      replyTo,
      clientId,
      senderId,
      senderName,
      senderColor
    } = req.body;
    const myDomain = senderId || getAppDomain(req);
    const cleanSenderDomain = cleanDomain(myDomain);
    const cleanTargetId = targetType === "channel" ? targetId.trim().toLowerCase() : cleanDomain(targetId);
    if (!targetId || !text.trim() && !imageUrl) {
      return res.status(400).json({ error: "Missing required message fields" });
    }
    const newMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const msgRecord = {
      id: newMessageId,
      target_id: cleanTargetId,
      target_type: targetType,
      sender_id: cleanSenderDomain,
      sender_domain: cleanSenderDomain,
      sender_name: senderName || nodeConfig.username,
      sender_color: senderColor || nodeConfig.avatarColor,
      text: text.trim(),
      image_url: imageUrl || void 0,
      reply_to: replyTo || void 0,
      timestamp: Date.now()
    };
    await neonDb.insertMessage(msgRecord);
    const newMessage = {
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
      status: "delivered"
    };
    broadcast("message_new", newMessage, clientId);
    if (targetType === "p2p") {
      const cleanPeerDomain = cleanDomain(targetId);
      await neonDb.updatePeerStatus(cleanSenderDomain, cleanPeerDomain, "accepted");
      await neonDb.updatePeerStatus(cleanPeerDomain, cleanSenderDomain, "accepted");
      if (cleanPeerDomain.includes(".") && !cleanPeerDomain.includes("@")) {
        (async () => {
          for (const proto of ["https", "http"]) {
            try {
              const remoteUrl = `${proto}://${cleanPeerDomain}/api/p2p/inbox`;
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 4e3);
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
                  timestamp: newMessage.timestamp
                }),
                signal: controller.signal
              });
              clearTimeout(timeout);
              if (response.ok) break;
            } catch (_) {
            }
          }
        })();
      }
    }
    res.json({ success: true, message: newMessage });
  });
  app2.post("/api/chat/channel", async (req, res) => {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: "Missing channel name" });
    const cleanName = name.toLowerCase().trim().replace(/[^a-z0-9_-]/g, "-");
    const newChan = {
      id: `chan_${cleanName}`,
      name: cleanName,
      description: (description || "").trim(),
      createdAt: Date.now()
    };
    await neonDb.createChannel({
      id: newChan.id,
      name: newChan.name,
      description: newChan.description || "",
      created_at: newChan.createdAt
    });
    broadcast("channel_new", newChan);
    res.json({ success: true, channel: newChan });
  });
  app2.delete("/api/peer/:domain", async (req, res) => {
    const clean = cleanDomain(req.params.domain);
    const ownerDomain = cleanDomain(req.query.ownerDomain || getAppDomain(req));
    await neonDb.deletePeer(ownerDomain, clean);
    await neonDb.clearMessages(clean);
    broadcast("peer_deleted", { domain: clean, ownerDomain });
    res.json({ success: true, domain: clean });
  });
  app2.post("/api/chat/clear", async (req, res) => {
    const { targetId } = req.body;
    if (targetId) {
      await neonDb.clearMessages(targetId);
      broadcast("chat_cleared", { targetId });
    }
    res.json({ success: true, targetId });
  });
  app2.post("/api/node/configure", (req, res) => {
    const { domain, username, avatarColor, customStatus } = req.body;
    if (domain !== void 0) nodeConfig.domain = cleanDomain(domain);
    if (username !== void 0) nodeConfig.username = username.trim();
    if (avatarColor !== void 0) nodeConfig.avatarColor = avatarColor;
    if (customStatus !== void 0) nodeConfig.customStatus = customStatus;
    broadcast("node_config_updated", nodeConfig);
    res.json({ success: true, nodeConfig });
  });
  app2.post("/api/chat/sync-client-state", async (req, res) => {
    try {
      const { clientDomain, clientUsername, clientAvatarColor, clientPeers, clientMessages } = req.body || {};
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
              last_seen: p.lastSeen || Date.now()
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
              timestamp: m.timestamp || Date.now()
            });
          }
        }
      }
      res.json({ success: true, syncedAt: Date.now() });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });
  app2.use((err, _req, res, _next) => {
    console.error("Express uncaught route error:", err);
    if (!res.headersSent) {
      res.status(200).json({
        error: err?.message || "Internal server error",
        failed: true
      });
    }
  });
  return app2;
}

// src/api-server.ts
var app = createApp();
function resolveRequestUrl(req) {
  let url = req.url || "/";
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
    }
  }
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
  if (url.startsWith("/api/") && url !== "/api" && url !== "/api/" && !url.startsWith("/api/index")) {
    return url;
  }
  if (url.startsWith("/.well-known/")) {
    return url;
  }
  return url;
}
function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }
  if (req.body && req._body === void 0) {
    req._body = true;
  }
  req.url = resolveRequestUrl(req);
  try {
    return app(req, res);
  } catch (err) {
    console.error("Vercel serverless uncaught error:", err);
    if (!res.headersSent) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: err?.message || "Internal server error", failed: true }));
    }
  }
}
export {
  handler as default
};
