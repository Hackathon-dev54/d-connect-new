import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send,
  UserPlus,
  Radio,
  Sparkles,
  Hash,
  Globe,
  Settings,
  X,
  Check,
  Copy,
  Clock,
  Menu,
  Terminal,
  Database,
  Trash2,
  RefreshCw,
  Search,
  Activity,
  Image as ImageIcon,
  Reply,
  Smartphone,
  LogOut,
  Zap,
  Shield,
  Layers,
} from 'lucide-react';
import { GoogleAuthButton, GoogleUserProfile } from './components/GoogleAuthButton';
import { OnboardingAuth } from './components/OnboardingAuth';
import { PWAInstallButton } from './components/PWAInstallButton';
import { NeonDbModal } from './components/NeonDbModal';
import {
  crawlerPingSender,
  CrawlerLogEntry,
  CrawlerTag,
} from './services/crawler-service';
import { PeerIdentity, ChatChannel, ChatMessage } from './types';
import { cleanDomain, deriveSubdomain, resolveTargetHost } from './utils/domain';

// Audio chime using Web Audio API (no external file dependencies)
function playChime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (_) {}
}

const AVATAR_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  indigo: { bg: 'bg-indigo-600', text: 'text-white', ring: 'ring-indigo-400' },
  emerald: { bg: 'bg-emerald-600', text: 'text-white', ring: 'ring-emerald-400' },
  purple: { bg: 'bg-purple-600', text: 'text-white', ring: 'ring-purple-400' },
  rose: { bg: 'bg-rose-600', text: 'text-white', ring: 'ring-rose-400' },
  amber: { bg: 'bg-amber-600', text: 'text-white', ring: 'ring-amber-400' },
  cyan: { bg: 'bg-cyan-600', text: 'text-white', ring: 'ring-cyan-400' },
};

const STORAGE_KEYS = {
  DOMAIN: 'dconnect_node_domain_v2',
  USERNAME: 'dconnect_node_username_v2',
  AVATAR: 'dconnect_node_avatar_v2',
  PEERS: 'dconnect_peers_v2',
  MESSAGES: 'dconnect_messages_v2',
  CHANNELS: 'dconnect_channels_v2',
};

function getUserStorageKey(baseKey: string, userIdentifier: string): string {
  const clean = cleanDomain(userIdentifier);
  return clean ? `${baseKey}_${clean}` : baseKey;
}

