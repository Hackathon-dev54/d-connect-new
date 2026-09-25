import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  PeerIdentity,
  ChatChannel,
  ChatMessage,
} from './types';
import { PWAInstallButton } from './components/PWAInstallButton';
import { GoogleAuthButton, GoogleUserProfile } from './components/GoogleAuthButton';
import { OnboardingAuth } from './components/OnboardingAuth';
import { NeonDbModal } from './components/NeonDbModal';
import { crawlerPingSender, CrawlerLogEntry, CrawlerTag } from './services/crawler-service';
import { cleanDomain, deriveSubdomain, deriveDomainUsername } from './utils/domain';
import {
  Globe,
  Radio,
  Send,
  UserPlus,
  Check,
  X,
  Plus,
  Trash2,
  Image as ImageIcon,
  Copy,
  Menu,
  Sparkles,
  Settings,
  Reply,
  Clock,
  Hash,
  Smartphone,
  RefreshCw,
  Database,
  Users,
  ShieldCheck,
  LogOut,
  Activity,
  Terminal,
  Tag,
  Zap,
  Search,
} from 'lucide-react';

const AVATAR_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  indigo: { bg: 'bg-indigo-600', text: 'text-white', ring: 'ring-indigo-400' },
  emerald: { bg: 'bg-emerald-600', text: 'text-white', ring: 'ring-emerald-400' },
  purple: { bg: 'bg-purple-600', text: 'text-white', ring: 'ring-purple-400' },
  rose: { bg: 'bg-rose-600', text: 'text-white', ring: 'ring-rose-400' },
  amber: { bg: 'bg-amber-600', text: 'text-white', ring: 'ring-amber-400' },
  cyan: { bg: 'bg-cyan-600', text: 'text-white', ring: 'ring-cyan-400' },
};

function playChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (_) {}
}

const STORAGE_KEYS = {
  DOMAIN: 'dconnect_my_domain',
  USERNAME: 'dconnect_my_username',
  AVATAR: 'dconnect_my_avatar',
  PEERS: 'dconnect_peers_v1',
  MESSAGES: 'dconnect_messages_v1',
  CHANNELS: 'dconnect_channels_v1',
};

function getUserStorageKey(baseKey: string, userIdentifier: string): string {
  const clean = cleanDomain(userIdentifier);
  return clean ? `${baseKey}_${clean}` : baseKey;
}

function getApiHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...extra };
}

