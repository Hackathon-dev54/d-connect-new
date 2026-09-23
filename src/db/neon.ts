import { neon } from '@neondatabase/serverless';

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

// In-memory cache & fallback when DATABASE_URL is not yet connected
class InMemoryStore {
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
  }
}

const memoryStore = new InMemoryStore();

let customDbUrl: string | null = null;

export function getDbUrl(): string | null {
  return (
    customDbUrl ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    null
  );
}

export function setCustomDbUrl(url: string | null) {
  customDbUrl = url ? url.trim() : null;
  tableInitPromise = null;
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

  async getStatus() {
    const url = getDbUrl();
    if (!url) {
      return {
        configured: false,
        engine: 'Memory Fallback (Ready for Vercel Neon Integration)',
        message: 'Neon integration not yet configured on Vercel or DATABASE_URL not set.',
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
      const res = await sql`SELECT current_database() as db, version() as version;`;
      
      // Get table statistics
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
        stats: {
          usersCount: memoryStore.users.size,
          peersCount: memoryStore.peers.size,
          messagesCount: memoryStore.messages.length,
          channelsCount: memoryStore.channels.size,
        },
      };
    }
  },

  // USERS (Google Sign In Auth & Identity)
  async upsertUser(user: {
    id: string;
    email: string;
    name: string;
    picture?: string;
    domain?: string;
  }): Promise<UserRecord> {
    const now = Date.now();
    const url = getDbUrl();

    // Memory store update
    const existing = memoryStore.users.get(user.id);
    const updated: UserRecord = {
      id: user.id,
      email: user.email.toLowerCase().trim(),
      name: user.name,
      picture: user.picture || existing?.picture,
      domain: user.domain || existing?.domain,
      created_at: existing?.created_at || now,
      last_active: now,
    };
    memoryStore.users.set(user.id, updated);
    memoryStore.users.set(updated.email, updated);

    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);

        const rows = await sql`
          INSERT INTO users (id, email, name, picture, domain, created_at, last_active)
          VALUES (${updated.id}, ${updated.email}, ${updated.name}, ${updated.picture || null}, ${updated.domain || null}, ${updated.created_at}, ${now})
          ON CONFLICT (id) DO UPDATE SET
            email = EXCLUDED.email,
            name = EXCLUDED.name,
            picture = COALESCE(EXCLUDED.picture, users.picture),
            domain = COALESCE(EXCLUDED.domain, users.domain),
            last_active = ${now}
          RETURNING *;
        `;

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
        console.error('Neon upsertUser error:', err);
      }
    }

    return updated;
  },

  async getUser(idOrEmail: string): Promise<UserRecord | null> {
    const clean = (idOrEmail || '').trim().toLowerCase();
    const url = getDbUrl();

    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        const rows = await sql`SELECT * FROM users WHERE id = ${idOrEmail} OR LOWER(email) = ${clean} LIMIT 1;`;
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
    const url = getDbUrl();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        let rows;

        if (targetId && userIdentifier) {
          // Direct 1:1 conversation between targetId and userIdentifier
          rows = await sql`
            SELECT * FROM messages 
            WHERE (
              (target_id = ${targetId} AND (sender_id = ${userIdentifier} OR sender_domain = ${userIdentifier}))
              OR
              (target_id = ${userIdentifier} AND (sender_id = ${targetId} OR sender_domain = ${targetId}))
              OR
              target_id = ${targetId}
            )
            ORDER BY timestamp ASC 
            LIMIT 500;
          `;
        } else if (targetId) {
          rows = await sql`
            SELECT * FROM messages 
            WHERE target_id = ${targetId} 
               OR sender_domain = ${targetId} 
               OR sender_id = ${targetId}
            ORDER BY timestamp ASC 
            LIMIT 500;
          `;
        } else if (userIdentifier) {
          // All messages relevant to this user (channel broadcasts or P2P involving user)
          rows = await sql`
            SELECT * FROM messages 
            WHERE target_type = 'channel' 
               OR target_id = ${userIdentifier} 
               OR sender_id = ${userIdentifier} 
               OR sender_domain = ${userIdentifier}
            ORDER BY timestamp ASC 
            LIMIT 500;
          `;
        } else {
          rows = await sql`
            SELECT * FROM messages 
            ORDER BY timestamp ASC 
            LIMIT 500;
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

    // Memory fallback
    if (targetId && userIdentifier) {
      return memoryStore.messages.filter(
        (m) =>
          (m.target_id === targetId && (m.sender_id === userIdentifier || m.sender_domain === userIdentifier)) ||
          (m.target_id === userIdentifier && (m.sender_id === targetId || m.sender_domain === targetId)) ||
          m.target_id === targetId
      );
    } else if (targetId) {
      return memoryStore.messages.filter(
        (m) => m.target_id === targetId || m.sender_domain === targetId || m.sender_id === targetId
      );
    } else if (userIdentifier) {
      return memoryStore.messages.filter(
        (m) =>
          m.target_type === 'channel' ||
          m.target_id === userIdentifier ||
          m.sender_id === userIdentifier ||
          m.sender_domain === userIdentifier
      );
    }
    return memoryStore.messages.slice(-500);
  },

  async insertMessage(msg: MessageRecord): Promise<MessageRecord> {
    const url = getDbUrl();
    if (!memoryStore.messages.some((m) => m.id === msg.id)) {
      memoryStore.messages.push(msg);
    }

    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        await sql`
          INSERT INTO messages (
            id, target_id, target_type, sender_id, sender_domain, sender_name, sender_color, text, image_url, reply_to, timestamp
          )
          VALUES (
            ${msg.id}, ${msg.target_id}, ${msg.target_type}, ${msg.sender_id}, ${msg.sender_domain}, ${msg.sender_name}, ${msg.sender_color},
            ${msg.text || null}, ${msg.image_url || null}, ${msg.reply_to ? JSON.stringify(msg.reply_to) : null}, ${msg.timestamp}
          )
          ON CONFLICT (id) DO NOTHING;
        `;
        return msg;
      } catch (err) {
        console.error('Neon insertMessage error:', err);
      }
    }
    return msg;
  },

  async clearMessages(targetId: string): Promise<void> {
    const url = getDbUrl();
    memoryStore.messages = memoryStore.messages.filter(
      (m) => m.target_id !== targetId && m.sender_domain !== targetId && m.sender_id !== targetId
    );

    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        await sql`DELETE FROM messages WHERE target_id = ${targetId} OR sender_domain = ${targetId} OR sender_id = ${targetId};`;
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
        // Query matching owner_domain (or matching clean)
        const rows = await sql`
          SELECT * FROM peers 
          WHERE LOWER(owner_domain) = ${cleanOwner} 
             OR owner_domain = ${ownerIdentifier}
          ORDER BY added_at DESC;
        `;
        return rows.map((r: any) => ({
          id: r.id,
          owner_domain: r.owner_domain,
          peer_domain: r.peer_domain,
          username: r.username,
          avatar_color: r.avatar_color,
          inbox_url: r.inbox_url,
          status: r.status,
          direction: r.direction,
          added_at: Number(r.added_at),
          last_seen: Number(r.last_seen),
        }));
      } catch (err) {
        console.error('Neon getPeers error:', err);
      }
    }

    return Array.from(memoryStore.peers.values()).filter(
      (p) => p.owner_domain === ownerIdentifier || p.owner_domain.toLowerCase() === cleanOwner
    );
  },

  async upsertPeer(peer: PeerRecord): Promise<PeerRecord> {
    const url = getDbUrl();
    memoryStore.peers.set(peer.id, peer);

    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        await sql`
          INSERT INTO peers (
            id, owner_domain, peer_domain, username, avatar_color, inbox_url, status, direction, added_at, last_seen
          )
          VALUES (
            ${peer.id}, ${peer.owner_domain}, ${peer.peer_domain}, ${peer.username}, ${peer.avatar_color}, ${peer.inbox_url || null}, ${peer.status}, ${peer.direction}, ${peer.added_at}, ${peer.last_seen}
          )
          ON CONFLICT (id) DO UPDATE SET
            username = EXCLUDED.username,
            avatar_color = EXCLUDED.avatar_color,
            inbox_url = COALESCE(EXCLUDED.inbox_url, peers.inbox_url),
            status = EXCLUDED.status,
            direction = EXCLUDED.direction,
            last_seen = EXCLUDED.last_seen;
        `;
        return peer;
      } catch (err) {
        console.error('Neon upsertPeer error:', err);
      }
    }
    return peer;
  },

  async updatePeerStatus(ownerDomain: string, peerDomain: string, status: string): Promise<void> {
    const id = `${ownerDomain}_${peerDomain}`;
    const existing = memoryStore.peers.get(id);
    if (existing) {
      existing.status = status;
      existing.last_seen = Date.now();
      memoryStore.peers.set(id, existing);
    }

    const url = getDbUrl();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        await sql`
          UPDATE peers 
          SET status = ${status}, last_seen = ${Date.now()}
          WHERE id = ${id} 
             OR (LOWER(owner_domain) = ${ownerDomain.toLowerCase()} AND LOWER(peer_domain) = ${peerDomain.toLowerCase()});
        `;
      } catch (err) {
        console.error('Neon updatePeerStatus error:', err);
      }
    }
  },

  async deletePeer(ownerDomain: string, peerDomain: string): Promise<void> {
    const id = `${ownerDomain}_${peerDomain}`;
    memoryStore.peers.delete(id);

    const url = getDbUrl();
    if (url) {
      try {
        const sql = neon(url);
        await initTables(sql);
        await sql`
          DELETE FROM peers 
          WHERE id = ${id} 
             OR (LOWER(owner_domain) = ${ownerDomain.toLowerCase()} AND LOWER(peer_domain) = ${peerDomain.toLowerCase()});
        `;
      } catch (err) {
        console.error('Neon deletePeer error:', err);
      }
    }
  },
};