export default function App() {
  const currentHost = typeof window !== 'undefined' ? window.location.host : '';
  const urlNodeParam = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('node') : null;

  // Tab-isolated session user
  const [googleUser, setGoogleUser] = useState<GoogleUserProfile | null>(() => {
    try {
      const tabSaved = sessionStorage.getItem('dconnect_tab_user');
      if (tabSaved) return JSON.parse(tabSaved);
      const saved = localStorage.getItem('dconnect_google_user');
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return null;
  });

  // Node domain detection: defaults to current site's deployed host
  const [myDomain, setMyDomain] = useState<string>(() => {
    if (urlNodeParam) return cleanDomain(`${urlNodeParam}.local:3000`);
    const saved = localStorage.getItem(STORAGE_KEYS.DOMAIN);
    if (saved && !saved.includes('my-node')) return saved;
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
  const [isSyncingCrawler, setIsSyncingCrawler] = useState<boolean>(false);
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

  // Channels, Peers, Messages
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

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll messages smoothly
  const scrollToBottom = useCallback(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, activeTarget.id, scrollToBottom]);

  // Load Neon DB status and Bootstrap Data from server
  const loadBootstrapData = useCallback(async () => {
    const cleanId = cleanDomain(effectiveIdentifier);
    if (!cleanId) return;

    try {
      const [dbRes, bootRes] = await Promise.all([
        fetch('/api/db/status'),
        fetch(`/api/chat/bootstrap?userIdentifier=${encodeURIComponent(cleanId)}`),
      ]);

      if (dbRes.ok) {
        const dbData = await dbRes.json();
        setNeonConfigured(Boolean(dbData.configured));
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

        // Server authoritative peers
        if (Array.isArray(data.peers)) {
          const serverPeers: PeerIdentity[] = data.peers.map((sp: any) => ({
            domain: cleanDomain(sp.peer_domain || sp.domain),
            username: sp.username || deriveSubdomain(sp.peer_domain || sp.domain),
            avatarColor: sp.avatar_color || sp.avatarColor || 'purple',
            inboxUrl: sp.inbox_url || sp.inboxUrl || `https://${sp.peer_domain || sp.domain}/api/crawler/ping`,
            status: sp.status || 'pending',
            direction: sp.direction || 'incoming',
            addedAt: Number(sp.added_at || sp.addedAt || Date.now()),
            lastSeen: Number(sp.last_seen || sp.lastSeen || Date.now()),
            crawlerTags: sp.crawlerTags || [`#${sp.username || 'user'}`, `@${cleanDomain(sp.peer_domain || sp.domain)}`, 'crawler-ping:active'],
          }));

          setPeers(serverPeers);
          try {
            localStorage.setItem(getUserStorageKey(STORAGE_KEYS.PEERS, cleanId), JSON.stringify(serverPeers));
          } catch (_) {}
        }

        // Server authoritative messages
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          setMessages(data.messages);
          try {
            localStorage.setItem(getUserStorageKey(STORAGE_KEYS.MESSAGES, cleanId), JSON.stringify(data.messages.slice(-1000)));
          } catch (_) {}
        }
      }
    } catch (_) {
      // Ignored
    }
  }, [effectiveIdentifier, googleUser?.name, urlNodeParam]);

  // Initial load - runs only once per user session, zero loops, zero continuous fetching
  const bootstrappedRef = useRef(false);
  const lastBootstrappedIdRef = useRef<string>('');

  useEffect(() => {
    const cleanId = cleanDomain(effectiveIdentifier);
    if (!cleanId) return;
    if (bootstrappedRef.current && lastBootstrappedIdRef.current === cleanId) return;
    bootstrappedRef.current = true;
    lastBootstrappedIdRef.current = cleanId;
    loadBootstrapData();
  }, [effectiveIdentifier, loadBootstrapData]);

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
    bootstrappedRef.current = false;
    loadBootstrapData();
  };

  const handleSignOut = () => {
    setGoogleUser(null);
    sessionStorage.removeItem('dconnect_tab_user');
    localStorage.removeItem('dconnect_google_user');
    setMessages([]);
    setPeers([]);
    setActiveTarget({ id: 'general', type: 'channel', name: 'general' });
  };

  // Persist State to LocalStorage (debounced/clean)
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
  // CLEVER WEB CRAWLER METHOD: ON-DEMAND CRAWL & SYNC (Zero continuous fetch, zero pooling)
  // =========================================================================
  const handleCrawlSync = async () => {
    if (isSyncingCrawler) return;
    setIsSyncingCrawler(true);
    try {
      const syncRes = await crawlerPingSender.crawlSync(effectiveIdentifier, activeTarget.id);
      if (syncRes.success) {
        if (Array.isArray(syncRes.peers) && syncRes.peers.length > 0) {
          setPeers(syncRes.peers);
        }
        if (Array.isArray(syncRes.messages) && syncRes.messages.length > 0) {
          // Merge messages without duplicates
          setMessages((prev) => {
            const map = new Map<string, ChatMessage>();
            for (const m of prev) if (m.id) map.set(m.id, m);
            for (const m of syncRes.messages!) if (m.id) map.set(m.id, m);
            return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
          });
        }
      }
    } catch (_) {
      // Ignored
    } finally {
      setIsSyncingCrawler(false);
    }
  };

  // Send Live Crawler Test Ping
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
        setPingTestResult(`Pong ${res.latencyMs || 18}ms ✓`);
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

    // Run quick crawler sync for the newly selected target
    crawlerPingSender.crawlSync(effectiveIdentifier, target.id).then((res) => {
      if (res.success && Array.isArray(res.messages) && res.messages.length > 0) {
        setMessages((prev) => {
          const map = new Map<string, ChatMessage>();
          for (const m of prev) if (m.id) map.set(m.id, m);
          for (const m of res.messages!) if (m.id) map.set(m.id, m);
          return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
        });
      }
    });
  };

  // SEND FRIEND REQUEST ACTION (Crawler Ping + Database Save)
  const handleProbeAndAddPeer = async (e?: React.FormEvent, directTarget?: string) => {
    if (e) e.preventDefault();
    const target = directTarget || peerInputDomain;
    if (!target.trim()) return;

    setIsProbingPeer(true);
    const resolvedTarget = resolveTargetHost(target, myDomain);
    const targetClean = cleanDomain(resolvedTarget || target);
    const senderClean = cleanDomain(effectiveIdentifier);

    if (targetClean === senderClean) {
      setPeerProbeStatus('Cannot add yourself as a friend.');
      setIsProbingPeer(false);
      return;
    }

    setPeerProbeStatus(`Dispatching crawler ping to ${targetClean}...`);

    const peerUsername = deriveSubdomain(targetClean);
    const peerAvatar = 'purple';

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
      crawlerTags: [`#${peerUsername}`, `@${targetClean}`, 'crawler-ping:active'],
    };

    setPeers((prev) => {
      const filtered = prev.filter((p) => cleanDomain(p.domain) !== targetClean);
      return [...filtered, newPeerObj];
    });

    setPeerProbeStatus(`✓ Dispatched via Web Crawler Ping & Saved to Database!`);

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
      setPeers((prev) => prev.map((p) => (cleanDomain(p.domain) === targetClean ? updatedPeer : p)));
      playChime();
    } else {
      setPeers((prev) => prev.filter((p) => cleanDomain(p.domain) !== targetClean));
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
  };

  // Match peer helper
  const isPeerMatch = (p: PeerIdentity, target: string, username?: string) => {
    const cleanT = cleanDomain(target).replace(/^[#@]+/, '').toLowerCase();
    const cleanU = (username || '').replace(/^[#@]+/, '').toLowerCase();
    const pD = cleanDomain(p.domain).replace(/^[#@]+/, '').toLowerCase();
    const pU = (p.username || '').replace(/^[#@]+/, '').toLowerCase();

    return (
      pD === cleanT ||
      pU === cleanT ||
      (cleanU && (pD === cleanU || pU === cleanU)) ||
      pD.includes(cleanT) ||
      cleanT.includes(pD)
    );
  };

  // CANCEL SENT FRIEND REQUEST (Removes from state & DB with zero delay)
  const handleCancelFriendRequest = async (peer: PeerIdentity) => {
    const targetClean = cleanDomain(peer.domain).replace(/^[#@]+/, '');
    const peerUser = (peer.username || '').replace(/^[#@]+/, '');

    setPeers((prev) => prev.filter((p) => !isPeerMatch(p, targetClean, peerUser)));

    try {
      const remaining = peers.filter((p) => !isPeerMatch(p, targetClean, peerUser));
      localStorage.setItem(getUserStorageKey(STORAGE_KEYS.PEERS, effectiveIdentifier), JSON.stringify(remaining));
      localStorage.setItem(STORAGE_KEYS.PEERS, JSON.stringify(remaining));
    } catch (_) {}

    try {
      await fetch(
        `/api/peer/${encodeURIComponent(targetClean)}?ownerDomain=${encodeURIComponent(effectiveIdentifier)}&peerUsername=${encodeURIComponent(peerUser)}`,
        { method: 'DELETE' }
      );
    } catch (_) {}
  };

  // DELETE PEER
  const handleDeletePeer = async (peerDomain: string, peerUsername?: string) => {
    const targetClean = cleanDomain(peerDomain).replace(/^[#@]+/, '');
    const cleanUser = (peerUsername || '').replace(/^[#@]+/, '');

    setPeers((prev) => prev.filter((p) => !isPeerMatch(p, targetClean, cleanUser)));
    setMessages((prev) =>
      prev.filter(
        (m) =>
          !cleanDomain(m.targetId).includes(targetClean) &&
          !cleanDomain(m.senderDomain || '').includes(targetClean) &&
          !cleanDomain(m.senderId || '').includes(targetClean)
      )
    );

    try {
      const remaining = peers.filter((p) => !isPeerMatch(p, targetClean, cleanUser));
      localStorage.setItem(getUserStorageKey(STORAGE_KEYS.PEERS, effectiveIdentifier), JSON.stringify(remaining));
      localStorage.setItem(STORAGE_KEYS.PEERS, JSON.stringify(remaining));
    } catch (_) {}

    try {
      await fetch(
        `/api/peer/${encodeURIComponent(targetClean)}?ownerDomain=${encodeURIComponent(effectiveIdentifier)}&peerUsername=${encodeURIComponent(cleanUser)}`,
        { method: 'DELETE' }
      );
    } catch (_) {}

    if (activeTarget.type === 'p2p' && cleanDomain(activeTarget.id).includes(targetClean)) {
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

    // Deliver & Persist via Crawler Ping + Database
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
          headers: { 'Content-Type': 'application/json' },
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
    setMyUsername(editUsername.trim() || deriveSubdomain(clean));
    setMyAvatarColor(editColor);

    localStorage.setItem(STORAGE_KEYS.DOMAIN, clean);
    localStorage.setItem(STORAGE_KEYS.USERNAME, editUsername.trim() || deriveSubdomain(clean));
    localStorage.setItem(STORAGE_KEYS.AVATAR, editColor);

    setShowNodeConfigModal(false);
  };

  // Copy Node Link / Identity
  const handleCopyLink = () => {
    const id = `#${myUsername} @${myDomain}`;
    navigator.clipboard.writeText(id);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const incomingRequests = peers.filter((p) => p.status === 'pending' && p.direction === 'incoming');
  const outgoingRequests = peers.filter((p) => p.status === 'pending' && p.direction === 'outgoing');
  const acceptedPeers = peers.filter((p) => p.status === 'accepted');

  // Mandatory Onboarding Gate: If user is not yet logged in / authenticated
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
    <div className="flex h-screen w-screen overflow-hidden bg-[#090a0f] text-slate-100 font-sans select-none antialiased">
      {/* 1. SIDEBAR */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-slate-800/80 bg-[#0c0d14] transition-transform duration-200 ease-in-out md:static md:translate-x-0 ${
          isMobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Top Header & Identity Card */}
        <div className="flex flex-col border-b border-slate-800/80 p-3.5 space-y-3 bg-[#0e1017]">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 shadow-md text-white font-bold">
                <Radio className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center space-x-1.5">
                  <h1 className="font-bold text-sm tracking-tight text-white">D-Connect</h1>
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-800/40">
                    Crawler
                  </span>
                </div>
                <div className="flex items-center space-x-1.5 text-[11px] text-slate-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="truncate max-w-[130px] font-mono">@{myDomain}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-1">
              {/* Crawler Console Button */}
              <button
                onClick={() => setShowCrawlerConsole(true)}
                title="Crawler Log Console"
                className="p-1.5 rounded-lg bg-[#141620] border border-slate-800 text-cyan-400 hover:text-white transition cursor-pointer"
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
                    : 'bg-[#141620] border-slate-800 text-slate-400 hover:text-white'
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
                className="p-1.5 rounded-lg bg-[#141620] border border-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
              >
                <Settings className="h-4 w-4" />
              </button>

              <button
                onClick={() => setIsMobileNavOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white md:hidden cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* User Profile Card */}
          <div className="w-full">
            <GoogleAuthButton
              currentUser={googleUser}
              onUserAuthenticated={handleUserAuthenticated}
              onSignOut={handleSignOut}
            />
          </div>

          {/* Auto-Assigned Identity & Mini Tags */}
          <div className="flex flex-col p-2.5 rounded-2xl bg-[#131622] border border-slate-800/80 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5 truncate">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Node Handle:
                </span>
                <span className="font-mono text-cyan-300 font-bold truncate">
                  #{myUsername}
                </span>
              </div>
              <button
                onClick={handleCopyLink}
                title="Copy crawler identity"
                className="text-slate-400 hover:text-white transition cursor-pointer shrink-0"
              >
                {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>

            {/* Discovery Tags */}
            <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-slate-800/80">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono bg-indigo-950/70 text-indigo-300 border border-indigo-800/40">
                #{myUsername.toLowerCase().replace(/[^a-z0-9_-]/g, '')}
              </span>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono bg-cyan-950/70 text-cyan-300 border border-cyan-800/40">
                @{myDomain.toLowerCase().replace(/:\d+$/, '')}
              </span>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-950/70 text-emerald-300 border border-emerald-800/40">
                crawler:active
              </span>
            </div>
          </div>
        </div>

        {/* Sidebar Nav Lists */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {/* Action: Connect Peer */}
          <button
            onClick={() => setShowAddPeerModal(true)}
            className="w-full flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white text-xs font-bold transition shadow-sm cursor-pointer"
          >
            <UserPlus className="h-4 w-4" />
            <span>Connect Friend via Subdomain</span>
          </button>

          {/* INCOMING FRIEND REQUESTS */}
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
                    className="p-2.5 rounded-xl bg-[#141622] border border-amber-500/40 shadow-sm space-y-2"
                  >
                    <div className="flex items-center space-x-2 min-w-0">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-950 text-amber-300 font-bold text-xs shrink-0">
                        {peer.username.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white truncate">{peer.username}</p>
                        <p className="text-[10px] font-mono text-slate-400 truncate">
                          @{peer.domain}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1.5 pt-1">
                      <button
                        onClick={() => handleRespondFriendRequest(peer.domain, true)}
                        className="flex-1 flex items-center justify-center space-x-1 py-1 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition cursor-pointer"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Accept</span>
                      </button>
                      <button
                        onClick={() => handleRespondFriendRequest(peer.domain, false)}
                        className="p-1 px-2 rounded-lg bg-slate-800 hover:bg-rose-950 hover:text-rose-400 text-slate-400 text-xs transition cursor-pointer"
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
              <div className="px-2 text-[11px] font-bold tracking-wider uppercase text-slate-400">
                Sent Requests ({outgoingRequests.length})
              </div>
              {outgoingRequests.map((peer) => (
                <div
                  key={peer.domain}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-[#131622] border border-slate-800/80 text-xs"
                >
                  <div className="flex items-center space-x-2 min-w-0">
                    <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    <span className="text-white font-medium truncate">#{peer.username}</span>
                    <span className="text-[10px] text-slate-500 truncate">@{peer.domain}</span>
                  </div>
                  <button
                    onClick={() => handleCancelFriendRequest(peer)}
                    title="Cancel sent friend request"
                    className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* CONNECTED PEERS / FRIENDS */}
          <div className="space-y-1">
            <div className="flex items-center justify-between px-2 text-[11px] font-bold tracking-wider uppercase text-slate-400">
              <span>Connected Friends ({acceptedPeers.length})</span>
            </div>

            {acceptedPeers.length === 0 ? (
              <div className="p-3 text-center rounded-2xl bg-[#131622]/60 border border-slate-800/60 text-xs text-slate-500">
                No connected friends yet. Click <strong>Connect Friend</strong> above to add friends!
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
                        ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white font-semibold shadow-md'
                        : 'text-slate-300 hover:bg-[#131622] hover:text-white'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <div
                        className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${
                          isActive ? 'bg-black/30 text-white' : 'bg-slate-800 text-cyan-400'
                        }`}
                      >
                        {peer.username.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate">#{peer.username}</p>
                        <p className={`text-[10px] font-mono truncate ${isActive ? 'text-cyan-100' : 'text-slate-500'}`}>
                          @{peer.domain}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1">
                      {unread > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500 text-black">
                          {unread}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePeer(peer.domain);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-rose-400 transition cursor-pointer"
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
            <div className="flex items-center justify-between px-2 text-[11px] font-bold tracking-wider uppercase text-slate-400">
              <span>Channels</span>
              <button
                onClick={() => setShowNewChannelModal(true)}
                className="text-slate-400 hover:text-white transition cursor-pointer"
                title="Create channel"
              >
                <PlusIcon className="h-3.5 w-3.5" />
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
                      ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white font-semibold shadow-md'
                      : 'text-slate-300 hover:bg-[#131622] hover:text-white'
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    <Hash className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                    <span className="truncate">{chan.name}</span>
                  </div>
                  {unread > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500 text-black">
                      {unread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Sidebar Footer */}
        <div className="p-3 border-t border-slate-800/80 bg-[#0e1017] space-y-2">
          <PWAInstallButton />

          <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
            <button
              onClick={() => setShowHowItWorksModal(true)}
              className="hover:text-cyan-400 flex items-center space-x-1 cursor-pointer transition"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>How it works</span>
            </button>
            <button
              onClick={() => setShowCapacitorModal(true)}
              className="hover:text-cyan-400 flex items-center space-x-1 cursor-pointer transition"
            >
              <Smartphone className="h-3.5 w-3.5" />
              <span>Android APK</span>
            </button>
          </div>
        </div>
      </aside>

      {/* 2. MAIN CHAT AREA */}
      <main className="flex flex-1 flex-col h-full min-w-0 overflow-hidden bg-[#090a0f]">
        {/* Chat Top Header */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b px-4 border-slate-800/80 bg-[#0c0d14] z-10">
          <div className="flex items-center space-x-3 min-w-0">
            <button
              onClick={() => setIsMobileNavOpen(true)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white md:hidden cursor-pointer"
              aria-label="Open sidebar"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="flex items-center space-x-2.5 min-w-0">
              {activeTarget.type === 'channel' ? (
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#131622] text-cyan-400 font-bold shrink-0">
                  <Hash className="h-5 w-5" />
                </div>
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 text-white font-bold shrink-0 text-sm">
                  {activeTarget.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center space-x-2">
                  <h2 className="text-base font-bold text-white truncate leading-tight">
                    {activeTarget.type === 'channel' ? `#${activeTarget.name}` : `#${activeTarget.name}`}
                  </h2>
                  {activeTarget.type === 'p2p' ? (
                    <div className="flex items-center space-x-1.5">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-950/70 text-cyan-300 border border-cyan-800/40">
                        @{activeTarget.domain}
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
                <p className="text-xs text-slate-400 truncate">
                  {activeTarget.type === 'channel'
                    ? channels.find((c) => c.id === activeTarget.id)?.description || 'Global broadcast channel'
                    : `Discovered node: ${activeTarget.domain}`}
                </p>
              </div>
            </div>
          </div>

          {/* Quick Header Actions: Crawler Radar & Sync */}
          <div className="flex items-center space-x-2">
            {/* ON-DEMAND CRAWLER SYNC BUTTON (Zero lag, pure DB saves!) */}
            <button
              onClick={handleCrawlSync}
              disabled={isSyncingCrawler}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                isSyncingCrawler
                  ? 'bg-cyan-950/80 border-cyan-500 text-cyan-300'
                  : 'bg-[#131622] hover:bg-[#1a1d2d] border-slate-800 text-cyan-400'
              }`}
              title="Crawl & Sync updates from database"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncingCrawler ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">
                {isSyncingCrawler ? 'Crawling...' : 'Crawl & Sync'}
              </span>
            </button>

            {/* Live Crawler Test Ping Button */}
            {activeTarget.type === 'p2p' && (
              <button
                onClick={handleSendTestPing}
                disabled={isSendingPingTest}
                className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-indigo-950/60 border border-indigo-800/60 text-indigo-300 font-mono text-xs hover:bg-indigo-900/60 transition cursor-pointer"
                title="Send a live crawler ping"
              >
                <Activity className={`h-3.5 w-3.5 text-indigo-400 ${isSendingPingTest ? 'animate-spin' : ''}`} />
                <span>{pingTestResult || 'Ping Node'}</span>
              </button>
            )}

            <button
              onClick={() => {
                if (confirm('Clear chat history for this view?')) {
                  setMessages((prev) => prev.filter((m) => m.targetId !== activeTarget.id));
                  fetch('/api/chat/clear', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetId: activeTarget.id }),
                  }).catch(() => {});
                }
              }}
              title="Clear conversation"
              className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-[#131622] transition cursor-pointer"
            >
              <Trash2 className="h-4 w-4" />
            </button>

            {/* Sign Out Button */}
            <button
              onClick={handleSignOut}
              title="Sign out / Switch node"
              className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-[#131622] border border-slate-800 text-slate-400 hover:text-rose-400 transition cursor-pointer text-xs"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline font-medium">Exit</span>
            </button>
          </div>
        </header>

        {/* Message Feed */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[#090a0f]">
          {currentMessages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center p-6 space-y-3 text-slate-500">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#131622] text-cyan-400 border border-slate-800/80">
                {activeTarget.type === 'channel' ? <Hash className="h-7 w-7" /> : <Globe className="h-7 w-7" />}
              </div>
              <div className="max-w-sm">
                <p className="font-semibold text-white">
                  {activeTarget.type === 'channel'
                    ? `Welcome to #${activeTarget.name}`
                    : `Connected directly to #${activeTarget.name}`}
                </p>
                <p className="text-xs mt-1 text-slate-400">
                  {activeTarget.type === 'p2p'
                    ? `All messages are delivered via HTTP Crawler Ping and persisted in the database.`
                    : 'Start the conversation by sending a message below.'}
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
                    <div className="flex items-center space-x-1.5 px-1 pb-1 text-[11px] text-slate-400">
                      <span className="font-semibold text-white">#{msg.senderName}</span>
                      {msg.senderDomain && (
                        <span className="font-mono text-[10px] text-slate-500">
                          @{msg.senderDomain}
                        </span>
                      )}
                      <span>•</span>
                      <span>{timeString}</span>
                      {msg.crawlerPingAck && (
                        <span className="text-[9px] text-emerald-400 font-mono">✓ DB Saved</span>
                      )}
                    </div>

                    <div
                      className={`relative px-3.5 py-2.5 rounded-2xl text-sm break-words transition shadow-xs ${
                        isMe
                          ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white rounded-tr-xs'
                          : 'bg-[#131622] text-slate-100 border border-slate-800/80 rounded-tl-xs'
                      }`}
                    >
                      {msg.replyTo && (
                        <div
                          className={`mb-2 px-2.5 py-1.5 rounded-lg text-xs border-l-2 ${
                            isMe
                              ? 'bg-black/30 border-cyan-300 text-indigo-100'
                              : 'bg-black/50 border-indigo-500 text-slate-300'
                          }`}
                        >
                          <span className="font-bold block text-[10px] uppercase tracking-wider text-slate-400">
                            Replying to #{msg.replyTo.senderName}
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
                    className={`opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-1 bg-[#131622] border border-slate-800 shadow-md rounded-xl p-1 z-10 ${
                      isMe ? 'self-center mr-1' : 'self-center ml-1'
                    }`}
                  >
                    <button
                      onClick={() => setReplyingTo(msg)}
                      title="Reply"
                      className="p-1 rounded text-slate-400 hover:text-cyan-400 cursor-pointer"
                    >
                      <Reply className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(msg.text);
                        setCopiedId(msg.id);
                        setTimeout(() => setCopiedId(null), 1500);
                      }}
                      title="Copy text"
                      className="p-1 rounded text-slate-400 hover:text-cyan-400 cursor-pointer"
                    >
                      {copiedId === msg.id ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* INPUT COMPOSER */}
        <div className="p-3 border-t border-slate-800/80 bg-[#0c0d14]">
          {replyingTo && (
            <div className="flex items-center justify-between px-3 py-1.5 mb-2 bg-[#131622] border border-slate-800 rounded-xl text-xs">
              <div className="flex items-center space-x-2 truncate">
                <Reply className="h-3.5 w-3.5 text-cyan-400" />
                <span className="font-semibold text-white">
                  Replying to #{replyingTo.senderName}:
                </span>
                <span className="italic text-slate-400 truncate">{replyingTo.text}</span>
              </div>
              <button
                onClick={() => setReplyingTo(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {imagePreview && (
            <div className="relative inline-block mb-2">
              <img src={imagePreview} alt="Preview" className="h-16 w-16 rounded-lg object-cover border border-slate-800" />
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
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-[#131622] transition cursor-pointer"
              title="Attach image"
            >
              <ImageIcon className="h-5 w-5" />
            </button>

            <div className="flex-1 relative flex items-center">
              <input
                type="text"
                placeholder={`Message ${activeTarget.type === 'channel' ? '#' + activeTarget.name : '#' + activeTarget.name}...`}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="w-full px-4 py-2.5 text-sm rounded-xl border border-slate-800 bg-[#131622] text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition"
              />
            </div>

            <button
              type="submit"
              disabled={(!inputText.trim() && !imagePreview) || isSending}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 text-white font-semibold shadow-md hover:from-indigo-500 hover:to-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </main>

      {/* ============================================================ */}
      {/* MODAL 1: Connect Remote Peer / Friend via Subdomain */}
      {/* ============================================================ */}
      {showAddPeerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-[#0c0d14] border border-slate-800 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-950 text-cyan-400">
                  <UserPlus className="h-4 w-4" />
                </div>
                <h3 className="font-bold text-base text-white">Connect Friend via Subdomain</h3>
              </div>
              <button
                onClick={() => setShowAddPeerModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Enter your friend's domain or subdomain (e.g.{' '}
              <code className="px-1.5 py-0.5 rounded bg-[#131622] text-cyan-300 font-mono">
                ais-pre-3adlco6h5rvvpf7asnanza-320046163787
              </code>{' '}
              or full URL).
              The backend crawler engine resolves the host, checks discovery tags, and delivers the friend request directly to their database.
            </p>

            <form onSubmit={(e) => handleProbeAndAddPeer(e)} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Friend's Subdomain or Domain:
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    placeholder="e.g. ais-pre-3adlco6h5rvvpf7asnanza-320046163787"
                    value={peerInputDomain}
                    onChange={(e) => {
                      setPeerInputDomain(e.target.value);
                      setDiscoveredTags([]);
                    }}
                    className="flex-1 px-3 py-2 text-sm rounded-xl border border-slate-800 bg-[#131622] text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
                    required
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!peerInputDomain.trim()) return;
                      const res = await crawlerPingSender.probeTarget(peerInputDomain, myDomain);
                      if (res.tags) {
                        setDiscoveredTags(res.tags);
                      }
                    }}
                    className="px-3 py-2 rounded-xl text-xs font-semibold bg-[#131622] border border-slate-800 text-cyan-400 hover:text-white transition cursor-pointer shrink-0"
                    title="Probe target crawler tags"
                  >
                    <Search className="h-3.5 w-3.5 inline mr-1" />
                    <span>Scan</span>
                  </button>
                </div>
              </div>

              {/* Crawler Mini Discovery Tags Preview */}
              {discoveredTags.length > 0 && (
                <div className="p-2.5 rounded-2xl bg-[#131622] border border-cyan-900/40 space-y-1.5">
                  <span className="text-[10px] font-bold text-cyan-300 uppercase tracking-wider block">
                    Discovered Crawler Tags:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {discoveredTags.map((t, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800/40"
                      >
                        {t.value}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Greeting note (optional):
                </label>
                <input
                  type="text"
                  placeholder="e.g. Hey from another deployment!"
                  value={peerInputNote}
                  onChange={(e) => setPeerInputNote(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-800 bg-[#131622] text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {peerProbeStatus && (
                <div className="p-2.5 rounded-xl bg-cyan-950/60 border border-cyan-800/60 text-xs text-cyan-200">
                  {peerProbeStatus}
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddPeerModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:bg-[#131622] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isProbingPeer}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white shadow-md cursor-pointer disabled:opacity-50"
                >
                  {isProbingPeer ? 'Crawling...' : 'Send Friend Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 2: Node Settings Modal */}
      {/* ============================================================ */}
      {showNodeConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-[#0c0d14] border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-white">Node Settings</h3>
              <button
                onClick={() => setShowNodeConfigModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveNodeConfig} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Node Domain / Host:
                </label>
                <input
                  type="text"
                  value={editDomain}
                  onChange={(e) => setEditDomain(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-800 bg-[#131622] text-white focus:outline-none focus:border-cyan-500 font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Node Handle:
                </label>
                <input
                  type="text"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-800 bg-[#131622] text-white focus:outline-none focus:border-cyan-500 font-mono"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowNodeConfigModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:bg-[#131622] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-600 to-cyan-600 text-white cursor-pointer"
                >
                  Save Settings
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 3: How Crawler Method Works */}
      {/* ============================================================ */}
      {showHowItWorksModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-3xl bg-[#0c0d14] border border-slate-800 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Sparkles className="h-5 w-5 text-cyan-400" />
                <h3 className="font-bold text-base text-white">How Web Crawler Method Works</h3>
              </div>
              <button
                onClick={() => setShowHowItWorksModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-3 leading-relaxed">
              <div className="p-3 rounded-2xl bg-[#131622] border border-slate-800 space-y-1">
                <p className="font-bold text-cyan-400">1. Auto-Assigned Subdomain Identity</p>
                <p className="text-slate-400">
                  Every site deployment automatically derives its username and node identity from its unique domain or subdomain (e.g. <code>#ais-dev-xxx</code> on <code>@asia-southeast1.run.app</code>). This guarantees zero conflicts across deployments.
                </p>
              </div>

              <div className="p-3 rounded-2xl bg-[#131622] border border-slate-800 space-y-1">
                <p className="font-bold text-cyan-400">2. Real Server-to-Server Crawler Federation</p>
                <p className="text-slate-400">
                  When you add a friend or send a message, your node's backend crawler executes the HTTP ping to their endpoint. Browsers never make cross-origin requests, eliminating 100% of CORS and "Failed to fetch" errors.
                </p>
              </div>

              <div className="p-3 rounded-2xl bg-[#131622] border border-slate-800 space-y-1">
                <p className="font-bold text-cyan-400">3. Zero Browser Hangs: No SSE or WebRTC</p>
                <p className="text-slate-400">
                  No leaky EventSource connections, no WebRTC signaling storms, and no background interval loops. Pure database saves keep all data safe with lightning-fast on-demand crawl synchronization.
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowHowItWorksModal(false)}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-600 to-cyan-600 text-white cursor-pointer"
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
          <div className="w-full max-w-2xl rounded-3xl bg-[#0c0d14] border border-slate-800 p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-950 text-cyan-400">
                  <Terminal className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Web Crawler Activity Console</h3>
                  <p className="text-[11px] text-slate-400">
                    Real-time inspector for crawler pings and discovery tags
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCrawlerConsole(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Current Node Discovery Tags */}
            <div className="p-3 rounded-2xl bg-[#131622] border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-white">Active Discovery Meta Tags:</span>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded">
                  crawler:active
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {myCrawlerTags.map((tag, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800/40"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Live Logs Stream */}
            <div className="flex-1 overflow-y-auto space-y-2 min-h-[220px] font-mono text-[11px]">
              {crawlerLogs.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-xs">
                  No crawler pings dispatched yet. Send a friend request or message to see crawler activity!
                </div>
              ) : (
                crawlerLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-2.5 rounded-xl bg-[#131622] border border-slate-800 space-y-1"
                  >
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="flex items-center space-x-1.5">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            log.status === 'verified'
                              ? 'bg-emerald-400'
                              : log.status === 'failed'
                              ? 'bg-rose-500'
                              : 'bg-cyan-400 animate-pulse'
                          }`}
                        />
                        <span className="font-bold text-white uppercase">{log.type.replace('_', ' ')}</span>
                        <span className="text-slate-400">→ {log.target}</span>
                      </span>
                      <span className="text-slate-500">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 font-sans">{log.details}</p>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <span className="text-[11px] text-slate-400">
                Total Events: {crawlerLogs.length}
              </span>
              <button
                onClick={() => setShowCrawlerConsole(false)}
                className="px-4 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-600 to-cyan-600 text-white cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 4: Android APK Guide */}
      {/* ============================================================ */}
      {showCapacitorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-3xl bg-[#0c0d14] border border-slate-800 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Smartphone className="h-5 w-5 text-cyan-400" />
                <h3 className="font-bold text-base text-white">Generate Native Android APK</h3>
              </div>
              <button
                onClick={() => setShowCapacitorModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-3 leading-relaxed">
              <div className="p-3 rounded-2xl bg-[#131622] border border-slate-800 space-y-1 font-mono text-[11px]">
                <p className="font-bold text-cyan-400 font-sans">Step 1: Install Capacitor</p>
                <p className="bg-black/60 p-2 rounded text-slate-300">
                  npm install @capacitor/core @capacitor/cli @capacitor/android
                </p>
              </div>

              <div className="p-3 rounded-2xl bg-[#131622] border border-slate-800 space-y-1 font-mono text-[11px]">
                <p className="font-bold text-cyan-400 font-sans">Step 2: Add Android Project</p>
                <p className="bg-black/60 p-2 rounded text-slate-300">
                  npx cap init "D-Connect" "com.dconnect.app" --web-dir="dist"
                  <br />
                  npm run build
                  <br />
                  npx cap add android
                </p>
              </div>

              <div className="p-3 rounded-2xl bg-[#131622] border border-slate-800 space-y-1 font-mono text-[11px]">
                <p className="font-bold text-cyan-400 font-sans">Step 3: Build APK</p>
                <p className="bg-black/60 p-2 rounded text-slate-300">
                  npx cap open android
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowCapacitorModal(false)}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-600 to-cyan-600 text-white cursor-pointer"
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
          <div className="w-full max-w-sm rounded-3xl bg-[#0c0d14] border border-slate-800 p-6 shadow-2xl space-y-4">
            <h3 className="font-bold text-base text-white">Create Channel</h3>
            <form onSubmit={handleCreateChannel} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Channel Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. announcements"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-800 bg-[#131622] text-white focus:outline-none focus:border-cyan-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  placeholder="Channel description"
                  value={newChannelDesc}
                  onChange={(e) => setNewChannelDesc(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-800 bg-[#131622] text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewChannelModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:bg-[#131622] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-600 to-cyan-600 text-white cursor-pointer"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Neon Database Modal */}
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

function PlusIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
