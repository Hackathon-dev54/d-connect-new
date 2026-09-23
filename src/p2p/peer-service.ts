import Peer, { DataConnection } from 'peerjs';
import { ChatMessage, PeerIdentity } from '../types';

export function domainToPeerId(domainOrUser: string): string {
  const clean = (domainOrUser || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  const safe = clean.replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `dc-${safe || 'node'}`;
}

export type P2PPayload =
  | {
      type: 'FRIEND_REQUEST';
      fromDomain: string;
      fromUsername: string;
      fromAvatarColor: string;
      note?: string;
      timestamp: number;
    }
  | {
      type: 'FRIEND_ACCEPTED';
      fromDomain: string;
      fromUsername: string;
      fromAvatarColor: string;
    }
  | {
      type: 'CHAT_MESSAGE';
      message: ChatMessage;
    }
  | {
      type: 'PING';
      fromDomain: string;
    }
  | {
      type: 'PONG';
      fromDomain: string;
    };

export class P2PService {
  private peer: Peer | null = null;
  private myDomain: string = '';
  private myUsername: string = '';
  private myAvatarColor: string = 'indigo';
  private connections = new Map<string, DataConnection>();
  private isConnected = false;
  private reconnectTimer: any = null;

  public onFriendRequestCallback: ((data: {
    fromDomain: string;
    fromUsername: string;
    fromAvatarColor: string;
    note?: string;
    timestamp: number;
  }) => void) | null = null;

  public onFriendAcceptedCallback: ((data: {
    fromDomain: string;
    fromUsername: string;
    fromAvatarColor: string;
  }) => void) | null = null;

  public onMessageCallback: ((message: ChatMessage) => void) | null = null;
  public onConnectionStateChange: ((connected: boolean) => void) | null = null;

  init(domainOrUser: string, username: string, avatarColor: string) {
    this.myDomain = domainOrUser;
    this.myUsername = username;
    this.myAvatarColor = avatarColor;

    if (this.peer) {
      try {
        this.peer.destroy();
      } catch (_) {}
      this.peer = null;
    }

    const peerId = domainToPeerId(domainOrUser);

    try {
      // Connect to public free signaling network
      this.peer = new Peer(peerId, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
          ],
        },
      });

      this.peer.on('open', () => {
        this.isConnected = true;
        this.onConnectionStateChange?.(true);
      });

      this.peer.on('connection', (conn) => {
        this.setupConnectionListeners(conn);
      });

      this.peer.on('error', (err: any) => {
        if (err.type === 'unavailable-id') {
          // Attempt fallback with random salt if exact ID collision
          const altId = `${peerId}-${Math.floor(Math.random() * 1000)}`;
          try {
            this.peer?.destroy();
            this.peer = new Peer(altId, {
              debug: 1,
              config: {
                iceServers: [
                  { urls: 'stun:stun.l.google.com:19302' },
                  { urls: 'stun:global.stun.twilio.com:3478' },
                ],
              },
            });
            this.peer.on('open', () => {
              this.isConnected = true;
              this.onConnectionStateChange?.(true);
            });
            this.peer.on('connection', (c) => this.setupConnectionListeners(c));
          } catch (_) {}
        }
      });

      this.peer.on('disconnected', () => {
        this.isConnected = false;
        this.onConnectionStateChange?.(false);
        this.reconnect();
      });

      this.peer.on('close', () => {
        this.isConnected = false;
        this.onConnectionStateChange?.(false);
      });
    } catch (e) {
      console.error('PeerJS init error:', e);
    }
  }

  private reconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.peer && !this.peer.destroyed && this.peer.disconnected) {
        this.peer.reconnect();
      }
    }, 3000);
  }

  private setupConnectionListeners(conn: DataConnection) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
    });

    conn.on('data', (data: any) => {
      if (!data || typeof data !== 'object') return;
      const payload = data as P2PPayload;

      switch (payload.type) {
        case 'FRIEND_REQUEST':
          this.onFriendRequestCallback?.({
            fromDomain: payload.fromDomain,
            fromUsername: payload.fromUsername,
            fromAvatarColor: payload.fromAvatarColor,
            note: payload.note,
            timestamp: payload.timestamp || Date.now(),
          });
          break;

        case 'FRIEND_ACCEPTED':
          this.onFriendAcceptedCallback?.({
            fromDomain: payload.fromDomain,
            fromUsername: payload.fromUsername,
            fromAvatarColor: payload.fromAvatarColor,
          });
          break;

        case 'CHAT_MESSAGE':
          this.onMessageCallback?.(payload.message);
          break;

        case 'PING':
          try {
            conn.send({ type: 'PONG', fromDomain: this.myDomain });
          } catch (_) {}
          break;
      }
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
    });

    conn.on('error', () => {
      this.connections.delete(conn.peer);
    });
  }

  private getOrConnect(targetDomainOrUser: string): Promise<DataConnection> {
    return new Promise((resolve, reject) => {
      const targetPeerId = domainToPeerId(targetDomainOrUser);
      const existing = this.connections.get(targetPeerId);
      if (existing && existing.open) {
        return resolve(existing);
      }

      if (!this.peer || this.peer.destroyed) {
        return reject(new Error('P2P node not initialized'));
      }

      try {
        const conn = this.peer.connect(targetPeerId, {
          reliable: true,
        });

        const timer = setTimeout(() => {
          if (!conn.open) {
            resolve(conn);
          }
        }, 3000);

        conn.on('open', () => {
          clearTimeout(timer);
          this.connections.set(targetPeerId, conn);
          this.setupConnectionListeners(conn);
          resolve(conn);
        });

        conn.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async sendFriendRequest(targetDomainOrUser: string, note?: string): Promise<boolean> {
    const payload: P2PPayload = {
      type: 'FRIEND_REQUEST',
      fromDomain: this.myDomain,
      fromUsername: this.myUsername,
      fromAvatarColor: this.myAvatarColor,
      note: note || `Hi from ${this.myDomain}`,
      timestamp: Date.now(),
    };

    try {
      const conn = await this.getOrConnect(targetDomainOrUser);
      if (conn.open) {
        conn.send(payload);
        return true;
      } else {
        conn.on('open', () => {
          try {
            conn.send(payload);
          } catch (_) {}
        });
        return true;
      }
    } catch (e) {
      return false;
    }
  }

  async sendFriendAccept(targetDomainOrUser: string): Promise<boolean> {
    const payload: P2PPayload = {
      type: 'FRIEND_ACCEPTED',
      fromDomain: this.myDomain,
      fromUsername: this.myUsername,
      fromAvatarColor: this.myAvatarColor,
    };

    try {
      const conn = await this.getOrConnect(targetDomainOrUser);
      if (conn.open) {
        conn.send(payload);
        return true;
      } else {
        conn.on('open', () => {
          try {
            conn.send(payload);
          } catch (_) {}
        });
        return true;
      }
    } catch (e) {
      return false;
    }
  }

  async sendMessage(targetDomainOrUser: string, message: ChatMessage): Promise<boolean> {
    const payload: P2PPayload = {
      type: 'CHAT_MESSAGE',
      message,
    };

    try {
      const conn = await this.getOrConnect(targetDomainOrUser);
      if (conn.open) {
        conn.send(payload);
        return true;
      } else {
        conn.on('open', () => {
          try {
            conn.send(payload);
          } catch (_) {}
        });
        return true;
      }
    } catch (e) {
      return false;
    }
  }

  destroy() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      this.connections.forEach((conn) => conn.close());
      this.connections.clear();
      this.peer?.destroy();
    } catch (_) {}
    this.peer = null;
  }
}

export const p2pService = new P2PService();