export default function App() {
  // Clear any old client-cached DB URLs
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('dconnect_neon_db_url');
    }
  }, []);

  const currentHost = typeof window !== 'undefined' ? window.location.host : '';
  const urlNodeParam = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('node') : null;

  // Tab-isolated session user (allows 2 tabs to have different users or profiles)
  const [googleUser, setGoogleUser] = useState<GoogleUserProfile | null>(() => {
    try {
      const tabSaved = sessionStorage.getItem('dconnect_tab_user');
      if (tabSaved) return JSON.parse(tabSaved);
      const saved = localStorage.getItem('dconnect_google_user');
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return null;
  });

  // Node domain detection: defaults to current site's deployed host or simulated node parameter
  const [myDomain, setMyDomain] = useState<string>(() => {
    if (urlNodeParam) return cleanDomain(`${urlNodeParam}.local:3000`);
    const saved = localStorage.getItem(STORAGE_KEYS.DOMAIN);
    if (saved && saved !== 'my-node.local' && saved !== 'my-node.vercel.app' && saved !== 'd-connect-1.vercel.app') {
      return saved;
    }
    return cleanDomain(currentHost) || 'node.chat.local';
  });

  // Auto-assigned username as domain or subdomain of the deployed site!
  const [myUsername, setMyUsername] = useState<string>(() => {
    if (urlNodeParam) return urlNodeParam.toLowerCase();
    if (googleUser?.name) return googleUser.name;
    const domain = myDomain || currentHost;
    return deriveSubdomain(domain) || 'node';
  });

  // User identity: either their Google email if logged in, or local domain
  const effectiveIdentifier = googleUser?.email
    ? cleanDomain(googleUser.email)
    : cleanDomain(myDomain);

  const [myAvatarColor, setMyAvatarColor] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.AVATAR) || 'indigo';
  });

  const [crawlerActive, setCrawlerActive] = useState<boolean>(true);
  const [crawlerLogs, setCrawlerLogs] = useState<CrawlerLogEntry[]>([]);
  const [showCrawlerConsole, setShowCrawlerConsole] = useState<boolean>(false);
  const [pingTestResult, setPingTestResult] = useState<string | null>(null);
  const [isSendingPingTest, setIsSendingPingTest] = useState<boolean>(false);
  const [myCrawlerTags, setMyCrawlerTags] = useState<string[]>([]);
  const [discoveredTags, setDiscoveredTags] = useState<CrawlerTag[]>([]);

  // Subscribe to live crawler activity logs
  useEffect(() => {
    return crawlerPingSender.subscribe((logs) => {
      setCrawlerLogs(logs);
    });
  }, []);

  // Generate dynamic crawler discovery tags for current user
  useEffect(() => {
    const tags = crawlerPingSender.generateMiniTags(myUsername, effectiveIdentifier);
    setMyCrawlerTags(tags);
  }, [myUsername, effectiveIdentifier]);

  // Channels, Peers, Messages persisted in LocalStorage & Neon DB
  const [channels, setChannels] = useState<ChatChannel[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CHANNELS);
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return [
      {
        id: 'general',
        name: 'general',
        description: 'Global broadcast channel for all connected peers.',
        createdAt: 1700000000000,
        isDefault: true,
      },
    ];
  });

  const [peers, setPeers] = useState<PeerIdentity[]>(() => {
    try {
      const email = googleUser?.email ? cleanDomain(googleUser.email) : '';
      const key = email ? getUserStorageKey(STORAGE_KEYS.PEERS, email) : STORAGE_KEYS.PEERS;
      const saved = localStorage.getItem(key) || localStorage.getItem(STORAGE_KEYS.PEERS);
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return [];
  });

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const email = googleUser?.email ? cleanDomain(googleUser.email) : '';
      const key = email ? getUserStorageKey(STORAGE_KEYS.MESSAGES, email) : STORAGE_KEYS.MESSAGES;
      const saved = localStorage.getItem(key) || localStorage.getItem(STORAGE_KEYS.MESSAGES);
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return [];
  });

  // Active Chat Target: channel OR peer domain/email
  const [activeTarget, setActiveTarget] = useState<{
    id: string;
    type: 'channel' | 'p2p';
    name: string;
    domain?: string;
  }>({
    id: 'general',
    type: 'channel',
    name: 'general',
  });
  const activeTargetRef = useRef(activeTarget);
  activeTargetRef.current = activeTarget;

  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});

  // Message composer
  const [inputText, setInputText] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Modals & Panels
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [showAddPeerModal, setShowAddPeerModal] = useState(false);
  const [peerInputDomain, setPeerInputDomain] = useState('');
  const [peerInputNote, setPeerInputNote] = useState('');
  const [peerProbeStatus, setPeerProbeStatus] = useState<string | null>(null);
  const [isProbingPeer, setIsProbingPeer] = useState(false);
  const [discoveredUsers, setDiscoveredUsers] = useState<any[]>([]);

  const [showNodeConfigModal, setShowNodeConfigModal] = useState(false);
  const [editDomain, setEditDomain] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editColor, setEditColor] = useState('indigo');

  const [showNewChannelModal, setShowNewChannelModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelDesc, setNewChannelDesc] = useState('');

  const [showHowItWorksModal, setShowHowItWorksModal] = useState(false);
  const [showCapacitorModal, setShowCapacitorModal] = useState(false);
  const [showNeonModal, setShowNeonModal] = useState(false);
  const [neonConfigured, setNeonConfigured] = useState(false);
  const [dbStatusInfo, setDbStatusInfo] = useState<{
    configured: boolean;
    engine?: string;
    message?: string;
    detectedEnvKeys?: string[];
  } | null>(null);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const peersRef = useRef(peers);
  peersRef.current = peers;

  // Auto-scroll messages to bottom
  const scrollToBottom = useCallback(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, activeTarget, scrollToBottom]);

  // Equality comparator for peers to avoid redundant state updates and UI blinking
  const arePeersEqual = (a: PeerIdentity[], b: PeerIdentity[]): boolean => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const pA = a[i];
      const pB = b.find((p) => cleanDomain(p.domain) === cleanDomain(pA.domain));
      if (!pB) return false;
      if (
        pA.status !== pB.status ||
        pA.username !== pB.username ||
        pA.direction !== pB.direction ||
        pA.avatarColor !== pB.avatarColor
      ) {
        return false;
      }
    }
    return true;
  };

  // Load Neon DB status and Bootstrap Data from server
  const loadBootstrapDataForUser = useCallback(async (userIdentifier: string) => {
    const cleanId = cleanDomain(userIdentifier);
    if (!cleanId) return;
    try {
      const apiHeaders = getApiHeaders();
      const [dbRes, bootRes] = await Promise.all([
        fetch('/api/db/status', { headers: apiHeaders }),
        fetch(`/api/chat/bootstrap?userIdentifier=${encodeURIComponent(cleanId)}`, { headers: apiHeaders }),
      ]);

      if (dbRes.ok) {
        const dbData = await dbRes.json();
        setNeonConfigured(Boolean(dbData.configured));
        setDbStatusInfo(dbData);
      } else {
        const text = await dbRes.text().catch(() => "");
        setDbStatusInfo({
          configured: false,
          engine: `Server Error (${dbRes.status})`,
          message: text.slice(0, 150) || `Server responded with status ${dbRes.status}. Please check Vercel function logs.`,
        });
      }

      if (bootRes.ok) {
        const data = await bootRes.json();
        if (Array.isArray(data.channels) && data.channels.length > 0) {
          setChannels(data.channels);
        }
        if (data.myUsername && !googleUser?.name && !urlNodeParam) {
          setMyUsername(data.myUsername);
        }
        if (data.crawlerTags && Array.isArray(data.crawlerTags)) {
          setMyCrawlerTags(data.crawlerTags);
        }

        // 1. Authoritative server peers from Neon DB
        const serverPeers: PeerIdentity[] = Array.isArray(data.peers)
          ? data.peers.map((sp: any) => ({
              domain: cleanDomain(sp.peer_domain || sp.domain),
              username: sp.username || (sp.peer_domain || sp.domain).split('@')[0],
              avatarColor: sp.avatar_color || sp.avatarColor || 'purple',
              inboxUrl: sp.inbox_url || sp.inboxUrl || `https://${sp.peer_domain || sp.domain}/api/crawler/ping`,
              status: sp.status || 'pending',
              direction: sp.direction || 'incoming',
              addedAt: Number(sp.added_at || sp.addedAt || Date.now()),
              lastSeen: Number(sp.last_seen || sp.lastSeen || Date.now()),
              crawlerTags: sp.crawlerTags || [`#${sp.username || 'user'}`, `@${cleanDomain(sp.peer_domain || sp.domain)}`, 'crawler-ping:active'],
            }))
          : [];

        // Avoid re-renders if peers have not changed
        setPeers((prev) => {
          if (arePeersEqual(prev, serverPeers)) {
            return prev;
          }
          try {
            localStorage.setItem(getUserStorageKey(STORAGE_KEYS.PEERS, cleanId), JSON.stringify(serverPeers));
          } catch (_) {}
          return serverPeers;
        });

        // 2. Authoritative server messages
        const serverMessages: ChatMessage[] = Array.isArray(data.messages) ? data.messages : [];
        setMessages((prev) => {
          if (
            prev.length === serverMessages.length &&
            prev.length > 0 &&
            prev[prev.length - 1]?.id === serverMessages[serverMessages.length - 1]?.id
          ) {
            return prev;
          }
          const msgMap = new Map<string, ChatMessage>();
          for (const m of serverMessages) {
            if (m.id) msgMap.set(m.id, m);
          }
          for (const m of prev) {
            if (m.id && !msgMap.has(m.id)) msgMap.set(m.id, m);
          }
          const merged = Array.from(msgMap.values()).sort((a, b) => a.timestamp - b.timestamp);
          try {
            localStorage.setItem(getUserStorageKey(STORAGE_KEYS.MESSAGES, cleanId), JSON.stringify(merged.slice(-1000)));
          } catch (_) {}
          return merged;
        });
      }
    } catch (err) {
      console.error('Error loading Neon bootstrap data:', err);
    }
  }, []);

  const loadBootstrapData = useCallback(async () => {
    await loadBootstrapDataForUser(effectiveIdentifier);
  }, [effectiveIdentifier, loadBootstrapDataForUser]);

  useEffect(() => {
    if (googleUser?.email) {
      loadBootstrapDataForUser(googleUser.email);
    } else {
      loadBootstrapData();
    }
  }, [googleUser?.email, loadBootstrapData, loadBootstrapDataForUser]);

  // Handle User authentication
  const handleUserAuthenticated = (user: GoogleUserProfile) => {
    setGoogleUser(user);
    sessionStorage.setItem('dconnect_tab_user', JSON.stringify(user));
    localStorage.setItem('dconnect_google_user', JSON.stringify(user));
    if (user.name) {
      setMyUsername(user.name);
      localStorage.setItem(STORAGE_KEYS.USERNAME, user.name);
    }
    const emailDomain = cleanDomain(user.email);
    setMyDomain(emailDomain);
    localStorage.setItem(STORAGE_KEYS.DOMAIN, emailDomain);

    try {
      const cachedPeers = localStorage.getItem(getUserStorageKey(STORAGE_KEYS.PEERS, emailDomain));
      if (cachedPeers) {
        setPeers(JSON.parse(cachedPeers));
      }
      const cachedMsgs = localStorage.getItem(getUserStorageKey(STORAGE_KEYS.MESSAGES, emailDomain));
      if (cachedMsgs) {
        setMessages(JSON.parse(cachedMsgs));
      }
    } catch (_) {}

    loadBootstrapDataForUser(emailDomain);
  };

  const handleSignOut = () => {
    setGoogleUser(null);
    sessionStorage.removeItem('dconnect_tab_user');
    localStorage.removeItem('dconnect_google_user');
    setMessages([]);
    setPeers([]);
    setActiveTarget({ id: 'general', type: 'channel', name: 'general' });
  };

  // Fetch registered users for friend discovery
  const fetchRegisteredUsers = async () => {
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.users)) {
          setDiscoveredUsers(data.users.filter((u: any) => cleanDomain(u.email) !== cleanDomain(effectiveIdentifier)));
        }
      }
    } catch (_) {}
  };

  useEffect(() => {
    if (showAddPeerModal) {
      fetchRegisteredUsers();
    }
  }, [showAddPeerModal, effectiveIdentifier]);

  // Persist State to LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.DOMAIN, myDomain);
      localStorage.setItem(STORAGE_KEYS.USERNAME, myUsername);
      localStorage.setItem(STORAGE_KEYS.AVATAR, myAvatarColor);
      localStorage.setItem(STORAGE_KEYS.CHANNELS, JSON.stringify(channels));
      localStorage.setItem(getUserStorageKey(STORAGE_KEYS.PEERS, effectiveIdentifier), JSON.stringify(peers));
      localStorage.setItem(getUserStorageKey(STORAGE_KEYS.MESSAGES, effectiveIdentifier), JSON.stringify(messages.slice(-1000)));
    } catch (_) {}
  }, [myDomain, myUsername, myAvatarColor, channels, peers, messages, effectiveIdentifier]);

  // =========================================================================
  // REAL-TIME SERVER-SENT EVENTS (SSE) STREAM LISTENER
  // =========================================================================
  useEffect(() => {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const eventSource = new EventSource(
      `/api/chat/stream?clientId=${clientId}&userIdentifier=${encodeURIComponent(effectiveIdentifier)}`
    );

    eventSource.onmessage = (e) => {
      try {
        const { type, payload } = JSON.parse(e.data);
        if (!payload) return;

        if (type === 'peer_request_received') {
          // Check if request is intended for us
          const ownerClean = cleanDomain(payload.ownerDomain || '');
          const myClean = cleanDomain(effectiveIdentifier);

          if (!ownerClean || ownerClean === myClean) {
            const fromDomain = cleanDomain(payload.domain);
            if (fromDomain === myClean) return;

            setPeers((prev) => {
              const existingIdx = prev.findIndex((p) => cleanDomain(p.domain) === fromDomain);
              const newPeer: PeerIdentity = {
                domain: fromDomain,
                username: payload.username || fromDomain.split('@')[0],
                avatarColor: payload.avatarColor || 'purple',
                inboxUrl: payload.inboxUrl || `https://${fromDomain}/api/p2p/inbox`,
                status: 'pending',
                direction: 'incoming',
                addedAt: payload.addedAt || Date.now(),
                lastSeen: Date.now(),
              };

              let updated: PeerIdentity[];
              if (existingIdx !== -1) {
                if (prev[existingIdx].status === 'accepted') return prev;
                const copy = [...prev];
                copy[existingIdx] = { ...copy[existingIdx], ...newPeer };
                updated = copy;
              } else {
                updated = [...prev, newPeer];
              }
              try {
                localStorage.setItem(getUserStorageKey(STORAGE_KEYS.PEERS, effectiveIdentifier), JSON.stringify(updated));
              } catch (_) {}
              return updated;
            });
            playChime();
          }
        } else if (type === 'peer_updated') {
          const targetClean = cleanDomain(payload.domain);
          const ownerClean = cleanDomain(payload.ownerDomain || '');
          const myClean = cleanDomain(effectiveIdentifier);

          if (!ownerClean || ownerClean === myClean) {
            setPeers((prev) => {
              const updated = prev.map((p) => {
                if (cleanDomain(p.domain) === targetClean) {
                  return {
                    ...p,
                    status: payload.status,
                    direction: payload.direction || p.direction,
                    username: payload.username || p.username,
                    avatarColor: payload.avatarColor || p.avatarColor,
                    lastSeen: payload.lastSeen || Date.now(),
                  };
                }
                return p;
              });
              try {
                localStorage.setItem(getUserStorageKey(STORAGE_KEYS.PEERS, effectiveIdentifier), JSON.stringify(updated));
              } catch (_) {}
              return updated;
            });
            if (payload.status === 'accepted') {
              playChime();
            }
          }
        } else if (type === 'peer_deleted') {
          const targetClean = cleanDomain(payload.domain);
          const ownerClean = cleanDomain(payload.ownerDomain || '');
          const myClean = cleanDomain(effectiveIdentifier);

          // Only process deletion if targeted at this user
          if (ownerClean && ownerClean !== myClean) return;

          setPeers((prev) => {
            const updated = prev.filter((p) => cleanDomain(p.domain) !== targetClean);
            try {
              localStorage.setItem(getUserStorageKey(STORAGE_KEYS.PEERS, effectiveIdentifier), JSON.stringify(updated));
            } catch (_) {}
            return updated;
          });
          setMessages((prev) => {
            const updated = prev.filter(
              (m) =>
                cleanDomain(m.targetId) !== targetClean &&
                cleanDomain(m.senderDomain || '') !== targetClean &&
                cleanDomain(m.senderId || '') !== targetClean
            );
            try {
              localStorage.setItem(getUserStorageKey(STORAGE_KEYS.MESSAGES, effectiveIdentifier), JSON.stringify(updated));
            } catch (_) {}
            return updated;
          });
        } else if (type === 'message_new') {
          const msg = payload as ChatMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });

          const current = activeTargetRef.current;
          const isViewingThisChat =
            current.id === msg.targetId ||
            (msg.targetType === 'p2p' &&
              (cleanDomain(current.id) === cleanDomain(msg.senderDomain || msg.senderId) ||
                cleanDomain(current.domain || '') === cleanDomain(msg.senderDomain || msg.senderId)));

          if (!isViewingThisChat) {
            const badgeKey =
              msg.targetType === 'channel' ? msg.targetId : msg.senderDomain || msg.senderId;
            setUnreadMap((prev) => ({
              ...prev,
              [badgeKey]: (prev[badgeKey] || 0) + 1,
            }));
          }
          playChime();
        } else if (type === 'channel_new') {
          const newChan = payload as ChatChannel;
          setChannels((prev) => {
            if (prev.some((c) => c.id === newChan.id)) return prev;
            return [...prev, newChan];
          });
        }
      } catch (_) {}
    };

    return () => {
      eventSource.close();
    };
  }, [effectiveIdentifier, myDomain]);

  // =========================================================================
  // LIVE CRAWLER PING SENDER ACTION (Pure HTTP / Webhook & Database)
  // =========================================================================
  const handleSendTestPing = async () => {
    if (!activeTarget.domain && !activeTarget.id) return;
    const target = activeTarget.domain || activeTarget.id;
    if (isSendingPingTest) return;

    setIsSendingPingTest(true);
    setPingTestResult('Pinging...');
    try {
      const res = await crawlerPingSender.sendPing({
        action: 'probe',
        senderDomain: effectiveIdentifier,
        senderUsername: myUsername,
        senderAvatarColor: myAvatarColor,
        senderTags: myCrawlerTags,
        targetIdentifier: target,
      });

      if (res.success) {
        setPingTestResult(`Pong ${res.latencyMs || 25}ms ✓`);
      } else {
        setPingTestResult('Ping Failed');
      }
    } catch (_) {
      setPingTestResult('Ping Error');
    } finally {
      setIsSendingPingTest(false);
      setTimeout(() => setPingTestResult(null), 3000);
    }
  };

  // Periodic background sync: syncs peers & messages from Neon DB every 15s or on window focus
  useEffect(() => {
    const onFocus = () => {
      loadBootstrapData();
    };
    window.addEventListener('focus', onFocus);
    const interval = setInterval(() => {
      loadBootstrapData();
    }, 15000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(interval);
    };
  }, [loadBootstrapData]);

  // Filter messages for current active target
  const currentMessages = messages.filter((m) => {
    if (activeTarget.type === 'channel') {
      return m.targetId === activeTarget.id;
    }
    const cleanActiveId = cleanDomain(activeTarget.id);
    const cleanSender = cleanDomain(m.senderDomain || m.senderId);
    const cleanTarget = cleanDomain(m.targetId);
    const cleanMe = cleanDomain(effectiveIdentifier);

    return (
      (cleanTarget === cleanActiveId && (cleanSender === cleanMe || cleanSender === cleanDomain(myDomain))) ||
      (cleanTarget === cleanMe && cleanSender === cleanActiveId) ||
      (cleanTarget === cleanDomain(myDomain) && cleanSender === cleanActiveId) ||
      cleanTarget === cleanActiveId
    );
  });

  // Switch chat target
  const handleSelectChat = (target: {
    id: string;
    type: 'channel' | 'p2p';
    name: string;
    domain?: string;
  }) => {
    setActiveTarget(target);
    setUnreadMap((prev) => {
      const copy = { ...prev };
      delete copy[target.id];
      if (target.domain) delete copy[target.domain];
      return copy;
    });
    setReplyingTo(null);
    setIsMobileNavOpen(false);
  };

  // SEND FRIEND REQUEST ACTION (Dual-sided Database persistence + Web Crawler Ping)
  const handleProbeAndAddPeer = async (e?: React.FormEvent, directTarget?: string) => {
    if (e) e.preventDefault();
    const target = directTarget || peerInputDomain;
    if (!target.trim()) return;

    setIsProbingPeer(true);
    const targetClean = cleanDomain(target);
    const senderClean = cleanDomain(effectiveIdentifier);

    if (targetClean === senderClean) {
      setPeerProbeStatus('Cannot add yourself as a friend.');
      setIsProbingPeer(false);
      return;
    }

    setPeerProbeStatus(`Dispatching crawler ping to ${targetClean}...`);

    const peerUsername = targetClean.split('@')[0].split('.')[0];
    const peerAvatar = 'purple';

    // 1. Crawler Ping Sender (Persists to database & delivers via hybrid webhook)
    try {
      const pingRes = await crawlerPingSender.sendPing({
        action: 'friend_request',
        senderDomain: senderClean,
        senderUsername: myUsername,
        senderAvatarColor: myAvatarColor,
        senderTags: myCrawlerTags,
        targetIdentifier: targetClean,
        note: peerInputNote || `Hi from ${senderClean}`,
      });

      if (!pingRes.success) {
        setPeerProbeStatus(`Error: ${pingRes.error || 'Failed to send'}`);
        setIsProbingPeer(false);
        return;
      }
    } catch (err: any) {
      setPeerProbeStatus(`Error: ${err?.message || 'Crawler ping failed'}`);
      setIsProbingPeer(false);
      return;
    }

    // Save outgoing request to state
    const newPeerObj: PeerIdentity = {
      domain: targetClean,
      username: peerUsername,
      avatarColor: peerAvatar,
      inboxUrl: `https://${targetClean}/api/crawler/ping`,
      status: 'pending',
      direction: 'outgoing',
      addedAt: Date.now(),
      lastSeen: Date.now(),
      crawlerTags: [`#${peerUsername}`, `tag:${targetClean.split('@')[0]}`, 'crawler-ping:active'],
    };

    setPeers((prev) => {
      const filtered = prev.filter((p) => cleanDomain(p.domain) !== targetClean);
      const updated = [...filtered, newPeerObj];
      try {
        localStorage.setItem(getUserStorageKey(STORAGE_KEYS.PEERS, effectiveIdentifier), JSON.stringify(updated));
      } catch (_) {}
      return updated;
    });

    setPeerProbeStatus(`Crawler Ping delivered & saved to database! Waiting for approval.`);

    setTimeout(() => {
      setShowAddPeerModal(false);
      setPeerInputDomain('');
      setPeerInputNote('');
      setPeerProbeStatus(null);
      setIsProbingPeer(false);
    }, 1200);
  };

  // ACCEPT / DECLINE INCOMING FRIEND REQUEST
  const handleRespondFriendRequest = async (peerDomain: string, accept: boolean) => {
    const targetClean = cleanDomain(peerDomain);
    const peer = peers.find((p) => cleanDomain(p.domain) === targetClean);
    if (!peer) return;

    if (accept) {
      const updatedPeer: PeerIdentity = {
        ...peer,
        status: 'accepted',
        lastSeen: Date.now(),
      };
      setPeers((prev) => {
        const updated = prev.map((p) => (cleanDomain(p.domain) === targetClean ? updatedPeer : p));
        try {
          localStorage.setItem(getUserStorageKey(STORAGE_KEYS.PEERS, effectiveIdentifier), JSON.stringify(updated));
        } catch (_) {}
        return updated;
      });
    } else {
      // Declined: remove from peers list
      setPeers((prev) => {
        const updated = prev.filter((p) => cleanDomain(p.domain) !== targetClean);
        try {
          localStorage.setItem(getUserStorageKey(STORAGE_KEYS.PEERS, effectiveIdentifier), JSON.stringify(updated));
        } catch (_) {}
        return updated;
      });
    }

    // Update Database and notify via Crawler Ping
    try {
      await crawlerPingSender.sendPing({
        action: accept ? 'friend_accept' : 'friend_decline',
        senderDomain: effectiveIdentifier,
        senderUsername: myUsername,
        senderAvatarColor: myAvatarColor,
        targetIdentifier: targetClean,
      });
    } catch (_) {}

    if (accept) {
      handleSelectChat({
        id: targetClean,
        type: 'p2p',
        name: peer.username || targetClean,
        domain: targetClean,
      });
    }
  };

  // DELETE / CANCEL PEER
  const handleDeletePeer = async (peerDomain: string) => {
    const targetClean = cleanDomain(peerDomain);
    setPeers((prev) => {
      const updated = prev.filter((p) => cleanDomain(p.domain) !== targetClean);
      try {
        localStorage.setItem(getUserStorageKey(STORAGE_KEYS.PEERS, effectiveIdentifier), JSON.stringify(updated));
      } catch (_) {}
      return updated;
    });

    setMessages((prev) => {
      const updated = prev.filter(
        (m) =>
          cleanDomain(m.targetId) !== targetClean &&
          cleanDomain(m.senderDomain || '') !== targetClean &&
          cleanDomain(m.senderId || '') !== targetClean
      );
      try {
        localStorage.setItem(getUserStorageKey(STORAGE_KEYS.MESSAGES, effectiveIdentifier), JSON.stringify(updated));
      } catch (_) {}
      return updated;
    });

    try {
      await fetch(
        `/api/peer/${encodeURIComponent(targetClean)}?ownerDomain=${encodeURIComponent(effectiveIdentifier)}`,
        { method: 'DELETE', headers: getApiHeaders() }
      );
    } catch (_) {}

    if (activeTarget.type === 'p2p' && cleanDomain(activeTarget.id) === targetClean) {
      setActiveTarget({ id: 'general', type: 'channel', name: 'general' });
    }
  };

  // SEND MESSAGE (Stored in Database and delivered over Crawler Ping)
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputText.trim() && !imagePreview) || isSending) return;

    setIsSending(true);
    const textToSend = inputText.trim();
    const imageToSend = imagePreview;

    const newMsgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newMsg: ChatMessage = {
      id: newMsgId,
      targetId: activeTarget.id,
      targetType: activeTarget.type,
      senderId: effectiveIdentifier,
      senderDomain: effectiveIdentifier,
      senderName: myUsername,
      senderColor: myAvatarColor,
      text: textToSend,
      imageUrl: imageToSend || undefined,
      replyTo: replyingTo
        ? {
            id: replyingTo.id,
            senderName: replyingTo.senderName,
            text: replyingTo.text,
          }
        : undefined,
      reactions: {},
      timestamp: Date.now(),
      status: 'delivered',
      crawlerPingAck: true,
    };

    // Optimistic UI update
    setMessages((prev) => [...prev, newMsg]);
    setInputText('');
    setImagePreview(null);
    setReplyingTo(null);

    // 1. Deliver & Persist via Crawler Ping + Database
    if (activeTarget.type === 'p2p') {
      try {
        await crawlerPingSender.sendPing({
          action: 'message',
          senderDomain: effectiveIdentifier,
          senderUsername: myUsername,
          senderAvatarColor: myAvatarColor,
          senderTags: myCrawlerTags,
          targetIdentifier: activeTarget.id,
          message: {
            id: newMsg.id,
            text: textToSend,
            imageUrl: imageToSend || undefined,
            replyTo: newMsg.replyTo,
            timestamp: newMsg.timestamp,
          },
        });
      } catch (_) {}
    } else {
      // Channel message stored in database
      try {
        await fetch('/api/chat/message', {
          method: 'POST',
          headers: getApiHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            targetId: activeTarget.id,
            targetType: activeTarget.type,
            text: textToSend,
            imageUrl: imageToSend,
            replyTo: newMsg.replyTo,
            senderId: effectiveIdentifier,
            senderName: myUsername,
            senderColor: myAvatarColor,
          }),
        });
      } catch (_) {}
    }

    setIsSending(false);
  };

  // Image Selection Handler
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      alert('Image size exceeds 8MB limit.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Create New Channel
  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelName.trim()) return;

    try {
      const res = await fetch('/api/chat/channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newChannelName.trim(),
          description: newChannelDesc.trim(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setChannels((prev) => [...prev, data.channel]);
        setShowNewChannelModal(false);
        setNewChannelName('');
        setNewChannelDesc('');
        handleSelectChat({
          id: data.channel.id,
          type: 'channel',
          name: data.channel.name,
        });
      }
    } catch (_) {}
  };

  // Node Configuration Save
  const handleSaveNodeConfig = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editDomain.trim()) return;

    const clean = cleanDomain(editDomain);
    setMyDomain(clean);
    setMyUsername(editUsername.trim() || clean.split('.')[0]);
    setMyAvatarColor(editColor);

    localStorage.setItem(STORAGE_KEYS.DOMAIN, clean);
    localStorage.setItem(STORAGE_KEYS.USERNAME, editUsername.trim() || clean.split('.')[0]);
    localStorage.setItem(STORAGE_KEYS.AVATAR, editColor);

    setShowNodeConfigModal(false);
  };

  // Copy Node Link
  const handleCopyLink = () => {
    const link = `https://${effectiveIdentifier}`;
    navigator.clipboard.writeText(link);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const incomingRequests = peers.filter((p) => p.status === 'pending' && p.direction === 'incoming');
  const outgoingRequests = peers.filter((p) => p.status === 'pending' && p.direction === 'outgoing');
  const acceptedPeers = peers.filter((p) => p.status === 'accepted');

  // Mandatory Onboarding / Sign-In Gate: Ensure user is authenticated before chat
  if (!googleUser) {
    return (
      <>
        <OnboardingAuth
          onAuthenticated={handleUserAuthenticated}
          neonConfigured={neonConfigured}
          onOpenNeonModal={() => setShowNeonModal(true)}
        />
        <NeonDbModal isOpen={showNeonModal} onClose={() => setShowNeonModal(false)} />
      </>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-black text-slate-100 font-sans select-none antialiased">
      {/* 1. SIDEBAR */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-[#1a1a1a] bg-[#09090b] transition-transform duration-200 ease-in-out md:static md:translate-x-0 ${
          isMobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Top Header & Google Auth */}
        <div className="flex flex-col border-b border-[#1a1a1a] p-3.5 space-y-3 bg-[#0c0c0e]">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 shadow-md text-white font-bold">
                <Radio className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center space-x-1.5">
                  <h1 className="font-bold text-sm tracking-tight text-white">D-Connect</h1>
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-400 border border-indigo-800/40">
                    Crawler
                  </span>
                </div>
                <div className="flex items-center space-x-1.5 text-[11px] text-[#8e8e93]">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      crawlerActive ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                    }`}
                  />
                  <span className="truncate max-w-[130px] font-mono">{effectiveIdentifier}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-1">
              {/* Crawler Console / Activity Log */}
              <button
                onClick={() => setShowCrawlerConsole(true)}
                title="Crawler Ping Console"
                className="p-1.5 rounded-lg bg-[#141417] border border-[#222226] text-indigo-400 hover:text-white transition cursor-pointer"
              >
                <Terminal className="h-4 w-4" />
              </button>

              {/* Neon DB Modal Button */}
              <button
                onClick={() => setShowNeonModal(true)}
                title="Neon PostgreSQL Database"
                className={`p-1.5 rounded-lg border transition cursor-pointer ${
                  neonConfigured
                    ? 'bg-emerald-950/60 border-emerald-800/60 text-emerald-400'
                    : 'bg-[#141417] border-[#222226] text-[#8e8e93] hover:text-white'
                }`}
              >
                <Database className="h-4 w-4" />
              </button>

              {/* Node Settings Button */}
              <button
                onClick={() => {
                  setEditDomain(myDomain);
                  setEditUsername(myUsername);
                  setEditColor(myAvatarColor);
                  setShowNodeConfigModal(true);
                }}
                title="Node Settings"
                className="p-1.5 rounded-lg bg-[#141417] border border-[#222226] text-[#8e8e93] hover:text-white transition cursor-pointer"
              >
                <Settings className="h-4 w-4" />
              </button>

              <button
                onClick={() => setIsMobileNavOpen(false)}
                className="p-1.5 rounded-lg text-[#8e8e93] hover:text-white md:hidden cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Google Sign In Component & Identity */}
          <div className="w-full">
            <GoogleAuthButton
              currentUser={googleUser}
              onUserAuthenticated={handleUserAuthenticated}
              onSignOut={handleSignOut}
            />
          </div>

          {/* Username Scene with Mini Crawler Discovery Tags */}
          <div className="flex flex-col p-2.5 rounded-xl bg-[#141417] border border-[#222226] text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 truncate">
                <span className="text-[10px] font-bold text-[#aeaeb2] uppercase tracking-wider">
                  Node User:
                </span>
                <span className="font-mono text-indigo-300 font-bold truncate">
                  {myUsername}
                </span>
                <span className="text-[9px] px-1 py-0.5 rounded bg-indigo-950/80 text-indigo-400 font-mono border border-indigo-800/40">
                  Subdomain
                </span>
              </div>
              <button
                onClick={handleCopyLink}
                title="Copy crawler identifier"
                className="text-[#8e8e93] hover:text-white transition cursor-pointer shrink-0"
              >
                {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>

            <div className="text-[10px] font-mono text-[#8e8e93] truncate">
              Domain: <span className="text-slate-300">{myDomain}</span>
            </div>

            {/* Mini Discovery Tags for Crawler Connection */}
            <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-[#222226]">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono bg-indigo-950/70 text-indigo-300 border border-indigo-800/40">
                &lt;tag: #{myUsername.toLowerCase().replace(/[^a-z0-9_-]/g, '')} /&gt;
              </span>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono bg-[#18181b] text-cyan-400 border border-cyan-900/50">
                &lt;node: @{myDomain.toLowerCase().replace(/:\d+$/, '')} /&gt;
              </span>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono bg-[#18181b] text-emerald-400 border border-emerald-900/50">
                &lt;ping: ready /&gt;
              </span>
            </div>
          </div>
        </div>

        {/* Sidebar Nav Lists */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {/* Action: Connect Peer */}
          <button
            onClick={() => setShowAddPeerModal(true)}
            className="w-full flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-sm cursor-pointer"
          >
            <UserPlus className="h-4 w-4" />
            <span>Connect Peer / Add Friend</span>
          </button>

          {/* INCOMING FRIEND REQUESTS (Action Required!) */}
          {incomingRequests.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-2 text-[11px] font-bold tracking-wider uppercase text-amber-400">
                <span className="flex items-center space-x-1">
                  <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping mr-1" />
                  Incoming Requests ({incomingRequests.length})
                </span>
              </div>
              <div className="space-y-1.5">
                {incomingRequests.map((peer) => (
                  <div
                    key={peer.domain}
                    className="p-2.5 rounded-xl bg-[#141417] border border-amber-500/40 shadow-sm space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2 min-w-0">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-950 text-amber-300 font-bold text-xs shrink-0">
                          {peer.username.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate">{peer.username}</p>
                          <p className="text-[10px] font-mono text-[#8e8e93] truncate">
                            {peer.domain}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1.5 pt-1">
                      <button
                        onClick={() => handleRespondFriendRequest(peer.domain, true)}
                        className="flex-1 flex items-center justify-center space-x-1 py-1 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition cursor-pointer"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Accept & Connect</span>
                      </button>
                      <button
                        onClick={() => handleRespondFriendRequest(peer.domain, false)}
                        className="p-1 px-2 rounded-lg bg-[#222226] hover:bg-rose-950 hover:text-rose-400 text-[#8e8e93] text-xs transition cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* OUTGOING PENDING REQUESTS */}
          {outgoingRequests.length > 0 && (
            <div className="space-y-1">
              <div className="px-2 text-[11px] font-bold tracking-wider uppercase text-[#8e8e93]">
                Sent Requests ({outgoingRequests.length})
              </div>
              {outgoingRequests.map((peer) => (
                <div
                  key={peer.domain}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-[#141417] border border-[#222226] text-xs"
                >
                  <div className="flex items-center space-x-2 min-w-0">
                    <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    <span className="text-white font-medium truncate">{peer.username}</span>
                  </div>
                  <button
                    onClick={() => handleDeletePeer(peer.domain)}
                    className="text-[#8e8e93] hover:text-rose-400 transition cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* CONNECTED PEERS / FRIENDS */}
          <div className="space-y-1">
            <div className="flex items-center justify-between px-2 text-[11px] font-bold tracking-wider uppercase text-[#8e8e93]">
              <span>Connected Friends ({acceptedPeers.length})</span>
            </div>

            {acceptedPeers.length === 0 ? (
              <div className="p-3 text-center rounded-xl bg-[#141417]/50 border border-[#222226]/50 text-xs text-[#636366]">
                No connected peers yet. Click <strong>Connect Peer</strong> above to add friends!
              </div>
            ) : (
              acceptedPeers.map((peer) => {
                const isActive = activeTarget.type === 'p2p' && cleanDomain(activeTarget.id) === cleanDomain(peer.domain);
                const unread = unreadMap[peer.domain] || 0;
                return (
                  <div
                    key={peer.domain}
                    onClick={() =>
                      handleSelectChat({
                        id: peer.domain,
                        type: 'p2p',
                        name: peer.username,
                        domain: peer.domain,
                      })
                    }
                    className={`group flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition cursor-pointer ${
                      isActive
                        ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                        : 'text-[#aeaeb2] hover:bg-[#141417] hover:text-white'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <div
                        className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${
                          isActive ? 'bg-indigo-700 text-white' : 'bg-[#222226] text-indigo-400'
                        }`}
                      >
                        {peer.username.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate">{peer.username}</p>
                        <div className="flex items-center space-x-1 mt-0.5">
                          <span
                            className={`text-[9px] font-mono px-1 rounded truncate ${
                              isActive ? 'bg-indigo-700/60 text-indigo-200' : 'bg-indigo-950/50 text-indigo-300'
                            }`}
                          >
                            &lt;#{peer.username.toLowerCase().replace(/[^a-z0-9]/g, '')}&gt;
                          </span>
                          <span
                            className={`text-[9px] font-mono truncate ${
                              isActive ? 'text-indigo-200' : 'text-[#636366]'
                            }`}
                          >
                            @{peer.domain}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1">
                      {unread > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500 text-white">
                          {unread}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePeer(peer.domain);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded text-[#8e8e93] hover:text-rose-400 transition cursor-pointer"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* CHANNELS */}
          <div className="space-y-1">
            <div className="flex items-center justify-between px-2 text-[11px] font-bold tracking-wider uppercase text-[#8e8e93]">
              <span>Channels</span>
              <button
                onClick={() => setShowNewChannelModal(true)}
                className="text-[#8e8e93] hover:text-white transition cursor-pointer"
                title="Create channel"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            {channels.map((chan) => {
              const isActive = activeTarget.type === 'channel' && activeTarget.id === chan.id;
              const unread = unreadMap[chan.id] || 0;
              return (
                <button
                  key={chan.id}
                  onClick={() =>
                    handleSelectChat({
                      id: chan.id,
                      type: 'channel',
                      name: chan.name,
                    })
                  }
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                      : 'text-[#aeaeb2] hover:bg-[#141417] hover:text-white'
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    <Hash className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{chan.name}</span>
                  </div>
                  {unread > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500 text-white">
                      {unread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Sidebar Footer */}
        <div className="p-3 border-t border-[#1a1a1a] bg-[#0c0c0e] space-y-2">
          <PWAInstallButton />

          <div className="flex items-center justify-between text-[11px] text-[#8e8e93] px-1">
            <button
              onClick={() => setShowHowItWorksModal(true)}
              className="hover:text-indigo-400 flex items-center space-x-1 cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>How it works</span>
            </button>
            <button
              onClick={() => setShowCapacitorModal(true)}
              className="hover:text-indigo-400 flex items-center space-x-1 cursor-pointer"
            >
              <Smartphone className="h-3.5 w-3.5" />
              <span>Android APK</span>
            </button>
          </div>
        </div>
      </aside>

      {/* 2. MAIN CHAT AREA */}
      <main className="flex flex-1 flex-col h-full min-w-0 overflow-hidden bg-black">
        {/* Chat Top Header */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b px-4 border-[#1a1a1a] bg-[#0c0c0e] z-10">
          <div className="flex items-center space-x-3 min-w-0">
            <button
              onClick={() => setIsMobileNavOpen(true)}
              className="p-1.5 rounded-lg text-[#8e8e93] hover:text-white md:hidden cursor-pointer"
              aria-label="Open sidebar"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="flex items-center space-x-2.5 min-w-0">
              {activeTarget.type === 'channel' ? (
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#141417] text-indigo-400 font-bold shrink-0">
                  <Hash className="h-5 w-5" />
                </div>
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white font-bold shrink-0 text-sm">
                  {activeTarget.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center space-x-2">
                  <h2 className="text-base font-bold text-white truncate leading-tight">
                    {activeTarget.type === 'channel' ? `#${activeTarget.name}` : activeTarget.name}
                  </h2>
                  {activeTarget.type === 'p2p' ? (
                    <div className="flex items-center space-x-1.5">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-950/70 text-indigo-300 border border-indigo-800/40">
                        &lt;tag: #{activeTarget.name.toLowerCase().replace(/[^a-z0-9]/g, '')}&gt;
                      </span>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
                        Crawler Ping
                      </span>
                    </div>
                  ) : (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-950/60 text-indigo-400 border border-indigo-800/40">
                      Channel
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#8e8e93] truncate">
                  {activeTarget.type === 'channel'
                    ? channels.find((c) => c.id === activeTarget.id)?.description || 'Global broadcast channel'
                    : `Discovered via crawler tags: ${activeTarget.domain}`}
                </p>
              </div>
            </div>
          </div>

          {/* Quick Header Actions */}
          <div className="flex items-center space-x-2">
            {/* Live Crawler Test Ping Button */}
            {activeTarget.type === 'p2p' && (
              <button
                onClick={handleSendTestPing}
                disabled={isSendingPingTest}
                className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-950/60 border border-indigo-800/60 text-indigo-300 font-mono text-xs hover:bg-indigo-900/60 transition cursor-pointer"
                title="Send a live crawler ping"
              >
                <Activity className={`h-3.5 w-3.5 text-indigo-400 ${isSendingPingTest ? 'animate-spin' : ''}`} />
                <span>{pingTestResult || 'Ping Node'}</span>
              </button>
            )}

            {/* User Account Info Chip */}
            <div className="hidden lg:flex items-center space-x-2 px-2.5 py-1 rounded-xl bg-[#141417] border border-[#222226] text-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-medium text-white truncate max-w-[150px]">
                {googleUser?.email || effectiveIdentifier}
              </span>
            </div>

            <button
              onClick={() => setShowAddPeerModal(true)}
              className="hidden sm:flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-[#141417] border border-[#222226] text-indigo-400 font-semibold text-xs hover:bg-[#222226] transition cursor-pointer"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>Connect Peer</span>
            </button>
            <button
              onClick={() => {
                if (confirm('Clear chat history for this view?')) {
                  setMessages((prev) => prev.filter((m) => m.targetId !== activeTarget.id));
                  try {
                    fetch('/api/chat/clear', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ targetId: activeTarget.id }),
                    }).catch(() => {});
                  } catch (_) {}
                }
              }}
              title="Clear conversation"
              className="p-2 rounded-lg text-[#8e8e93] hover:text-rose-400 hover:bg-[#141417] transition cursor-pointer"
            >
              <Trash2 className="h-4 w-4" />
            </button>

            {/* Sign Out Button */}
            <button
              onClick={handleSignOut}
              title="Sign out / Switch account"
              className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-[#141417] border border-[#222226] text-[#8e8e93] hover:text-rose-400 hover:border-rose-900/50 transition cursor-pointer text-xs"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline font-medium">Sign Out</span>
            </button>
          </div>
        </header>

        {/* Neon PostgreSQL Cloud Sync Status Banner */}
        {!neonConfigured ? (
          <div className="flex items-center justify-between px-4 py-2 bg-amber-950/40 border-b border-amber-800/40 text-xs text-amber-200">
            <div className="flex items-center space-x-2">
              <Database className="h-4 w-4 text-amber-400 shrink-0" />
              <span>
                <strong>Cross-Device Cloud Sync:</strong>{' '}
                {dbStatusInfo?.detectedEnvKeys && dbStatusInfo.detectedEnvKeys.length > 0 ? (
                  <span>
                    Detected Vercel env (<strong>{dbStatusInfo.detectedEnvKeys.slice(0, 2).join(', ')}</strong>).{' '}
                    {dbStatusInfo?.message && dbStatusInfo.message.includes('Error')
                      ? dbStatusInfo.message
                      : 'Connecting to database...'}
                  </span>
                ) : (
                  'Neon Database is not connected yet. Connect Neon DB to sync friends & messages across Mobile & PC!'
                )}
              </span>
            </div>
            <button
              onClick={() => setShowNeonModal(true)}
              className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-black font-bold text-[11px] rounded-lg transition shrink-0 cursor-pointer ml-2"
            >
              Configure Neon DB
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between px-4 py-1.5 bg-emerald-950/30 border-b border-emerald-900/30 text-[11px] text-emerald-300">
            <div className="flex items-center space-x-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>
                <strong>Neon PostgreSQL Live:</strong> Cross-device sync is active. All friends and messages persist across mobile & PC.
              </span>
            </div>
            <button
              onClick={() => loadBootstrapData()}
              className="flex items-center space-x-1 text-emerald-400 hover:text-white transition cursor-pointer"
              title="Sync latest friends and messages"
            >
              <RefreshCw className="h-3 w-3" />
              <span className="font-semibold">Sync</span>
            </button>
          </div>
        )}

        {/* Message Feed */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-black">
          {currentMessages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center p-6 space-y-3 text-[#636366]">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#141417] text-indigo-400 border border-[#222226]">
                {activeTarget.type === 'channel' ? <Hash className="h-7 w-7" /> : <Globe className="h-7 w-7" />}
              </div>
              <div className="max-w-sm">
                <p className="font-semibold text-white">
                  {activeTarget.type === 'channel'
                    ? `Welcome to #${activeTarget.name}`
                    : `Connected directly to ${activeTarget.name}`}
                </p>
                <p className="text-xs mt-1 text-[#8e8e93]">
                  {activeTarget.type === 'p2p'
                    ? `Messages are saved in Neon PostgreSQL and delivered in real-time over WebRTC/SSE.`
                    : 'Start the conversation by typing a message below.'}
                </p>
              </div>
            </div>
          ) : (
            currentMessages.map((msg) => {
              const isMe =
                cleanDomain(msg.senderDomain || msg.senderId) === cleanDomain(effectiveIdentifier) ||
                cleanDomain(msg.senderDomain || msg.senderId) === cleanDomain(myDomain);
              const timeString = new Date(msg.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });
              const color = AVATAR_COLORS[msg.senderColor] || AVATAR_COLORS.indigo;

              return (
                <div
                  key={msg.id}
                  className={`group relative flex items-start space-x-2.5 ${
                    isMe ? 'flex-row-reverse space-x-reverse' : ''
                  }`}
                >
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${color.bg} ${color.text} shadow-xs`}
                  >
                    {msg.senderName.slice(0, 2).toUpperCase()}
                  </div>

                  <div className={`flex flex-col max-w-[85%] md:max-w-[70%] ${isMe ? 'items-end' : 'items-start'}`}>
                    <div className="flex items-center space-x-1.5 px-1 pb-1 text-[11px] text-[#8e8e93]">
                      <span className="font-semibold text-white">{msg.senderName}</span>
                      <span className="font-mono text-[9px] text-indigo-400 bg-indigo-950/60 px-1 rounded">
                        &lt;#{msg.senderName.toLowerCase().replace(/[^a-z0-9]/g, '')}&gt;
                      </span>
                      {msg.senderDomain && (
                        <span className="font-mono text-[10px] text-[#636366]">
                          @{msg.senderDomain}
                        </span>
                      )}
                      <span>•</span>
                      <span>{timeString}</span>
                    </div>

                    <div
                      className={`relative px-3.5 py-2.5 rounded-2xl text-sm break-words transition shadow-xs ${
                        isMe
                          ? 'bg-indigo-600 text-white rounded-tr-xs'
                          : 'bg-[#141417] text-[#f2f2f7] border border-[#222226] rounded-tl-xs'
                      }`}
                    >
                      {msg.replyTo && (
                        <div
                          className={`mb-2 px-2.5 py-1.5 rounded-lg text-xs border-l-2 ${
                            isMe
                              ? 'bg-indigo-700/60 border-indigo-300 text-indigo-100'
                              : 'bg-black border-indigo-500 text-[#aeaeb2]'
                          }`}
                        >
                          <span className="font-bold block text-[10px] uppercase tracking-wider text-[#8e8e93]">
                            Replying to {msg.replyTo.senderName}
                          </span>
                          <span className="line-clamp-1 italic text-[11px]">{msg.replyTo.text}</span>
                        </div>
                      )}

                      {msg.imageUrl && (
                        <div className="mb-2">
                          <img
                            src={msg.imageUrl}
                            alt="Attachment"
                            className="max-h-64 rounded-xl object-cover"
                          />
                        </div>
                      )}

                      {msg.text && (
                        <p className="whitespace-pre-wrap leading-relaxed select-text">{msg.text}</p>
                      )}
                    </div>
                  </div>

                  {/* Message hover actions */}
                  <div
                    className={`opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-1 bg-[#141417] border border-[#222226] shadow-md rounded-xl p-1 z-10 ${
                      isMe ? 'self-center mr-1' : 'self-center ml-1'
                    }`}
                  >
                    <button
                      onClick={() => setReplyingTo(msg)}
                      title="Reply"
                      className="p-1 rounded text-[#8e8e93] hover:text-indigo-400 cursor-pointer"
                    >
                      <Reply className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(msg.text);
                        setCopiedId(msg.id);
                        setTimeout(() => setCopiedId(null), 1500);
                      }}
                      title="Copy"
                      className="p-1 rounded text-[#8e8e93] hover:text-indigo-400 cursor-pointer"
                    >
                      {copiedId === msg.id ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    {isMe && (
                      <button
                        onClick={() => {
                          setMessages((prev) => prev.filter((m) => m.id !== msg.id));
                        }}
                        title="Delete"
                        className="p-1 rounded text-[#8e8e93] hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* INPUT COMPOSER */}
        <div className="p-3 border-t border-[#1a1a1a] bg-[#0c0c0e]">
          {replyingTo && (
            <div className="flex items-center justify-between px-3 py-1.5 mb-2 bg-[#141417] border border-[#222226] rounded-lg text-xs">
              <div className="flex items-center space-x-2 truncate">
                <Reply className="h-3.5 w-3.5 text-indigo-400" />
                <span className="font-semibold text-white">
                  Replying to {replyingTo.senderName}:
                </span>
                <span className="italic text-[#8e8e93] truncate">{replyingTo.text}</span>
              </div>
              <button
                onClick={() => setReplyingTo(null)}
                className="text-[#8e8e93] hover:text-white cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {imagePreview && (
            <div className="relative inline-block mb-2">
              <img src={imagePreview} alt="Preview" className="h-16 w-16 rounded-lg object-cover border border-[#222226]" />
              <button
                onClick={() => setImagePreview(null)}
                className="absolute -top-1.5 -right-1.5 bg-rose-600 text-white rounded-full p-0.5 shadow cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          <form onSubmit={handleSendMessage} className="flex items-center space-x-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageSelect}
              accept="image/*"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 text-[#8e8e93] hover:text-white rounded-lg hover:bg-[#141417] transition cursor-pointer"
              title="Attach image"
            >
              <ImageIcon className="h-5 w-5" />
            </button>

            <div className="flex-1 relative flex items-center">
              <input
                type="text"
                placeholder={`Message ${activeTarget.type === 'channel' ? '#' + activeTarget.name : '@' + activeTarget.name}...`}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="w-full px-4 py-2.5 text-sm rounded-xl border border-[#222226] bg-[#141417] text-white placeholder-[#636366] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
              />
            </div>

            <button
              type="submit"
              disabled={(!inputText.trim() && !imagePreview) || isSending}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white font-semibold shadow-sm hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </main>

      {/* ============================================================ */}
      {/* MODAL 1: Connect Remote Peer / Friend (Friend Request) */}
      {/* ============================================================ */}
      {showAddPeerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-[#0c0c0e] border border-[#222226] p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-950 text-indigo-400">
                  <UserPlus className="h-4 w-4" />
                </div>
                <h3 className="font-bold text-base text-white">Connect Friend via Crawler Ping</h3>
              </div>
              <button
                onClick={() => setShowAddPeerModal(false)}
                className="text-[#8e8e93] hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-[#8e8e93] leading-relaxed">
              Enter the remote site's domain or subdomain (e.g.{' '}
              <code className="px-1 py-0.5 rounded bg-[#141417] text-indigo-300 font-mono">
                alice.railway.app
              </code>{' '}
              or <code className="px-1 py-0.5 rounded bg-[#141417] text-indigo-300 font-mono">node-2</code>).
              The Web Crawler Ping sender crawls their dynamic discovery tags, persists the request into the database, and delivers it via hybrid webhook.
            </p>

            <form onSubmit={(e) => handleProbeAndAddPeer(e)} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#aeaeb2] mb-1">
                  Friend's Domain, Subdomain, or Tag:
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    placeholder="e.g. alice.railway.app or node-2"
                    value={peerInputDomain}
                    onChange={(e) => {
                      setPeerInputDomain(e.target.value);
                      setDiscoveredTags([]);
                    }}
                    className="flex-1 px-3 py-2 text-sm rounded-xl border border-[#222226] bg-[#141417] text-white placeholder-[#636366] focus:outline-none focus:border-indigo-500 font-mono"
                    required
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!peerInputDomain.trim()) return;
                      const res = await crawlerPingSender.probeTarget(peerInputDomain);
                      setDiscoveredTags(res.tags);
                    }}
                    className="px-3 py-2 rounded-xl text-xs font-semibold bg-[#141417] border border-[#222226] text-indigo-400 hover:text-white hover:bg-[#222226] transition cursor-pointer shrink-0"
                    title="Probe target crawler tags"
                  >
                    <Search className="h-3.5 w-3.5 inline mr-1" />
                    <span>Scan Tags</span>
                  </button>
                </div>
              </div>

              {/* Crawler Mini Discovery Tags Preview */}
              {discoveredTags.length > 0 && (
                <div className="p-2.5 rounded-xl bg-[#141417] border border-indigo-900/40 space-y-1.5">
                  <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider block">
                    Discovered Crawler Meta Tags:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {discoveredTags.map((t, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-800/40"
                      >
                        &lt;{t.name}: {t.value} /&gt;
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#aeaeb2] mb-1">
                  Greeting note (optional):
                </label>
                <input
                  type="text"
                  placeholder="Hi, let's connect!"
                  value={peerInputNote}
                  onChange={(e) => setPeerInputNote(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-[#222226] bg-[#141417] text-white placeholder-[#636366] focus:outline-none focus:border-indigo-500"
                />
              </div>

              {peerProbeStatus && (
                <div className="p-2.5 rounded-lg bg-indigo-950/60 border border-indigo-800/60 text-xs text-indigo-300 flex items-center space-x-2">
                  <div className="animate-spin h-3.5 w-3.5 border-2 border-indigo-500 border-t-transparent rounded-full shrink-0"></div>
                  <span>{peerProbeStatus}</span>
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddPeerModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[#8e8e93] hover:bg-[#141417] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isProbingPeer || !peerInputDomain.trim()}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 transition cursor-pointer"
                >
                  {isProbingPeer ? 'Sending Ping...' : 'Send Crawler Ping'}
                </button>
              </div>
            </form>

            {/* Quick 1-Click Connect Discovered Users on this Node */}
            {discoveredUsers.length > 0 && (
              <div className="pt-3 border-t border-[#222226] space-y-2">
                <p className="text-[11px] font-bold text-[#aeaeb2] uppercase tracking-wider flex items-center space-x-1.5">
                  <Users className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Discovered Users on this Database</span>
                </p>
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {discoveredUsers.map((u) => {
                    const isAlreadyFriend = peers.some((p) => cleanDomain(p.domain) === cleanDomain(u.email));
                    return (
                      <div
                        key={u.id || u.email}
                        className="flex items-center justify-between p-2 rounded-xl bg-[#141417] border border-[#222226] text-xs"
                      >
                        <div className="flex items-center space-x-2 min-w-0">
                          {u.picture ? (
                            <img src={u.picture} alt="" className="h-6 w-6 rounded-full" />
                          ) : (
                            <div className="h-6 w-6 rounded-full bg-indigo-600 flex items-center justify-center font-bold text-[10px]">
                              {u.name?.slice(0, 1) || 'U'}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-semibold text-white truncate">{u.name || u.email}</p>
                            <p className="text-[10px] text-[#8e8e93] font-mono truncate">{u.email}</p>
                          </div>
                        </div>

                        {isAlreadyFriend ? (
                          <span className="text-[10px] font-semibold text-emerald-400">Connected</span>
                        ) : (
                          <button
                            onClick={() => handleProbeAndAddPeer(undefined, u.email)}
                            className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold cursor-pointer"
                          >
                            + Add
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 2: Node Settings (Configure Custom Domain) */}
      {/* ============================================================ */}
      {showNodeConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-[#0c0c0e] border border-[#222226] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Settings className="h-5 w-5 text-indigo-400" />
                <h3 className="font-bold text-base text-white">Node & Domain Configuration</h3>
              </div>
              <button
                onClick={() => setShowNodeConfigModal(false)}
                className="text-[#8e8e93] hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-[#8e8e93]">
              Set your public domain so peers can address their friend requests and messages directly to you.
            </p>

            <form onSubmit={handleSaveNodeConfig} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#aeaeb2] mb-1">
                  Public Domain / Subdomain:
                </label>
                <input
                  type="text"
                  placeholder="e.g. d-connect-2.vercel.app"
                  value={editDomain}
                  onChange={(e) => setEditDomain(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-[#222226] bg-[#141417] text-white focus:outline-none focus:border-indigo-500 font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#aeaeb2] mb-1">
                  Your Display Handle:
                </label>
                <input
                  type="text"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-[#222226] bg-[#141417] text-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#aeaeb2] mb-1">
                  Avatar Color:
                </label>
                <div className="flex items-center space-x-2">
                  {Object.keys(AVATAR_COLORS).map((c) => (
                    <button
                      type="button"
                      key={c}
                      onClick={() => setEditColor(c)}
                      className={`h-7 w-7 rounded-full ${AVATAR_COLORS[c].bg} ${
                        editColor === c ? 'ring-2 ring-offset-2 ring-indigo-500 ring-offset-black' : ''
                      } cursor-pointer`}
                    />
                  ))}
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowNodeConfigModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[#8e8e93] hover:bg-[#141417] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 cursor-pointer"
                >
                  Save Settings
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 3: How Crawler Ping & Webhook Federation Works */}
      {/* ============================================================ */}
      {showHowItWorksModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-[#0c0c0e] border border-[#222226] p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Sparkles className="h-5 w-5 text-indigo-400" />
                <h3 className="font-bold text-base text-white">How Crawler Ping & Webhook Federation Works</h3>
              </div>
              <button
                onClick={() => setShowHowItWorksModal(false)}
                className="text-[#8e8e93] hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="text-xs text-[#d1d1d6] space-y-3 leading-relaxed">
              <div className="p-3 rounded-xl bg-[#141417] border border-[#222226] space-y-1">
                <p className="font-bold text-indigo-400">1. Neon Serverless PostgreSQL Database</p>
                <p className="text-[#8e8e93]">
                  Like a conventional web app, everything (user profiles, channels, messages, contact lists) is persisted directly in PostgreSQL. If the remote site is offline, messages and requests wait in the DB.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-[#141417] border border-[#222226] space-y-1">
                <p className="font-bold text-indigo-400">2. Web Crawler Ping & Mini Discovery Tags</p>
                <p className="text-[#8e8e93]">
                  Each user has mini crawler tags (e.g. <code>&lt;tag: #username&gt;</code>, <code>&lt;ping: active&gt;</code>). When adding friends or chatting, the crawler sends a ping and hybrid webhook to the destination endpoint, verifies the tags, and receives a signed pong response.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-[#141417] border border-[#222226] space-y-1">
                <p className="font-bold text-indigo-400">3. Zero Fragile P2P / WebRTC Dependencies</p>
                <p className="text-[#8e8e93]">
                  No STUN/TURN servers, no signaling server drops, and no browser-to-browser NAT traversal failures. Standard HTTP ping sender + Server-Sent Events guarantees 100% deliverability.
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowHowItWorksModal(false)}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 cursor-pointer"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 6: Crawler Ping & Activity Console */}
      {/* ============================================================ */}
      {showCrawlerConsole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-2xl bg-[#0c0c0e] border border-[#222226] p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-[#222226] pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-950 text-indigo-400">
                  <Terminal className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Crawler Ping & Hybrid Webhook Console</h3>
                  <p className="text-[11px] text-[#8e8e93]">
                    Real-time inspector for crawler pings, discovery tags, and hybrid webhooks
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCrawlerConsole(false)}
                className="text-[#8e8e93] hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Current Node Crawler Mini Tags */}
            <div className="p-3 rounded-xl bg-[#141417] border border-[#222226] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-white">Active Discovery Meta Tags:</span>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded">
                  crawler-ping/2.1 active
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {myCrawlerTags.map((tag, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-800/40"
                  >
                    &lt;{tag} /&gt;
                  </span>
                ))}
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono bg-[#222226] text-slate-300">
                  &lt;node: {effectiveIdentifier}&gt;
                </span>
              </div>
            </div>

            {/* Live Logs Stream */}
            <div className="flex-1 overflow-y-auto space-y-2 min-h-[220px] font-mono text-[11px]">
              {crawlerLogs.length === 0 ? (
                <div className="p-6 text-center text-[#636366] text-xs">
                  No crawler pings dispatched yet. Send a friend request or message to see the crawler ping stream!
                </div>
              ) : (
                crawlerLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-2.5 rounded-xl bg-[#141417] border border-[#222226] space-y-1"
                  >
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="flex items-center space-x-1.5">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            log.status === 'verified'
                              ? 'bg-emerald-400'
                              : log.status === 'failed'
                              ? 'bg-rose-500'
                              : 'bg-indigo-400 animate-pulse'
                          }`}
                        />
                        <span className="font-bold text-white uppercase">{log.type.replace('_', ' ')}</span>
                        <span className="text-[#8e8e93]">→ {log.target}</span>
                      </span>
                      <span className="text-[#636366]">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>

                    <p className="text-xs text-[#aeaeb2] font-sans">{log.details}</p>

                    {log.tags && log.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {log.tags.map((t, idx) => (
                          <span
                            key={idx}
                            className="text-[9px] px-1.5 py-0.2 rounded bg-black text-indigo-400 border border-[#222226]"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-[#222226]">
              <span className="text-[11px] text-[#8e8e93]">
                Total Events: {crawlerLogs.length}
              </span>
              <button
                onClick={() => setShowCrawlerConsole(false)}
                className="px-4 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 4: Android APK / Capacitor Guide */}
      {/* ============================================================ */}
      {showCapacitorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-[#0c0c0e] border border-[#222226] p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Smartphone className="h-5 w-5 text-indigo-400" />
                <h3 className="font-bold text-base text-white">Generate Native Android APK</h3>
              </div>
              <button
                onClick={() => setShowCapacitorModal(false)}
                className="text-[#8e8e93] hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="text-xs text-[#d1d1d6] space-y-3 leading-relaxed">
              <div className="p-3 rounded-xl bg-[#141417] border border-[#222226] space-y-1 font-mono text-[11px]">
                <p className="font-bold text-indigo-400 font-sans">Step 1: Install Capacitor</p>
                <p className="bg-black p-2 rounded text-[#a1a1aa]">
                  npm install @capacitor/core @capacitor/cli @capacitor/android
                </p>
              </div>

              <div className="p-3 rounded-xl bg-[#141417] border border-[#222226] space-y-1 font-mono text-[11px]">
                <p className="font-bold text-indigo-400 font-sans">Step 2: Add Android Project</p>
                <p className="bg-black p-2 rounded text-[#a1a1aa]">
                  npx cap init "D-Connect" "com.dconnect.app" --web-dir="dist"
                  <br />
                  npm run build
                  <br />
                  npx cap add android
                </p>
              </div>

              <div className="p-3 rounded-xl bg-[#141417] border border-[#222226] space-y-1 font-mono text-[11px]">
                <p className="font-bold text-indigo-400 font-sans">Step 3: Build APK</p>
                <p className="bg-black p-2 rounded text-[#a1a1aa]">
                  npx cap open android
                </p>
                <p className="font-sans text-[11px] text-[#8e8e93] mt-1">
                  In Android Studio, click <strong>Build &gt; Build Bundle(s) / APK(s) &gt; Build APK(s)</strong>.
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowCapacitorModal(false)}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 cursor-pointer"
              >
                Close Guide
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 5: Create Channel */}
      {/* ============================================================ */}
      {showNewChannelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-[#0c0c0e] border border-[#222226] p-6 shadow-2xl space-y-4">
            <h3 className="font-bold text-base text-white">Create Channel</h3>
            <form onSubmit={handleCreateChannel} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#aeaeb2] mb-1">
                  Channel Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. general"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-[#222226] bg-[#141417] text-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#aeaeb2] mb-1">
                  Description
                </label>
                <input
                  type="text"
                  placeholder="Channel description"
                  value={newChannelDesc}
                  onChange={(e) => setNewChannelDesc(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-[#222226] bg-[#141417] text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewChannelModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[#8e8e93] hover:bg-[#141417] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 cursor-pointer"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Neon Database Status & Vercel Integration Modal */}
      <NeonDbModal
        isOpen={showNeonModal}
        onClose={() => setShowNeonModal(false)}
        onConfigured={(configured) => {
          setNeonConfigured(configured);
          if (configured) {
            loadBootstrapData();
          }
        }}
      />
    </div>
  );
}
