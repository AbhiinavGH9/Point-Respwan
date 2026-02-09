import { create } from 'zustand';
import io, { Socket } from 'socket.io-client';
import { SERVER_URL } from '../services/api';
import api from '../services/api';
import { useAuthStore } from './useAuthStore';

interface Message {
    id?: string;
    text: string;
    senderId: string;
    type: 'text' | 'image' | 'file' | 'contact' | 'image_grid';
    mediaUrl?: string;
    clientId?: string;
    aspectRatio?: number;
    timestamp: string;
    replyTo?: {
        id: string;
        text: string;
        senderName: string;
    };
    isForwarded?: boolean;
}

interface Chat {
    id: string;
    participants: string[];
    otherUser: {
        id: string;
        username: string;
        avatar: string;
        bio?: string;
        email?: string;
        isOnline: boolean;
    };
    lastMessage?: {
        id?: string;
        text: string;
        timestamp: string;
        read: boolean;
        senderId: string;
    };
    unreadCounts?: Record<string, number>;
}

interface ChatState {
    socket: Socket | null;
    chats: Chat[];
    messages: Record<string, Message[]>;
    isConnected: boolean;

    chatSettings: Record<string, { isPinned?: boolean; isArchived?: boolean; isMuted?: boolean }>;
    starredMessages: any[];

    // Selection Mode
    isSelectionMode: boolean;
    selectedMessageIds: string[];
    toggleSelectionMode: (enabled: boolean) => void;
    toggleMessageSelection: (id: string) => void;
    clearSelection: () => void;

    connectSocket: (token: string, userId: string) => void;
    disconnectSocket: () => void;

    fetchChats: () => Promise<void>;
    createChat: (targetUserId: string) => Promise<Chat | null>;

    sendMessage: (chatId: string, text: string, senderId: string, type?: 'text' | 'image' | 'file' | 'contact' | 'image_grid', mediaUrl?: string | string[], otherUserId?: string, replyTo?: any, isForwarded?: boolean, clientId?: string, aspectRatio?: number) => void;
    addMessage: (chatId: string, message: Message) => void;
    clearChat: (chatId: string) => Promise<void>;

    fetchChatSettings: () => Promise<void>;
    toggleChatSetting: (chatId: string, setting: 'isPinned' | 'isArchived' | 'isMuted', value: boolean) => Promise<void>;

    fetchStarredMessages: () => Promise<void>;
    starMessage: (messageId: string, chatId: string, messageData: any) => Promise<void>;

    blockedUsers: string[];
    fetchBlockedUsers: () => Promise<void>;
    blockUser: (userId: string) => Promise<void>;
    unblockUser: (userId: string) => Promise<void>;
    deleteMessageFromStore: (messageId: string) => void;
    markAsRead: (chatId: string) => Promise<void>;

