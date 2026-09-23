export interface PeerIdentity {
  domain: string; // e.g. "alice.chat.org" or "bob.domain.com"
  username: string;
  avatarColor: string;
  publicKey?: string;
  inboxUrl: string; // e.g. "https://alice.chat.org/api/p2p/inbox"
  status: 'pending' | 'accepted' | 'rejected' | 'blocked';
  direction: 'incoming' | 'outgoing'; // who sent the request
  lastSeen?: number;
  addedAt: number;
}

export interface PeerRequestPayload {
  fromDomain: string;
  fromUsername: string;
  fromAvatarColor: string;
  fromInboxUrl: string;
  note?: string;
  timestamp: number;
}

export interface PeerAcceptPayload {
  fromDomain: string;
  fromUsername: string;
  fromAvatarColor: string;
  fromInboxUrl: string;
  timestamp: number;
}

export interface PeerMessagePayload {
  id: string;
  fromDomain: string;
  fromUsername: string;
  fromAvatarColor: string;
  toDomain: string;
  text: string;
  imageUrl?: string;
  replyTo?: {
    id: string;
    senderName: string;
    text: string;
  };
  timestamp: number;
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
}

export interface TypingIndicator {
  userId: string;
  userName: string;
  targetId: string;
  timestamp: number;
}

export interface NodeManifest {
  protocol: 'IMAGXP-P2P/1.0';
  domain: string;
  username: string;
  avatarColor: string;
  status: string;
  endpoints: {
    inbox: string;
    discovery: string;
    request: string;
  };
}

export interface ChatBootstrapData {
  myDomain: string;
  myUsername: string;
  myAvatarColor: string;
  channels: ChatChannel[];
  messages: ChatMessage[];
  peers: PeerIdentity[];
  serverTime: number;
}
