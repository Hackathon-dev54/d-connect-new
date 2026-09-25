// Web Crawler Ping Sender + Hybrid Webhook Service
// Replaces peer-to-peer / WebRTC with standard HTTP Crawler Ping + Hybrid Webhook & DB storage.

export interface CrawlerTag {
  name: string;
  value: string;
}

export interface CrawlerPingPayload {
  action: 'friend_request' | 'friend_accept' | 'friend_decline' | 'message' | 'probe';
  senderDomain: string;
  senderUsername: string;
  senderAvatarColor: string;
  senderTags?: string[];
  targetIdentifier: string;
  note?: string;
  message?: {
    id: string;
    text: string;
    imageUrl?: string;
    replyTo?: {
      id: string;
      senderName: string;
      text: string;
    };
    timestamp: number;
  };
  timestamp?: number;
}

export interface CrawlerPong {
  success: boolean;
  action: string;
  crawledAt: number;
  latencyMs?: number;
  targetTags?: CrawlerTag[];
  message?: string;
  error?: string;
  peer?: any;
}

export interface CrawlerLogEntry {
  id: string;
  type: 'outgoing_ping' | 'incoming_ping' | 'pong_ack' | 'crawler_scan' | 'error';
  target: string;
  action: string;
  tags: string[];
  status: 'sent' | 'received' | 'crawling' | 'verified' | 'failed';
  timestamp: number;
  details?: string;
}

export class CrawlerPingSender {
  private logs: CrawlerLogEntry[] = [];
  private listeners: Array<(logs: CrawlerLogEntry[]) => void> = [];

  public getLogs(): CrawlerLogEntry[] {
    return [...this.logs];
  }

  public subscribe(fn: (logs: CrawlerLogEntry[]) => void): () => void {
    this.listeners.push(fn);
    fn(this.getLogs());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private addLog(entry: Omit<CrawlerLogEntry, 'id' | 'timestamp'>) {
    const logItem: CrawlerLogEntry = {
      ...entry,
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    };
    this.logs.unshift(logItem);
    if (this.logs.length > 50) this.logs.pop();
    this.listeners.forEach((fn) => fn(this.getLogs()));
  }

  // Generate dynamic crawler discovery tags for a user/domain
  public generateMiniTags(username: string, domain: string): string[] {
    const safeUser = (username || 'node').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const cleanDom = (domain || 'node').toLowerCase().replace(/^https?:\/\//, '').replace(/:\d+$/, '');
    return [
      `#${safeUser}`,
      `@${cleanDom}`,
      `tag:${safeUser}`,
      `crawler-ping:active`,
      `webhook:hybrid-v2`,
      `db-sync:live`,
    ];
  }

  // Probe and crawl target discovery tags before sending
  public async probeTarget(target: string, currentHost?: string): Promise<{ success: boolean; tags: CrawlerTag[]; nodeInfo?: any; error?: string }> {
    const cleanTarget = (target || '').trim().toLowerCase();
    this.addLog({
      type: 'crawler_scan',
      target: cleanTarget,
      action: 'probe',
      tags: ['scan:meta-tags', 'ping:check'],
      status: 'crawling',
      details: `Crawling endpoint & discovery HTML tags for ${cleanTarget}...`,
    });

    const start = Date.now();
    try {
      const url = `/api/crawler/probe?target=${encodeURIComponent(cleanTarget)}${currentHost ? `&currentHost=${encodeURIComponent(currentHost)}` : ''}`;
      const res = await fetch(url);
      const latency = Date.now() - start;
      if (res.ok) {
        const data = await res.json();
        this.addLog({
          type: 'pong_ack',
          target: cleanTarget,
          action: 'probe',
          tags: (data.tags || []).map((t: CrawlerTag) => `${t.name}=${t.value}`),
          status: 'verified',
          details: `Crawl completed in ${latency}ms. Discovered ${data.tags?.length || 0} meta tags.`,
        });
        return { success: true, tags: data.tags || [], nodeInfo: data.nodeInfo };
      } else {
        const err = await res.json().catch(() => ({}));
        return { success: false, tags: [], error: err.error || `HTTP ${res.status}` };
      }
    } catch (err: any) {
      this.addLog({
        type: 'error',
        target: cleanTarget,
        action: 'probe',
        tags: ['error:timeout'],
        status: 'failed',
        details: err?.message || 'Crawler probe failed',
      });
      return {
        success: false,
        tags: [],
        error: err?.message || 'Crawler probe failed',
      };
    }
  }

  // Crawl sync updates for messages and peers on demand (Clever Web Crawler Method)
  public async crawlSync(userIdentifier: string, activeTargetId?: string): Promise<{ success: boolean; messages?: any[]; peers?: any[] }> {
    try {
      const url = `/api/crawler/sync?userIdentifier=${encodeURIComponent(userIdentifier)}${activeTargetId ? `&targetId=${encodeURIComponent(activeTargetId)}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        return { success: true, messages: data.messages, peers: data.peers };
      }
    } catch (_) {}
    return { success: false };
  }

  // Send a Crawler Ping + Hybrid Webhook to destination
  public async sendPing(payload: CrawlerPingPayload): Promise<CrawlerPong> {
    const startTime = Date.now();
    const cleanTarget = (payload.targetIdentifier || '').trim().toLowerCase();
    const tags = payload.senderTags || this.generateMiniTags(payload.senderUsername, payload.senderDomain);

    this.addLog({
      type: 'outgoing_ping',
      target: cleanTarget,
      action: payload.action,
      tags,
      status: 'sent',
      details: `Dispatched crawler ping [${payload.action}] to ${cleanTarget} with mini tags: ${tags.join(', ')}`,
    });

    try {
      const res = await fetch('/api/crawler/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          senderTags: tags,
          timestamp: Date.now(),
        }),
      });

      const latencyMs = Date.now() - startTime;
      if (res.ok) {
        const data = await res.json();
        this.addLog({
          type: 'pong_ack',
          target: cleanTarget,
          action: payload.action,
          tags: (data.targetTags || []).map((t: CrawlerTag) => `${t.name}=${t.value}`),
          status: 'verified',
          details: `Crawler Pong ACK received in ${latencyMs}ms. Database persisted successfully.`,
        });
        return {
          success: true,
          action: payload.action,
          crawledAt: Date.now(),
          latencyMs,
          targetTags: data.targetTags,
          peer: data.peer,
          message: data.message,
        };
      } else {
        const err = await res.json().catch(() => ({}));
        this.addLog({
          type: 'error',
          target: cleanTarget,
          action: payload.action,
          tags: ['http:' + res.status],
          status: 'failed',
          details: err.error || `HTTP ${res.status} ping delivery error`,
        });
        return {
          success: false,
          action: payload.action,
          crawledAt: Date.now(),
          latencyMs,
          error: err.error || 'Failed to deliver crawler ping',
        };
      }
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      this.addLog({
        type: 'error',
        target: cleanTarget,
        action: payload.action,
        tags: ['network:failure'],
        status: 'failed',
        details: err?.message || 'Crawler network error',
      });
      return {
        success: false,
        action: payload.action,
        crawledAt: Date.now(),
        latencyMs,
        error: err?.message || 'Failed to deliver crawler ping',
      };
    }
  }
}

export const crawlerPingSender = new CrawlerPingSender();
