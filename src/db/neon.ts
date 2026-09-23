import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  picture?: string;
  domain?: string;
  created_at: number;
  last_active: number;
}

export interface ChannelRecord {
  id: string;
  name: string;
  description: string;
  created_at: number;
  created_by?: string;
}

export interface MessageRecord {
  id: string;
  target_id: string;
  target_type: string;
  sender_id: string;
  sender_domain: string;
  sender_name: string;
  sender_color: string;
  text?: string;
  image_url?: string;
  reply_to?: any;
  timestamp: number;
}

export interface PeerRecord {
  id: string;
  owner_domain: string;
  peer_domain: string;
  username: string;
  avatar_color: string;
  inbox_url?: string;
  status: string; // 'pending' | 'accepted' | 'rejected' | 'blocked'
  direction: string; // 'incoming' | 'outgoing'
  added_at: number;
  last_seen: number;
}

function getWritableStorePath(filename: string): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join('/tmp', filename);
  }
  try {
    const testFile = path.resolve(process.cwd(), '.write-test');
    fs.writeFileSync(testFile, '1');
    fs.unlinkSync(testFile);
    return path.resolve(process.cwd(), filename);
  } catch (_) {
    return path.join('/tmp', filename);
  }
}

const STORE_PATH = getWritableStorePath('dconnect_data_store.json');

function loadDbUrlFromDisk(): string | null {
  try {
    const p = getWritableStorePath('dconnect_db_url.txt');
    if (fs.existsSync(p)) {
      const u = fs.readFileSync(p, 'utf-8').trim();
      if (u.startsWith('postgres')) return u;
    }
  } catch (_) {}
  return null;
}

function saveDbUrlToDisk(url: string | null): void {
  try {
    const p = getWritableStorePath('dconnect_db_url.txt');
    if (url) {
      fs.writeFileSync(p, url.trim(), 'utf-8');
    } else if (fs.existsSync(p)) {
      fs.unlinkSync(p);
    }
  } catch (_) {}
}

// Persistent Disk + Memory Cache for zero data loss across reloads or server restarts
class PersistentStore {
  users: Map<string, UserRecord> = new Map();
  channels: Map<string, ChannelRecord> = new Map();
  messages: MessageRecord[] = [];
  peers: Map<string, PeerRecord> = new Map();

  constructor() {
    this.channels.set('general', {
      id: 'general',
      name: 'general',
      description: 'Global broadcast channel for all connected peers.',
      created_at: 1700000000000,
    });
    this.loadFromDisk();
  }

  loadFromDisk() {
    try {
      if (fs.existsSync(STORE_PATH)) {
        const raw = fs.readFileSync(STORE_PATH, 'utf-8');
        const data = JSON.parse(raw);
        if (data.users && Array.isArray(data.users)) {
          data.users.forEach((u: UserRecord) => {
            this.users.set(u.id, u);
            this.users.set(u.email.toLowerCase().trim(), u);
          });
        }
        if (data.channels && Array.isArray(data.channels)) {
          data.channels.forEach((c: ChannelRecord) => this.channels.set(c.id, c));
        }
        if (data.messages && Array.isArray(data.messages)) {
          this.messages = data.messages;
        }
        if (data.peers && Array.isArray(data.peers)) {
          data.peers.forEach((p: PeerRecord) => this.peers.set(p.id, p));
        }
      }
    } catch (e) {
      console.warn('Could not read disk store:', e);
    }
  }

  saveToDisk() {
    try {
      const data = {
        users: Array.from(new Set(this.users.values())),
        channels: Array.from(this.channels.values()),
        messages: this.messages.slice(-2000),
        peers: Array.from(this.peers.values()),
      };
      fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.warn('Could not write disk store:', e);
    }
  }

  addMessage(msg: MessageRecord) {
    if (!this.messages.some((m) => m.id === msg.id)) {
      this.messages.push(msg);
      this.saveToDisk();
    }
  }

  upsertPeer(peer: PeerRecord) {
    this.peers.set(peer.id, peer);
    this.saveToDisk();
  }