    deletedMessageIds: string[];
    addDeletedMessageId: (id: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
    socket: null,
    chats: [],
    messages: {},
    isConnected: false,
    chatSettings: {},
    starredMessages: [],
    isSelectionMode: false,
    selectedMessageIds: [],
    deletedMessageIds: [],

    toggleSelectionMode: (enabled) => set({ isSelectionMode: enabled, selectedMessageIds: [] }),
    toggleMessageSelection: (id) => set(state => ({
        selectedMessageIds: state.selectedMessageIds.includes(id)
            ? state.selectedMessageIds.filter(m => m !== id)
            : [...state.selectedMessageIds, id]
    })),
    clearSelection: () => set({ selectedMessageIds: [], isSelectionMode: false }),

    connectSocket: (token, userId) => {
        if (get().socket) return;

        const newSocket = io(SERVER_URL, {
            auth: { token },
            transports: ['websocket'],
        });

        newSocket.on('connect', () => {
            console.log('Socket Connected');
            set({ isConnected: true });
            newSocket.emit('join_user_room', userId);
            get().fetchChatSettings(); // Sync settings on connect
            get().fetchChats(); // Sync chats on connect (fetch latest messages)
        });

        newSocket.on('disconnect', () => {
            console.log('Socket Disconnected');
            set({ isConnected: false });
        });

        newSocket.on('chat_updated', ({ chatId, lastMessage }) => {
            const { chats } = get();
            const existingChat = chats.find(c => c.id === chatId);

            if (existingChat) {
                // Optimistic Update: Update lastMessage and move to appropriate position (UI handles sort)
                set({
                    chats: chats.map(c =>
                        c.id === chatId
                            ? { ...c, lastMessage, updatedAt: lastMessage.timestamp }
                            : c
                    )
                });
            } else {
                // If it's a new chat we don't have yet, we must fetch
                get().fetchChats();
            }
        });

        newSocket.on('receive_message', (message: Message & { chatId?: string }) => {
            // handled via fetchChats/local update usually
        });

        newSocket.on('message_deleted', ({ chatId, messageId }) => {
            set((state) => ({
                messages: {
                    ...state.messages,
                    [chatId]: (state.messages[chatId] || []).filter(m => m.id !== messageId)
                }
            }));
            get().fetchChats(); // Refresh last message
        });

        newSocket.on('message_edited', ({ chatId, messageId, newText }) => {
            set((state) => ({
                messages: {
                    ...state.messages,
                    [chatId]: (state.messages[chatId] || []).map(m =>
                        m.id === messageId ? { ...m, text: newText, isEdited: true } : m
                    )
                }
            }));
            get().fetchChats();
        });

        set({ socket: newSocket });
    },

    disconnectSocket: () => {
        get().socket?.disconnect();
        set({ socket: null, isConnected: false });
    },

    fetchChats: async () => {
        try {
            const res = await api.get('/user/chats');
            if (Array.isArray(res.data)) {
                set({ chats: res.data });
            } else {
                // Fallback for legacy structure if any
                const allChats = [...(res.data.private || []), ...(res.data.groups || [])];
                set({ chats: allChats });
            }
        } catch (err) {
            console.error("Fetch chats error", err);
        }
    },

    createChat: async (targetUserId) => {
        try {
            const res = await api.post('/user/chat', { targetUserId });
            await get().fetchChats();
            return res.data;
        } catch (err) {
            console.error("Create chat error", err);
            return null;
        }
    },

    sendMessage: (chatId, text, senderId, type = 'text', mediaUrl, otherUserId, replyTo, isForwarded, clientId, aspectRatio) => {
        const { socket } = get();
        if (socket) {
            socket.emit('send_message', {
                chatId,
                text,
                senderId,
                type,
                mediaUrl,
                otherUserId,
                replyTo,
                isForwarded,
                clientId,
                aspectRatio
            });
        }
    },

    addMessage: (chatId, message) => {
        set((state) => ({
            messages: {
                ...state.messages,
                [chatId]: [...(state.messages[chatId] || []), message]
            }
        }));
    },

    clearChat: async (chatId) => {
        // Optimistic UI Clear
        set((state) => ({
            messages: {
                ...state.messages,
                [chatId]: []
            },
            chats: state.chats.map(c => c.id === chatId ? { ...c, lastMessage: undefined } : c)
        }));

        try {
            await api.delete(`/user/chat/${chatId}/clear`);
        } catch (e) {
            console.error("Clear chat error", e);
            // Could revert here if needed
        }
    },

    // --- Power Features ---

    fetchChatSettings: async () => {
        try {
            const res = await api.get('/user/chat-settings');
            set({ chatSettings: res.data });
        } catch (error) {
            console.error("Fetch settings error", error);
        }
    },

    toggleChatSetting: async (chatId, setting, value) => {
        // Optimistic Update
        set(state => ({
            chatSettings: {
                ...state.chatSettings,
                [chatId]: { ...state.chatSettings[chatId], [setting]: value }
            }
        }));

        try {
            await api.post(`/user/chat/${chatId}/setting`, { setting, value });
        } catch (error) {
            console.error("Toggle setting error", error);
            // Revert on fail? For now relying on fetch to sync later if needed.
        }
    },

    fetchStarredMessages: async () => {
        try {
            const res = await api.get('/user/starred');
            set({ starredMessages: res.data });
        } catch (error) {
            console.error("Fetch starred error", error);
        }
    },

    starMessage: async (messageId, chatId, messageData) => {
        try {
            const res = await api.post(`/user/message/${messageId}/star`, { chatId, messageData });
            // Update local starred list
            if (res.data.starred) {
                set(state => ({
                    starredMessages: [{ id: messageId, chatId, message: messageData, starredAt: new Date().toISOString() }, ...state.starredMessages]
                }));
            } else {
                set(state => ({
                    starredMessages: state.starredMessages.filter(m => m.id !== messageId)
                }));
            }
        } catch (error) {
            console.error("Star message error", error);
        }
    },

    // Blocking
    blockedUsers: [],
    fetchBlockedUsers: async () => {
        try {
            const res = await api.get('/user/blocked');
            set({ blockedUsers: res.data.map((u: any) => u.id) }); // Assuming returns user objects
        } catch (error) {
            console.error("Fetch blocked error", error);
        }
    },
    blockUser: async (userId) => {
        // Optimistic
        set(state => ({ blockedUsers: [...state.blockedUsers, userId] }));
        try {
            await api.post('/user/block', { userId });
        } catch (error) {
            console.error("Block error", error);
        }
    },
    unblockUser: async (userId) => {
        // Optimistic
        set(state => ({ blockedUsers: state.blockedUsers.filter(id => id !== userId) }));
        try {
            await api.post('/user/unblock', { userId });
        } catch (error) {
            console.error("Unblock error", error);
        }
    },

    // Side Effect Helper
    deleteMessageFromStore: (messageId: string) => {
        set(state => ({
            starredMessages: state.starredMessages.filter(m => m.id !== messageId)
        }));
    },

    markAsRead: async (chatId) => {
        const { user } = useAuthStore.getState();
        if (!user) return;

        // Optimistic
        set(state => ({
            chats: state.chats.map(c =>
                c.id === chatId ? { ...c, unreadCounts: { ...c.unreadCounts, [user.id]: 0 } } : c
            )
        }));

        try {
            await api.post(`/user/chat/${chatId}/mark-read`);
        } catch (e) {
            console.error("Mark read error", e);
        }
    },

    addDeletedMessageId: (id) => set(state => ({
        deletedMessageIds: state.deletedMessageIds.includes(id) ? state.deletedMessageIds : [...state.deletedMessageIds, id]
    }))
}));
