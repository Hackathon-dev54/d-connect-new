export interface PeerIdentity {
  domain: string; // e.g. "alice.chat.org" or "bob@gmail.com"
  username: string;
  avatarColor: string;
  publicKey?: string;
  inboxUrl: string;
  status: 'pending' | 'accepted' | 'rejected' | 'blocked';
  direction: 'incoming' | 'outgoing'; // who sent the request
  lastSeen?: number;
  addedAt: number;
  crawlerTags?: string[]; // Mini discovery tags for crawler ping
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
  targetId: string; // channelId or peer domain
  targetType: 'channel' | 'p2p';
  senderId: string; // domain or local user id
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
  status?: 'sending' | 'delivered' | 'failed';
  crawlerPingAck?: boolean;
}

export interface TypingIndicator {
  userId: string;
  userName: string;
  targetId: string;
  timestamp: number;
}

export interface NodeManifest {
  protocol: 'CRAWLER-PING/2.1';
  domain: string;
  username: string;
  avatarColor: string;
  status: string;
  endpoints: {
    ping: string;
    webhook: string;
    discovery: string;
    dbStatus: string;
  };
  crawlerTags: string[];
}

export interface ChatBootstrapData {
  myDomain: string;
  myUsername: string;
  myAvatarColor: string;
  channels: ChatChannel[];
  messages: ChatMessage[];
  peers: PeerIdentity[];
  serverTime: number;
  crawlerTags?: string[];
}
