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
  // Always use /tmp in serverless or container environments
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NODE_ENV === 'production') {
    return path.join('/tmp', filename);
  }
  try {
    return path.resolve(process.cwd(), filename);
  } catch (_) {
    return path.join('/tmp', filename);
  }
}

const STORE_PATH = getWritableStorePath('dconnect_data_store.json');

// Persistent Disk + Memory Cache for local dev and fallback
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
          this.users = new Map(data.users.map((u: UserRecord) => [u.id, u]));
        }
        if (data.channels && Array.isArray(data.channels)) {
          this.channels = new Map(data.channels.map((c: ChannelRecord) => [c.id, c]));
        }
        if (data.messages && Array.isArray(data.messages)) {
          this.messages = data.messages;
        }
        if (data.peers && Array.isArray(data.peers)) {
          this.peers = new Map(data.peers.map((p: PeerRecord) => [p.id, p]));
        }
      }
    } catch (_) {
      // Ignored
    }
  }

  saveToDisk() {
    try {
      const data = {
        users: Array.from(this.users.values()),
        channels: Array.from(this.channels.values()),
        messages: this.messages.slice(-500),
        peers: Array.from(this.peers.values()),
      };
      fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (_) {
      // Ignored
    }
  }
}

const memoryStore = new PersistentStore();