  updatePeerStatus(ownerDomain: string, peerDomain: string, status: string) {
    const cleanOwner = ownerDomain.trim().toLowerCase();
    const cleanPeer = peerDomain.trim().toLowerCase();
    const id = `${cleanOwner}_${cleanPeer}`;
    let updated = false;

    for (const [key, p] of this.peers.entries()) {
      if (
        key === id ||
        (p.owner_domain.trim().toLowerCase() === cleanOwner &&
          p.peer_domain.trim().toLowerCase() === cleanPeer)
      ) {
        p.status = status;
        p.last_seen = Date.now();
        this.peers.set(key, p);
        updated = true;
      }
    }

    if (updated) {
      this.saveToDisk();
    }
  }

  deletePeer(ownerDomain: string, peerDomain: string) {
    const cleanOwner = ownerDomain.trim().toLowerCase();
    const cleanPeer = peerDomain.trim().toLowerCase();
    const id = `${cleanOwner}_${cleanPeer}`;

    this.peers.delete(id);
    for (const [key, p] of this.peers.entries()) {
      if (
        p.owner_domain.trim().toLowerCase() === cleanOwner &&
        p.peer_domain.trim().toLowerCase() === cleanPeer
      ) {
        this.peers.delete(key);
      }
    }
    this.saveToDisk();
  }

  upsertUser(user: UserRecord) {
    this.users.set(user.id, user);
    this.users.set(user.email.toLowerCase().trim(), user);
    this.saveToDisk();
  }
}

const memoryStore = new PersistentStore();

let customDbUrl: string | null = null;

export function cleanPostgresUrl(val?: string | null): string | null {
  if (!val || typeof val !== 'string') return null;
  let cleaned = val.trim().replace(/^['"]+/, '').replace(/['"]+$/, '').trim();
  if (cleaned.startsWith('postgres://') || cleaned.startsWith('postgresql://')) {
    if (cleaned.includes('neon.tech') && !cleaned.includes('sslmode=')) {
      cleaned += cleaned.includes('?') ? '&sslmode=require' : '?sslmode=require';
    }
    return cleaned;
  }
  return null;
}

export function getDetectedDbEnvKeys(): string[] {
  const keys = [
    'DATABASE_URL',
    'POSTGRES_URL',
    'DATABASE_URL_UNPOOLED',
    'POSTGRES_URL_NON_POOLING',
    'POSTGRES_PRISMA_URL',
    'POSTGRES_URL_NO_SSL',
    'PGHOST',
    'POSTGRES_HOST',
    'VITE_DATABASE_URL',
    'VITE_POSTGRES_URL',
  ];
  return keys.filter((k) => Boolean(process.env[k] && process.env[k]?.trim()));
}

export function getDbUrl(reqDbUrl?: string | null): string | null {
  const cleanedReq = cleanPostgresUrl(reqDbUrl);
  if (cleanedReq) return cleanedReq;

  const cleanedCustom = cleanPostgresUrl(customDbUrl);
  if (cleanedCustom) return cleanedCustom;

  const envCandidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.DATABASE_URL_UNPOOLED,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL_NO_SSL,
    process.env.VITE_DATABASE_URL,
    process.env.VITE_POSTGRES_URL,
  ];

  for (const candidate of envCandidates) {
    const cleaned = cleanPostgresUrl(candidate);
    if (cleaned) return cleaned;
  }

  const host = process.env.POSTGRES_HOST || process.env.PGHOST;
  const user = process.env.POSTGRES_USER || process.env.PGUSER;
  const password = process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD;
  const database = process.env.POSTGRES_DATABASE || process.env.PGDATABASE;

  if (host && user && password && database) {
    return `postgres://${encodeURIComponent(user.trim().replace(/^['"]+/, '').replace(/['"]+$/, ''))}:${encodeURIComponent(password.trim().replace(/^['"]+/, '').replace(/['"]+$/, ''))}@${host.trim()}/${database.trim()}?sslmode=require`;
  }

  const diskUrl = loadDbUrlFromDisk();
  if (diskUrl) {
    const cleanedDisk = cleanPostgresUrl(diskUrl);
    if (cleanedDisk) return cleanedDisk;
  }

  return null;
}

export function setCustomDbUrl(url: string | null) {
  customDbUrl = cleanPostgresUrl(url);
  tableInitPromise = null;
  saveDbUrlToDisk(customDbUrl);
}

let tableInitPromise: Promise<void> | null = null;

async function initTables(sql: any) {
  if (tableInitPromise) return tableInitPromise;

  tableInitPromise = (async () => {
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          name TEXT,
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
          reply_to JSONB,
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

      // Seed general channel if not present
      await sql`
        INSERT INTO channels (id, name, description, created_at)
        VALUES ('general', 'general', 'Global broadcast channel for all connected peers.', 1700000000000)
        ON CONFLICT (id) DO NOTHING;
      `;

      // Sync existing memory/disk store to Neon PostgreSQL
      for (const u of memoryStore.users.values()) {
        try {
          await sql`
            INSERT INTO users (id, email, name, picture, domain, created_at, last_active)
            VALUES (${u.id}, ${u.email}, ${u.name}, ${u.picture || null}, ${u.domain || null}, ${u.created_at}, ${u.last_active})
            ON CONFLICT (id) DO NOTHING;
          `;
        } catch (_) {}
      }

      for (const p of memoryStore.peers.values()) {
        try {
          await sql`
            INSERT INTO peers (id, owner_domain, peer_domain, username, avatar_color, inbox_url, status, direction, added_at, last_seen)
            VALUES (${p.id}, ${p.owner_domain}, ${p.peer_domain}, ${p.username}, ${p.avatar_color}, ${p.inbox_url || null}, ${p.status}, ${p.direction}, ${p.added_at}, ${p.last_seen})
            ON CONFLICT (id) DO NOTHING;
          `;
        } catch (_) {}
      }

      for (const m of memoryStore.messages) {
        try {
          await sql`
            INSERT INTO messages (id, target_id, target_type, sender_id, sender_domain, sender_name, sender_color, text, image_url, reply_to, timestamp)
            VALUES (${m.id}, ${m.target_id}, ${m.target_type}, ${m.sender_id}, ${m.sender_domain}, ${m.sender_name}, ${m.sender_color}, ${m.text || null}, ${m.image_url || null}, ${m.reply_to ? JSON.stringify(m.reply_to) : null}, ${m.timestamp})
            ON CONFLICT (id) DO NOTHING;
          `;
        } catch (_) {}
      }
    } catch (err) {
      console.error('Neon table initialization failed:', err);
    }
  })();

  return tableInitPromise;
}