export function cleanPostgresUrl(val?: string | null): string | null {
  if (!val || typeof val !== 'string') return null;
  let cleaned = val.trim();
  // Strip psql prefix or enclosing quotes if present
  if (cleaned.startsWith('psql ')) {
    cleaned = cleaned.slice(5).trim();
  }
  cleaned = cleaned.replace(/^['"]+/, '').replace(/['"]+$/, '').trim();
  if (cleaned.startsWith('postgres://') || cleaned.startsWith('postgresql://')) {
    if (cleaned.includes('neon.tech') && !cleaned.includes('sslmode=')) {
      cleaned += cleaned.includes('?') ? '&sslmode=require' : '?sslmode=require';
    }
    return cleaned;
  }
  return null;
}

export const ALL_DB_ENV_KEYS = [
  'POSTGRES_URL',
  'DATABASE_URL',
  'POSTGRES_HOST',
  'PGPASSWORD',
  'POSTGRES_DATABASE',
  'POSTGRES_URL_NON_POOLING',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL_NO_SSL',
  'POSTGRESQL_URL',
  'NEON_DATABASE_URL',
  'NEON_DB_URL',
  'DB_URL',
  'PGHOST',
  'POSTGRES_USER',
  'PGUSER',
];

export function getDetectedDbEnvKeys(): string[] {
  return ALL_DB_ENV_KEYS.filter((k) => Boolean(process.env[k] && process.env[k]?.trim()));
}

export function getDbUrl(): string | null {
  // 1. Direct connection string candidates
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
    process.env.DB_URL,
  ];

  for (const candidate of envCandidates) {
    const cleaned = cleanPostgresUrl(candidate);
    if (cleaned) return cleaned;
  }

  // 2. Individual credentials from Vercel / Neon integration
  const host = process.env.POSTGRES_HOST || process.env.PGHOST;
  const password = process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD;
  const database = process.env.POSTGRES_DATABASE || process.env.PGDATABASE || 'neondb';
  const user = process.env.POSTGRES_USER || process.env.PGUSER || 'neondb_owner';

  if (host && password) {
    const cleanHost = host.trim().replace(/^['"]+/, '').replace(/['"]+$/, '');
    const cleanUser = user.trim().replace(/^['"]+/, '').replace(/['"]+$/, '');
    const cleanPass = password.trim().replace(/^['"]+/, '').replace(/['"]+$/, '');
    const cleanDb = database.trim().replace(/^['"]+/, '').replace(/['"]+$/, '');
    return `postgres://${encodeURIComponent(cleanUser)}:${encodeURIComponent(cleanPass)}@${cleanHost}/${cleanDb}?sslmode=require`;
  }

  return null;
}

let tableInitPromise: Promise<void> | null = null;

async function initTables(sql: any) {
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

      // Seed general channel if not exists
      await sql`
        INSERT INTO channels (id, name, description, created_at, created_by)
        VALUES ('general', 'general', 'Global broadcast channel for all connected peers.', ${Date.now()}, 'system')
        ON CONFLICT (id) DO NOTHING;
      `;
    } catch (err) {
      console.error('Neon table initialization error:', err);
      tableInitPromise = null;
      throw err;
    }
  })();

  return tableInitPromise;
}

export const neonDb = {
  isConfigured(): boolean {
    return Boolean(getDbUrl());
  },

  setDbUrl(_url: string | null) {
    // Managed exclusively through server environment variables
  },

  async getStatus(): Promise<{
    configured: boolean;
    engine: string;
    database?: string;
    message: string;
    error?: string;
    detectedEnvKeys: string[];
    checkedEnvKeys: string[];
    stats: {
      usersCount: number;
      peersCount: number;
      messagesCount: number;
      channelsCount: number;
    };
  }> {
    const detectedEnvKeys = getDetectedDbEnvKeys();
    const url = getDbUrl();
    const isDeployed = Boolean(
      process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.NODE_ENV === 'production'
    );

    if (!url) {
      return {
        configured: false,
        engine: isDeployed
          ? 'Error: Database Environment Variable Missing'
          : 'Local Memory Fallback (Dev Only)',
        error: isDeployed
          ? 'DATABASE_URL_NOT_FOUND'
          : 'NO_DATABASE_URL_CONFIGURED',
        message: isDeployed
          ? `No PostgreSQL database URL detected in environment variables on Vercel. Checked candidate keys: ${ALL_DB_ENV_KEYS.join(', ')}. If you already added POSTGRES_URL or DATABASE_URL in Vercel Project Settings, ensure it is assigned to both Production and Preview environments, then trigger a REDEPLOY in Vercel.`
          : 'Running in local development without a database URL. Set POSTGRES_URL or DATABASE_URL in .env to connect Neon.',
        detectedEnvKeys,
        checkedEnvKeys: ALL_DB_ENV_KEYS,
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
        engine: 'Neon Serverless PostgreSQL (Live)',
        database: (res as any)[0]?.db,
        message: `Connected successfully to Neon PostgreSQL database via ${detectedEnvKeys.join(', ')}. All friend requests, messages, and accounts are persisted.`,
        detectedEnvKeys,
        checkedEnvKeys: ALL_DB_ENV_KEYS,
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
        engine: 'Neon PostgreSQL Connection Failed',
        error: err?.message || 'Database connection error',
        message: `Database URL was detected (${detectedEnvKeys.join(', ')}), but connection failed: ${err.message}. Please check your Neon project status, database password, and network access.`,
        detectedEnvKeys,
        checkedEnvKeys: ALL_DB_ENV_KEYS,
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
      name: user.name || user.email.split('@')[0],
      picture: user.picture || existing?.picture,
      domain: user.domain || existing?.domain,
      created_at: existing ? existing.created_at : now,
      last_active: now,
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
        console.error('Neon upsertUser error:', err);
      }
    }

    return updated;
  },

  async getUser(idOrEmail: string): Promise<UserRecord | null> {
    const clean = (idOrEmail || '').toLowerCase().trim();
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
        return rows.map((row: any) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          picture: row.picture,
          domain: row.domain,
          created_at: Number(row.created_at),
          last_active: Number(row.last_active),
        }));
      } catch (err) {
        console.error('Neon getAllUsers error:', err);
      }
    }
    return Array.from(memoryStore.users.values()).sort((a, b) => b.last_active - a.last_active);
  },

  // CHANNELS
  async getChannels(): Promise<ChannelRecord[]> {
    const url = getDbUrl();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        const rows = await sql`SELECT * FROM channels ORDER BY created_at ASC;`;
        if (rows.length > 0) {
          return rows.map((row: any) => ({
            id: row.id,
            name: row.name,
            description: row.description || '',
            created_at: Number(row.created_at),
            created_by: row.created_by,
          }));
        }
      } catch (err) {
        console.error('Neon getChannels error:', err);
      }
    }
    return Array.from(memoryStore.channels.values());
  },

  async createChannel(channel: ChannelRecord): Promise<ChannelRecord> {
    memoryStore.channels.set(channel.id, channel);
    memoryStore.saveToDisk();

    const url = getDbUrl();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        await sql`
          INSERT INTO channels (id, name, description, created_at, created_by)
          VALUES (${channel.id}, ${channel.name}, ${channel.description || ''}, ${channel.created_at}, ${channel.created_by || null})
          ON CONFLICT (id) DO NOTHING;
        `;
      } catch (err) {
        console.error('Neon createChannel error:', err);
      }
    }
    return channel;
  },

  // MESSAGES
  async insertMessage(message: MessageRecord): Promise<MessageRecord> {
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
        console.error('Neon insertMessage error:', err);
      }
    }
    return message;
  },

  async getMessages(targetId?: string, limit = 100): Promise<MessageRecord[]> {
    const url = getDbUrl();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        let rows;
        if (targetId) {
          rows = await sql`
            SELECT * FROM messages 
            WHERE target_id = ${targetId} OR sender_domain = ${targetId} OR sender_id = ${targetId}
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
        return rows.map((row: any) => ({
          id: row.id,
          target_id: row.target_id,
          target_type: row.target_type,
          sender_id: row.sender_id,
          sender_domain: row.sender_domain,
          sender_name: row.sender_name,
          sender_color: row.sender_color,
          text: row.text || '',
          image_url: row.image_url,
          reply_to: row.reply_to ? (typeof row.reply_to === 'string' ? JSON.parse(row.reply_to) : row.reply_to) : undefined,
          timestamp: Number(row.timestamp),
        }));
      } catch (err) {
        console.error('Neon getMessages error:', err);
      }
    }

    if (targetId) {
      return memoryStore.messages.filter(
        (m) => m.target_id === targetId || m.sender_domain === targetId || m.sender_id === targetId
      );
    }
    return memoryStore.messages.slice(-limit);
  },

  async clearMessages(targetId?: string): Promise<void> {
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
        console.error('Neon clearMessages error:', err);
      }
    }
  },

  // PEERS
  async upsertPeer(peer: PeerRecord): Promise<PeerRecord> {
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
        console.error('Neon upsertPeer error:', err);
      }
    }
    return peer;
  },

  async getPeers(ownerDomain: string): Promise<PeerRecord[]> {
    const url = getDbUrl();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        const rows = await sql`
          SELECT * FROM peers 
          WHERE owner_domain = ${ownerDomain}
          ORDER BY last_seen DESC;
        `;
        return rows.map((row: any) => ({
          id: row.id,
          owner_domain: row.owner_domain,
          peer_domain: row.peer_domain,
          username: row.username,
          avatar_color: row.avatar_color,
          inbox_url: row.inbox_url,
          status: row.status,
          direction: row.direction,
          added_at: Number(row.added_at),
          last_seen: Number(row.last_seen),
        }));
      } catch (err) {
        console.error('Neon getPeers error:', err);
      }
    }

    return Array.from(memoryStore.peers.values()).filter((p) => p.owner_domain === ownerDomain);
  },

  async deletePeer(ownerDomain: string, peerDomain: string): Promise<void> {
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
        console.error('Neon deletePeer error:', err);
      }
    }
  },
};