export const neonDb = {
  isConfigured(): boolean {
    return Boolean(getDbUrl());
  },

  setDbUrl(url: string | null) {
    setCustomDbUrl(url);
  },

  async getStatus(): Promise<{
    configured: boolean;
    engine: string;
    database?: string;
    message: string;
    detectedEnvKeys: string[];
    stats: {
      usersCount: number;
      peersCount: number;
      messagesCount: number;
      channelsCount: number;
    };
  }> {
    const detectedEnvKeys = getDetectedDbEnvKeys();
    const url = getDbUrl();
    if (!url) {
      return {
        configured: false,
        engine: 'Persistent Local Store (Disk & RAM)',
        message:
          detectedEnvKeys.length > 0
            ? `Detected env keys (${detectedEnvKeys.join(', ')}), but connection string format was invalid or incomplete.`
            : 'Running on persistent server storage. Connect a Neon PostgreSQL DATABASE_URL to enable cloud serverless sync.',
        detectedEnvKeys,
        stats: {
          usersCount: memoryStore.users.size,
          peersCount: memoryStore.peers.size,
          messagesCount: memoryStore.messages.length,
          channelsCount: memoryStore.channels.size,
        },
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
      } catch (_) {}

      return {
        configured: true,
        engine: 'Neon Serverless PostgreSQL',
        database: (res as any)[0]?.db,
        message: 'Connected to Neon PostgreSQL database. All friend requests, messages, and accounts are persisted.',
        detectedEnvKeys,
        stats: {
          usersCount,
          peersCount,
          messagesCount,
          channelsCount,
        },
      };
    } catch (err: any) {
      return {
        configured: false,
        engine: 'Neon (Connection Error)',
        message: err.message,
        detectedEnvKeys,
        stats: {
          usersCount: memoryStore.users.size,
          peersCount: memoryStore.peers.size,
          messagesCount: memoryStore.messages.length,
          channelsCount: memoryStore.channels.size,
        },
      };
    }
  },

  // USERS
  async upsertUser(user: {
    id: string;
    email: string;
    name: string;
    picture?: string;
    domain?: string;
  }): Promise<UserRecord> {
    const now = Date.now();
    const url = getDbUrl();

    const existing = memoryStore.users.get(user.id) || memoryStore.users.get(user.email.toLowerCase().trim());
    const updated: UserRecord = {
      id: user.id,
      email: user.email.toLowerCase().trim(),
      name: user.name,
      picture: user.picture || existing?.picture,
      domain: user.domain || existing?.domain,
      created_at: existing?.created_at || now,
      last_active: now,
    };

    memoryStore.upsertUser(updated);

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
        console.error('Neon upsertUser error:', err);
      }
    }

    return updated;
  },

  async getUser(idOrEmail: string): Promise<UserRecord | null> {
    const clean = idOrEmail.toLowerCase().trim();
    const url = getDbUrl();

    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        const rows = await sql`SELECT * FROM users WHERE id = ${idOrEmail} OR LOWER(TRIM(email)) = ${clean} LIMIT 1;`;
        if (rows.length > 0) {
          const row = (rows as any)[0];
          return {
            id: row.id,
            email: row.email,
            name: row.name,
            picture: row.picture,
            domain: row.domain,
            created_at: Number(row.created_at),
            last_active: Number(row.last_active),
          };
        }
      } catch (err) {
        console.error('Neon getUser error:', err);
      }
    }

    return memoryStore.users.get(idOrEmail) || memoryStore.users.get(clean) || null;
  },

  async getAllUsers(): Promise<UserRecord[]> {
    const url = getDbUrl();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        const rows = await sql`SELECT * FROM users ORDER BY last_active DESC LIMIT 100;`;
        return rows.map((r: any) => ({
          id: r.id,
          email: r.email,
          name: r.name,
          picture: r.picture,
          domain: r.domain,
          created_at: Number(r.created_at),
          last_active: Number(r.last_active),
        }));
      } catch (err) {
        console.error('Neon getAllUsers error:', err);
      }
    }
    const set = new Set<string>();
    const list: UserRecord[] = [];
    for (const u of memoryStore.users.values()) {
      if (!set.has(u.id)) {
        set.add(u.id);
        list.push(u);
      }
    }
    return list;
  },

  // CHANNELS
  async getChannels(): Promise<ChannelRecord[]> {
    const url = getDbUrl();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        const rows = await sql`SELECT * FROM channels ORDER BY created_at ASC;`;
        return rows.map((r: any) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          created_at: Number(r.created_at),
          created_by: r.created_by,
        }));
      } catch (err) {
        console.error('Neon getChannels error:', err);
      }
    }
    return Array.from(memoryStore.channels.values());
  },

  async createChannel(channel: ChannelRecord): Promise<ChannelRecord> {
    const url = getDbUrl();
    memoryStore.channels.set(channel.id, channel);
    memoryStore.saveToDisk();

    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        await sql`
          INSERT INTO channels (id, name, description, created_at, created_by)
          VALUES (${channel.id}, ${channel.name}, ${channel.description}, ${channel.created_at}, ${channel.created_by || null})
          ON CONFLICT (id) DO NOTHING;
        `;
        return channel;
      } catch (err) {
        console.error('Neon createChannel error:', err);
      }
    }
    return channel;
  },

  // MESSAGES
  async getMessages(targetId?: string, userIdentifier?: string): Promise<MessageRecord[]> {
    const cleanTarget = (targetId || '').trim().toLowerCase();
    const cleanUser = (userIdentifier || '').trim().toLowerCase();
    const url = getDbUrl();

    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        let rows;

        if (cleanTarget && cleanUser) {
          // Direct 1:1 conversation between cleanTarget and cleanUser
          rows = await sql`
            SELECT * FROM messages 
            WHERE (
              (LOWER(TRIM(target_id)) = ${cleanTarget} AND (LOWER(TRIM(sender_id)) = ${cleanUser} OR LOWER(TRIM(sender_domain)) = ${cleanUser}))
              OR
              (LOWER(TRIM(target_id)) = ${cleanUser} AND (LOWER(TRIM(sender_id)) = ${cleanTarget} OR LOWER(TRIM(sender_domain)) = ${cleanTarget}))
              OR
              LOWER(TRIM(target_id)) = ${cleanTarget}
            )
            ORDER BY timestamp ASC 
            LIMIT 1000;
          `;
        } else if (cleanTarget) {
          rows = await sql`
            SELECT * FROM messages 
            WHERE LOWER(TRIM(target_id)) = ${cleanTarget} 
               OR LOWER(TRIM(sender_domain)) = ${cleanTarget} 
               OR LOWER(TRIM(sender_id)) = ${cleanTarget}
            ORDER BY timestamp ASC 
            LIMIT 1000;
          `;
        } else if (cleanUser) {
          // All messages relevant to this user (channel broadcasts or P2P involving user)
          rows = await sql`
            SELECT * FROM messages 
            WHERE target_type = 'channel' 
               OR LOWER(TRIM(target_id)) = ${cleanUser} 
               OR LOWER(TRIM(sender_id)) = ${cleanUser} 
               OR LOWER(TRIM(sender_domain)) = ${cleanUser}
            ORDER BY timestamp ASC 
            LIMIT 1000;
          `;
        } else {
          rows = await sql`
            SELECT * FROM messages 
            ORDER BY timestamp ASC 
            LIMIT 1000;
          `;
        }

        return rows.map((r: any) => ({
          id: r.id,
          target_id: r.target_id,
          target_type: r.target_type,
          sender_id: r.sender_id,
          sender_domain: r.sender_domain,
          sender_name: r.sender_name,
          sender_color: r.sender_color,
          text: r.text,
          image_url: r.image_url,
          reply_to: r.reply_to,
          timestamp: Number(r.timestamp),
        }));
      } catch (err) {
        console.error('Neon getMessages error:', err);
      }
    }

    // Memory & disk fallback
    if (cleanTarget && cleanUser) {
      return memoryStore.messages.filter(
        (m) =>
          (m.target_id.trim().toLowerCase() === cleanTarget &&
            (m.sender_id.trim().toLowerCase() === cleanUser ||
              m.sender_domain.trim().toLowerCase() === cleanUser)) ||
          (m.target_id.trim().toLowerCase() === cleanUser &&
            (m.sender_id.trim().toLowerCase() === cleanTarget ||
              m.sender_domain.trim().toLowerCase() === cleanTarget)) ||
          m.target_id.trim().toLowerCase() === cleanTarget
      );
    } else if (cleanTarget) {
      return memoryStore.messages.filter(
        (m) =>
          m.target_id.trim().toLowerCase() === cleanTarget ||
          m.sender_domain.trim().toLowerCase() === cleanTarget ||
          m.sender_id.trim().toLowerCase() === cleanTarget
      );
    } else if (cleanUser) {
      return memoryStore.messages.filter(
        (m) =>
          m.target_type === 'channel' ||
          m.target_id.trim().toLowerCase() === cleanUser ||
          m.sender_id.trim().toLowerCase() === cleanUser ||
          m.sender_domain.trim().toLowerCase() === cleanUser
      );
    }
    return memoryStore.messages.slice(-1000);
  },

  async insertMessage(msg: MessageRecord): Promise<MessageRecord> {
    const cleanedMsg: MessageRecord = {
      ...msg,
      target_id: msg.target_type === 'channel' ? msg.target_id.trim().toLowerCase() : msg.target_id.trim().toLowerCase(),
      sender_id: msg.sender_id.trim().toLowerCase(),
      sender_domain: msg.sender_domain.trim().toLowerCase(),
    };

    memoryStore.addMessage(cleanedMsg);
    const url = getDbUrl();

    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        await sql`
          INSERT INTO messages (
            id, target_id, target_type, sender_id, sender_domain, sender_name, sender_color, text, image_url, reply_to, timestamp
          )
          VALUES (
            ${cleanedMsg.id}, ${cleanedMsg.target_id}, ${cleanedMsg.target_type}, ${cleanedMsg.sender_id}, ${cleanedMsg.sender_domain}, ${cleanedMsg.sender_name}, ${cleanedMsg.sender_color},
            ${cleanedMsg.text || null}, ${cleanedMsg.image_url || null}, ${cleanedMsg.reply_to ? JSON.stringify(cleanedMsg.reply_to) : null}, ${cleanedMsg.timestamp}
          )
          ON CONFLICT (id) DO NOTHING;
        `;
        return cleanedMsg;
      } catch (err) {
        console.error('Neon insertMessage error:', err);
      }
    }
    return cleanedMsg;
  },

  async clearMessages(targetId: string): Promise<void> {
    const cleanTarget = targetId.trim().toLowerCase();
    const url = getDbUrl();

    memoryStore.messages = memoryStore.messages.filter(
      (m) =>
        m.target_id.trim().toLowerCase() !== cleanTarget &&
        m.sender_domain.trim().toLowerCase() !== cleanTarget &&
        m.sender_id.trim().toLowerCase() !== cleanTarget
    );
    memoryStore.saveToDisk();

    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        await sql`
          DELETE FROM messages 
          WHERE LOWER(TRIM(target_id)) = ${cleanTarget} 
             OR LOWER(TRIM(sender_domain)) = ${cleanTarget} 
             OR LOWER(TRIM(sender_id)) = ${cleanTarget};
        `;
      } catch (err) {
        console.error('Neon clearMessages error:', err);
      }
    }
  },

  // PEERS (Friend Requests & Connections)
  async getPeers(ownerIdentifier: string): Promise<PeerRecord[]> {
    const cleanOwner = (ownerIdentifier || '').trim().toLowerCase();
    const url = getDbUrl();

    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        const rows = await sql`
          SELECT * FROM peers 
          WHERE LOWER(TRIM(owner_domain)) = ${cleanOwner} 
             OR LOWER(TRIM(peer_domain)) = ${cleanOwner}
          ORDER BY added_at DESC;
        `;

        const peerMap = new Map<string, PeerRecord>();

        for (const r of rows) {
          const isOwner = (r.owner_domain || '').trim().toLowerCase() === cleanOwner;
          const friendDomain = isOwner
            ? (r.peer_domain || '').trim().toLowerCase()
            : (r.owner_domain || '').trim().toLowerCase();

          if (!friendDomain || friendDomain === cleanOwner) continue;

          let direction = r.direction;
          if (!isOwner) {
            direction = r.direction === 'outgoing' ? 'incoming' : 'outgoing';
          }

          const peerObj: PeerRecord = {
            id: `${cleanOwner}_${friendDomain}`,
            owner_domain: cleanOwner,
            peer_domain: friendDomain,
            username: r.username || friendDomain.split('@')[0],
            avatar_color: r.avatar_color || 'purple',
            inbox_url: r.inbox_url || `https://${friendDomain}/api/p2p/inbox`,
            status: r.status,
            direction: direction,
            added_at: Number(r.added_at),
            last_seen: Number(r.last_seen),
          };

          const existing = peerMap.get(friendDomain);
          if (!existing || (peerObj.status === 'accepted' && existing.status !== 'accepted')) {
            peerMap.set(friendDomain, peerObj);
          }
        }

        return Array.from(peerMap.values());
      } catch (err) {
        console.error('Neon getPeers error:', err);
      }
    }

    // Fallback to memoryStore
    const peerMap = new Map<string, PeerRecord>();
    for (const p of memoryStore.peers.values()) {
      const isOwner = p.owner_domain.trim().toLowerCase() === cleanOwner;
      const isPeer = p.peer_domain.trim().toLowerCase() === cleanOwner;
      if (!isOwner && !isPeer) continue;

      const friendDomain = isOwner
        ? p.peer_domain.trim().toLowerCase()
        : p.owner_domain.trim().toLowerCase();
      if (!friendDomain || friendDomain === cleanOwner) continue;

      const direction = isOwner ? p.direction : p.direction === 'outgoing' ? 'incoming' : 'outgoing';
      const peerObj: PeerRecord = {
        id: `${cleanOwner}_${friendDomain}`,
        owner_domain: cleanOwner,
        peer_domain: friendDomain,
        username: p.username || friendDomain.split('@')[0],
        avatar_color: p.avatar_color || 'purple',
        inbox_url: p.inbox_url || `https://${friendDomain}/api/p2p/inbox`,
        status: p.status,
        direction: direction,
        added_at: Number(p.added_at),
        last_seen: Number(p.last_seen),
      };

      const existing = peerMap.get(friendDomain);
      if (!existing || (peerObj.status === 'accepted' && existing.status !== 'accepted')) {
        peerMap.set(friendDomain, peerObj);
      }
    }

    return Array.from(peerMap.values());
  },

  async upsertPeer(peer: PeerRecord): Promise<PeerRecord> {
    const cleanedPeer: PeerRecord = {
      ...peer,
      owner_domain: peer.owner_domain.trim().toLowerCase(),
      peer_domain: peer.peer_domain.trim().toLowerCase(),
    };

    memoryStore.upsertPeer(cleanedPeer);
    const url = getDbUrl();

    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        await sql`
          INSERT INTO peers (
            id, owner_domain, peer_domain, username, avatar_color, inbox_url, status, direction, added_at, last_seen
          )
          VALUES (
            ${cleanedPeer.id}, ${cleanedPeer.owner_domain}, ${cleanedPeer.peer_domain}, ${cleanedPeer.username}, ${cleanedPeer.avatar_color}, ${cleanedPeer.inbox_url || null}, ${cleanedPeer.status}, ${cleanedPeer.direction}, ${cleanedPeer.added_at}, ${cleanedPeer.last_seen}
          )
          ON CONFLICT (id) DO UPDATE SET
            username = EXCLUDED.username,
            avatar_color = EXCLUDED.avatar_color,
            inbox_url = COALESCE(EXCLUDED.inbox_url, peers.inbox_url),
            status = EXCLUDED.status,
            direction = EXCLUDED.direction,
            last_seen = EXCLUDED.last_seen;
        `;
        return cleanedPeer;
      } catch (err) {
        console.error('Neon upsertPeer error:', err);
      }
    }
    return cleanedPeer;
  },

  async updatePeerStatus(ownerDomain: string, peerDomain: string, status: string): Promise<void> {
    const cleanOwner = ownerDomain.trim().toLowerCase();
    const cleanPeer = peerDomain.trim().toLowerCase();
    const id = `${cleanOwner}_${cleanPeer}`;

    memoryStore.updatePeerStatus(cleanOwner, cleanPeer, status);
    const url = getDbUrl();

    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        await sql`
          UPDATE peers 
          SET status = ${status}, last_seen = ${Date.now()}
          WHERE id = ${id} 
             OR (LOWER(TRIM(owner_domain)) = ${cleanOwner} AND LOWER(TRIM(peer_domain)) = ${cleanPeer});
        `;
      } catch (err) {
        console.error('Neon updatePeerStatus error:', err);
      }
    }
  },

  async deletePeer(ownerDomain: string, peerDomain: string): Promise<void> {
    const cleanOwner = ownerDomain.trim().toLowerCase();
    const cleanPeer = peerDomain.trim().toLowerCase();
    const id = `${cleanOwner}_${cleanPeer}`;

    memoryStore.deletePeer(cleanOwner, cleanPeer);
    const url = getDbUrl();

    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        await sql`
          DELETE FROM peers 
          WHERE id = ${id} 
             OR (LOWER(TRIM(owner_domain)) = ${cleanOwner} AND LOWER(TRIM(peer_domain)) = ${cleanPeer});
        `;
      } catch (err) {
        console.error('Neon deletePeer error:', err);
      }
    }
  },
};
