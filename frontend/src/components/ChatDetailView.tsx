import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Image, ActivityIndicator, Alert, Modal, Animated, Keyboard, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useChatStore } from '../stores/useChatStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useThemeColors } from '../stores/useThemeStore';
import { Colors } from '../constants/Colors';
import { ChevronLeft, Info, ChevronDown, Reply, Copy, Trash2, Forward, CornerDownRight, X, RotateCcw, Star, MoreVertical, Send, Image as ImageIcon, Smile, Mic } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import api, { SERVER_URL } from '../services/api';
import ForwardModal from './ForwardModal';
import ConfirmationModal from './ConfirmationModal';
import EmojiPicker from './EmojiPicker';
import ReactionPill from './ReactionPill';
import MessageBubble from './MessageBubble';
import MessageMenu from './MessageMenu';
import ProfileModal from './ProfileModal';
import { PlusIcon, CameraIcon, StickerIcon } from './icons/ChatInputIcons';
import EditMessageModal from './EditMessageModal';
import FileSharingModal from './FileSharingModal';
import AlternativeFeatureModal from './AlternativeFeatureModal';
import ImagePreviewModal from './ImagePreviewModal';
import ImageViewerModal from './ImageViewerModal';

interface ChatDetailViewProps {
    chatId: string;
    otherUser: {
        id: string;
        username: string;
        avatar?: string;
        isOnline?: boolean;
    };
    onBack?: () => void;
    isMobile?: boolean;
    highlightMessageId?: string; // New Prop
}

export default function ChatDetailView({ chatId, otherUser, onBack, isMobile = true, highlightMessageId }: ChatDetailViewProps) {
    const colors = useThemeColors();
    const { user } = useAuthStore();
    const {
        sendMessage, socket, fetchChats, clearChat, blockedUsers, markAsRead,
        isSelectionMode, selectedMessageIds, toggleSelectionMode, toggleMessageSelection, clearSelection,
        deletedMessageIds, addDeletedMessageId
    } = useChatStore();
    const navigation = useNavigation<any>();
    const dimensions = useWindowDimensions();

    const isBlocked = blockedUsers?.includes(otherUser.id);

    const [inputText, setInputText] = useState('');
    const [localMessages, setLocalMessages] = useState<any[]>([]);
    const [uploading, setUploading] = useState(false);
    const [loading, setLoading] = useState(false);
    const [showScrollButton, setShowScrollButton] = useState(false);

    // New Feature States
    const [replyingTo, setReplyingTo] = useState<any>(null);
    const [forwardModalVisible, setForwardModalVisible] = useState(false);
    const [profileModalVisible, setProfileModalVisible] = useState(false);
    const [messageToForward, setMessageToForward] = useState<any>(null);
    const cameraIconRef = useRef<any>(null);
    const [fileSharingPosition, setFileSharingPosition] = useState<any>(null);
    const [previewImages, setPreviewImages] = useState<any[]>([]); // New state for input preview

    // Confirmation Modal
    const [confirmVisible, setConfirmVisible] = useState(false);
    const [msgToDeleteId, setMsgToDeleteId] = useState<string | null>(null);

    // Active Menu
    const [activeMenu, setActiveMenu] = useState<{ id: string, y: number, isMe: boolean } | null>(null);

    const flatListRef = useRef<FlatList>(null);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false); // Emoji Picker State
    const [emojiPickerMode, setEmojiPickerMode] = useState<'input' | 'reaction'>('input');

    // New Features States
    const [fileSharingVisible, setFileSharingVisible] = useState(false);
    const [altFeatureVisible, setAltFeatureVisible] = useState(false);
    const [editModalVisible, setEditModalVisible] = useState(false);
    const [editingMessage, setEditingMessage] = useState<any>(null);
    const [pickedImages, setPickedImages] = useState<any[]>([]);
    const [imagePreviewVisible, setImagePreviewVisible] = useState(false);
    const [viewerIndex, setViewerIndex] = useState<number>(-1);

    // Reaction Menu State
    const [reactionMenu, setReactionMenu] = useState<{ id: string, top: number, align: 'left' | 'right' } | null>(null);

    // Star Animation State
    const [starAnimVisible, setStarAnimVisible] = useState(false);
    const starScale = useRef(new Animated.Value(0)).current;

    const inputRef = useRef<TextInput>(null);

    useEffect(() => {
        if (starAnimVisible) {
            Animated.spring(starScale, {
                toValue: 1,
                friction: 5,
                useNativeDriver: true
            }).start(() => {
                setTimeout(() => {
                    Animated.timing(starScale, {
                        toValue: 0,
                        duration: 200,
                        useNativeDriver: true
                    }).start(() => setStarAnimVisible(false));
                }, 800);
            });
        }
    }, [starAnimVisible]);

    // Scroll to Highlight
    useEffect(() => {
        if (highlightMessageId && localMessages.length > 0) {
            // Simple approach: Find index and scroll
            const index = localMessages.findIndex(m => m.id === highlightMessageId);
            if (index !== -1 && flatListRef.current) {
                setTimeout(() => {
                    flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
                }, 500);
            }
        }
    }, [highlightMessageId, localMessages]);


    // ... (Handlers)

    const handleBackdropPress = () => {
        if (activeMenu) setActiveMenu(null);
        if (showEmojiPicker) setShowEmojiPicker(false);
        if (reactionMenu) setReactionMenu(null);
        Keyboard.dismiss();
    };



    // message merging logic
    const mergeMessages = (current: any[], newMsgs: any[]) => {
        // 1. Identify local temp messages
        const temps = current.filter(m => m.id.toString().startsWith('temp-'));

        // 2. Filter out temps that have arguably been "synced" (same content/sender/type)
        // This is a heuristic. Ideally backend returns nonce/client-id.
        const activeTemps = temps.filter(t => {
            const match = newMsgs.find(n =>
                (n.clientId && n.clientId === t.id) ||
                (n.text === t.text &&
                    n.senderId === t.senderId &&
                    n.type === t.type &&
                    (n.type !== 'image' || n.mediaUrl === t.mediaUrl))
            );
            return !match;
        });

        // 3. Combine New Server Messages + Remaining Temps
        // Return sorted
        const combined = [...activeTemps, ...newMsgs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        return combined.filter(m => !deletedMessageIds.includes(m.id?.toString()));
    };

    const displayMessages = React.useMemo(() => {
        const result: any[] = [];
        let i = 0;
        while (i < localMessages.length) {
            const msg = localMessages[i];

            // Check for image grouping
            if (msg.type === 'image') {
                const group = [msg];
                let j = i + 1;
                while (j < localMessages.length) {
                    const next = localMessages[j];
                    const timeDiff = Math.abs(new Date(msg.timestamp).getTime() - new Date(next.timestamp).getTime());
                    if (next.type === 'image' && next.senderId === msg.senderId && timeDiff < 60000) {
                        group.push(next);
                        j++;
                    } else {
                        break;
                    }
                }

                if (group.length > 1) {
                    result.push({
                        ...msg,
                        type: 'image_grid',
                        images: group, // Sub-array of images
                        id: `grid-${msg.id}`
                    });
                    i = j;
                } else {
                    result.push(msg);
                    i++;
                }
            } else {
                result.push(msg);
                i++;
            }
        }
        return result;
    }, [localMessages]);

    // ... Existing useEffect for messages ...
    useEffect(() => {
        if (!chatId) return;

        const fetchMessages = async (isSilent = false) => {
            if (!isSilent) setLoading(true);
            try {
                const res = await api.get(`/user/messages/${chatId}`);
                setLocalMessages(prev => {
                    const data = res.data.filter((m: any) => !deletedMessageIds.includes(m.id?.toString()));
                    const merged = isSilent ? mergeMessages(prev, data) : data;

                    // Stability Check: If data hasn't actually changed, return previous state ref
                    if (JSON.stringify(prev) === JSON.stringify(merged)) {
                        return prev;
                    }
                    return merged;
                });
            } catch (error) {
                console.error("Failed to fetch messages", error);
            } finally {
                if (!isSilent) setLoading(false);
            }
        };

        fetchMessages();

        // Polling Interval (1 Second)
        const interval = setInterval(() => {
            fetchMessages(true);
        }, 1000);

        if (socket) {
            socket.emit('join_chat', chatId);
        }

        // Mark as read when opening
        markAsRead(chatId);

        const handleReceive = (msg: any) => {
            if (msg.chatId && msg.chatId !== chatId) return;
            setLocalMessages(prev => {
                // If we already have this ID, ignore
                if (prev.some(m => m.id === msg.id)) return prev;

                // Check for Temp Match by clientId
                if (msg.clientId) {
                    const tempIndex = prev.findIndex(m => m.id === msg.clientId);
                    if (tempIndex !== -1) {
                        const newMessages = [...prev];
                        newMessages[tempIndex] = msg;
                        return newMessages;
                    }
                }

                // Fallback: heuristic match if clientId missing (e.g. older messages)
                if (msg.senderId === user?.id) {
                    const tempIndex = prev.findIndex(m => m.id.toString().startsWith('temp-') && m.text === msg.text);
                    if (tempIndex !== -1) {
                        const newMessages = [...prev];
                        newMessages[tempIndex] = msg;
                        return newMessages;
                    }
                }
                return [msg, ...prev];
            });
        };

        socket?.on('receive_message', handleReceive);
        return () => {
            clearInterval(interval);
            if (socket) socket.emit('leave_chat', chatId);
        };
    }, [chatId, socket, user, markAsRead, fetchChats]); // Added fetchChats to deps if needed

    const handleSelectMessage = (item: any) => {
        toggleSelectionMode(true);
        toggleMessageSelection(item.id);
        setActiveMenu(null);
    };

    const handleDeleteSelected = async () => {
        const ids = [...selectedMessageIds];
        clearSelection();
        for (const id of ids) {
            performDelete(id);
        }
    };

    // Reaction Listener
    const handleReactionUpdate = (data: any) => {
        if (data.chatId !== chatId) return;
        setLocalMessages(prev => prev.map(msg =>
            msg.id === data.messageId ? { ...msg, reactions: data.reactions } : msg
        ));
    };

    useEffect(() => {
        if (socket) {
            socket.on('message_reaction_update', handleReactionUpdate);
        }
        return () => {
            socket?.off('message_reaction_update', handleReactionUpdate);
        };
    }, [socket, chatId]);

    // Actions - Wrapped in useCallback for performance and stability
    const onReply = useCallback((msg: any) => {
        setReplyingTo(msg);
    }, []);

    const onCopy = useCallback(async (text: string) => {
        await Clipboard.setStringAsync(text);
    }, []);

    const confirmDelete = useCallback((msgId: string) => {
        setMsgToDeleteId(msgId);
        setConfirmVisible(true);
    }, []);

    const handleConfirmDelete = useCallback(() => {
        if (msgToDeleteId) {
            performDelete(msgToDeleteId);
        }
        setConfirmVisible(false);
        setMsgToDeleteId(null);
    }, [msgToDeleteId, localMessages]); // Dependencies might need refinement if performDelete changes often

    const performDelete = async (targetId: string) => {
        let idsToDelete = [targetId];

        // If it's a grid, we need to delete all constituent images
        if (targetId.startsWith('grid-')) {
            const gridItem = displayMessages.find(m => m.id === targetId);
            if (gridItem && gridItem.images) {
                idsToDelete = gridItem.images.map((img: any) => img.id);
            }
        }

        // Optimistic Remove
        setLocalMessages(prev => prev.filter(m => !idsToDelete.includes(m.id)));
        idsToDelete.forEach(id => addDeletedMessageId(id.toString()));

        // Remove from Starred Store (Side Effect)
        for (const id of idsToDelete) {
            // @ts-ignore
            useChatStore.getState().deleteMessageFromStore(id);
        }

        try {
            // Bulk delete or loop? Backend usually handles one by one or we could add bulk.
            // For now, loop but in parallel.
            await Promise.all(idsToDelete.map(id => api.delete(`/user/chat/${chatId}/message/${id}`)));
        } catch (error) {
            console.error("Delete failed", error);
        }
    };

    const onForward = useCallback((msg: any) => {
        setMessageToForward(msg);
        setForwardModalVisible(true);
    }, []);

    const processForward = (selectedChatIds: string[]) => {
        if (!messageToForward) return;

        // Loop and send. Ideally backend should handle batch but we do loop here for now.
        selectedChatIds.forEach(targetChatId => {
            sendMessage(
                targetChatId,
                messageToForward.text,
                user!.id,
                messageToForward.type,
                messageToForward.mediaUrl,
                undefined,
                undefined,
                true // isForwarded
            );
        });

        setMessageToForward(null);
    };

    const toggleReaction = useCallback((msgId: string, emoji: string) => {
        // Find message to check limits
        // NOTE: We need latest localMessages for check. 
        // We can use setState callback form or ref. But setState callback is for update.
        // If we strictly rely on limit check, we need accurate state.
        // However, iterating previous state inside setState is cleaner.

        setLocalMessages(prev => {
            const targetMsg = prev.find(m => m.id === msgId);
            if (targetMsg) {
                const existingReactions = Object.keys(targetMsg.reactions || {});
                // Limit Check inside the update function to ensure freshness
                if (existingReactions.length >= 2 && !existingReactions.includes(emoji)) {
                    // Check if user has reacted with one of the existing ones? 
                    // We need to see if the user is merely toggling OFF an existing one.
                    // If toggling off, allow it.
                    // If toggling ON a NEW one, block if count >= 2.

                    // But wait, "toggle" implies checking user list.
                    // Let's check deep.
                }
            }

            return prev.map(msg => {
                if (msg.id === msgId) {
                    const reactions = msg.reactions || {};
                    const userList = reactions[emoji] || [];
                    let newReactions = { ...reactions };

                    const existingKeys = Object.keys(reactions);
                    // Constraint Check: 
                    // If we are ADDING (user not in list) AND we have >= 2 keys AND this emoji is NOT one of them
                    if (!userList.includes(user!.id) && existingKeys.length >= 2 && !existingKeys.includes(emoji)) {
                        return msg; // Block
                    }

                    if (userList.includes(user!.id)) {
                        newReactions[emoji] = userList.filter((id: string) => id !== user!.id);
                        if (newReactions[emoji].length === 0) delete newReactions[emoji];
                    } else {
                        newReactions[emoji] = [...userList, user!.id];
                    }
                    return { ...msg, reactions: newReactions };
                }
                return msg;
            });
        });

        socket?.emit('toggle_reaction', {
            chatId,
            messageId: msgId,
            userId: user!.id,
            emoji
        });
    }, [chatId, user, socket]);

    // Images


    const launchCamera = async () => {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert("Permission denied", "Camera access is required.");
            return;
        }

        const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.7,
        });

        if (!result.canceled && result.assets && result.assets.length > 0) {
            const newImages = result.assets.map(asset => ({
                uri: asset.uri,
                type: 'image',
                width: asset.width,
                height: asset.height
            }));
            setPreviewImages(prev => [...prev, ...newImages]);
        }
    };
    const handleImagesSend = async (assets: any[], caption: string) => {
        setImagePreviewVisible(false);
        setPickedImages([]);

        // Upload each image
        for (const asset of assets) {
            uploadImage(asset.uri, caption, asset.width / asset.height);
        }
    };

    const uploadImage = async (uri: string, caption: string = '', ratio: number = 1) => {
        const tempId = `temp-${Date.now()}-${Math.random()}`;

        // Optimistic Add
        const tempMsg = {
            id: tempId,
            text: caption,
            senderId: user!.id,
            timestamp: new Date().toISOString(),
            type: 'image',
            mediaUrl: uri, // Use local URI temporarily
            aspectRatio: ratio
        };
        setLocalMessages(prev => [tempMsg, ...prev]);

        setUploading(true);
        try {
            let body: any;
            if (Platform.OS === 'web') {
                const response = await fetch(uri);
                const blob = await response.blob();
                body = new FormData();
                body.append('image', blob, 'upload.jpg');
            } else {
                body = new FormData();
                // @ts-ignore
                body.append('image', { uri, name: 'upload.jpg', type: 'image/jpeg' });
            }

            const res = await api.post('/upload', body, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            if (res.data.url) {
                // @ts-ignore
                sendMessage(chatId, caption, user!.id, 'image', res.data.url, otherUser.id, undefined, false, tempId, ratio);
                // Remove temp after sync usually happens via handleReceive or poll
            }
        } catch (error) {
            console.error("Upload failed", error);
            // Remove temp on fail
            setLocalMessages(prev => prev.filter(m => m.id !== tempId));
        } finally {
            setUploading(false);
        }
    };

    const handleEditMessage = (item: any) => {
        setEditingMessage(item);
        setEditModalVisible(true);
    };

    const handleCancelEdit = () => {
        setEditingMessage(null);
        setEditModalVisible(false);
    };

    const handleSaveEdit = async (newText: string) => {
        if (!editingMessage) return;

        const msgId = editingMessage.id;

        // Optimistic UI update
        setLocalMessages(prev => prev.map(m => m.id === msgId ? { ...m, text: newText, isEdited: true } : m));
        setEditingMessage(null);

        try {
            await api.post(`/user/chat/${chatId}/message/${msgId}/edit`, { newText });
            fetchChats(); // Refresh last message in list
        } catch (error) {
            console.error("Edit failed", error);
            Alert.alert("Error", "Could not edit message. Editing is only allowed within 15 minutes.");
        }
    };

    // Removed old handleAttachmentAction in favor of new handleFileAction


    const { width, height } = useWindowDimensions(); // Initialized dimensions hook



    const handleKeyPress = (e: any) => {
        if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    // Calculate position for File Menu (Left of button)
    const openFileSharing = () => {
        if (cameraIconRef.current) {
            cameraIconRef.current.measure((_x: number, _y: number, w: number, h: number, pageX: number, pageY: number) => {
                setFileSharingPosition({
                    bottom: height - pageY + 10,
                    // Position to the LEFT of the icon (Icon X - Menu Width - Gap)
                    left: pageX - 150 // Assuming menu width ~140
                });
                setFileSharingVisible(true);
            });
        } else {
            setFileSharingVisible(true);
        }
    };

    const handleFileAction = (action: 'gallery' | 'files') => {
        setFileSharingVisible(false);
        if (action === 'gallery') {
            pickImage(true); // multi-select
        } else {
            // Placeholder for file picker
            Alert.alert("Coming Soon", "File picker implementation pending.");
        }
    };

    const pickImage = async (allowMulti: boolean) => {
        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsMultipleSelection: allowMulti,
                quality: 0.8,
            });

            if (!result.canceled) {
                const newImages = result.assets.map(asset => ({
                    uri: asset.uri,
                    type: 'image',
                    width: asset.width,
                    height: asset.height
                }));
                // Add to preview instead of sending immediately
                setPreviewImages(prev => [...prev, ...newImages]);
            }
        } catch (error) {
            console.error("Image Picker Error:", error);
        }
    };

    const removePreviewImage = (index: number) => {
        setPreviewImages(prev => prev.filter((_, i) => i !== index));
    };

    const handleSend = async () => {
        if ((!inputText.trim() && previewImages.length === 0) || uploading) return;

        const tempId = `temp-${Date.now()}`;
        setUploading(true);

        try {
            // Optimistic UI Update for Text Only (if no images)
            if (previewImages.length === 0) {
                const newMsg = {
                    id: tempId,
                    text: inputText,
                    senderId: user!.id,
                    timestamp: new Date().toISOString(),
                    type: 'text',
                    replyTo: replyingTo ? {
                        id: replyingTo.id,
                        text: replyingTo.text,
                        senderName: replyingTo.senderId === user?.id ? 'You' : otherUser.username
                    } : undefined
                };
                setLocalMessages(prev => [newMsg, ...prev]);
            }

            // 1. Upload Images if any
            let uploadedUrls: any[] = [];
            if (previewImages.length > 0) {
                const uploadPromises = previewImages.map(async (img) => {
                    const formData = new FormData();
                    if (Platform.OS === 'web') {
                        const res = await fetch(img.uri);
                        const blob = await res.blob();
                        formData.append('file', blob, 'upload.jpg');
                    } else {
                        // @ts-ignore
                        formData.append('file', {
                            uri: img.uri,
                            type: 'image/jpeg',
                            name: 'upload.jpg'
                        });
                    }
                    formData.append('upload_preset', 'unsigned_preset');

                    const response = await api.post('/media/upload', formData, {
                        headers: { 'Content-Type': 'multipart/form-data' }
                    });
                    return {
                        mediaUrl: response.data.secure_url,
                        width: response.data.width,
                        height: response.data.height
                    };
                });

                uploadedUrls = await Promise.all(uploadPromises);
            }

            // 2. Send Message logic
            if (uploadedUrls.length > 0) {
                if (uploadedUrls.length > 1) {
                    await sendMessage(
                        chatId,
                        inputText,
                        user!.id,
                        'image_grid',
                        uploadedUrls,
                        otherUser.id,
                        replyingTo ? { id: replyingTo.id, text: replyingTo.text, senderName: replyingTo.senderId === user?.id ? 'You' : otherUser.username } : undefined
                    );
                } else {
                    await sendMessage(
                        chatId,
                        inputText,
                        user!.id,
                        'image',
                        uploadedUrls[0].mediaUrl,
                        otherUser.id,
                        replyingTo ? { id: replyingTo.id, text: replyingTo.text, senderName: replyingTo.senderId === user?.id ? 'You' : otherUser.username } : undefined,
                        false,
                        undefined,
                        uploadedUrls[0].width / uploadedUrls[0].height
                    );
                }
            } else {
                await sendMessage(
                    chatId,
                    inputText,
                    user!.id,
                    'text',
                    undefined,
                    otherUser.id,
                    replyingTo ? {
                        id: replyingTo.id,
                        text: replyingTo.text,
                        senderName: replyingTo.senderId === user?.id ? 'You' : otherUser.username
                    } : undefined,
                    false,
                    tempId
                );
            }

            setInputText('');
            setPreviewImages([]);
            setReplyingTo(null);
            fetchChats();
        } catch (error) {
            console.error("Send failed", error);
            Alert.alert("Error", "Failed to send message");
            setLocalMessages(prev => prev.filter(m => m.id !== tempId));
        } finally {
            setUploading(false);
        }
    };

    if (!chatId) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
                <Text style={{ color: colors.textSecondary }}>Select a chat</Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Star Animation Overlay */}
            {starAnimVisible && (
                <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'center', alignItems: 'center', zIndex: 5000, pointerEvents: 'none' }}>
                    <Animated.View style={{ transform: [{ scale: starScale }] }}>
                        <Star size={100} color={Colors.trafficYellow} fill={Colors.trafficYellow} />
                    </Animated.View>
                </View>
            )}

            {/* Backdrop for closing Emoji Picker or Menus */}
            {(showEmojiPicker || activeMenu || reactionMenu) && (
                <TouchableOpacity
                    style={styles.backdrop}
                    activeOpacity={1}
                    onPress={handleBackdropPress}
                />
            )}
            {/* Header */}
            <View style={styles.headerContainer}>
                {isSelectionMode ? (
                    <View style={[styles.headerPill, { backgroundColor: colors.background === '#000000' ? '#333' : '#F0F0F0', borderColor: colors.border }]}>
                        <TouchableOpacity onPress={clearSelection} style={{ marginRight: 15 }}>
                            <X size={24} color={colors.text} />
                        </TouchableOpacity>
                        <Text style={[styles.pillName, { color: colors.text, flex: 1 }]}>{selectedMessageIds.length} selected</Text>
                        <TouchableOpacity onPress={handleDeleteSelected}>
                            <Trash2 size={24} color={Colors.danger} />
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={[styles.headerPill, {
                        backgroundColor: colors.background === '#000000' ? Colors.darkPillBackground : '#FFFFFF',
                        borderColor: colors.background === '#000000' ? Colors.darkBorderSubtle : Colors.lightBorderSubtle
                    }]}>
                        {isMobile && (
                            <TouchableOpacity onPress={onBack} style={styles.backButton}>
                                <ChevronLeft size={24} color={colors.text} />
                            </TouchableOpacity>
                        )}
                        <Image source={{ uri: otherUser.avatar || 'https://i.pravatar.cc/100' }} style={styles.pillAvatar} />
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.pillName, { color: colors.text }]}>{otherUser.username}</Text>
                            {otherUser.isOnline && <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Online</Text>}
                        </View>
                        <TouchableOpacity onPress={() => setProfileModalVisible(true)}>
                            <Info size={24} color={colors.text} />
                        </TouchableOpacity>
                    </View>
                )}
            </View>

            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                style={{ flex: 1, flexDirection: 'column' }}
                keyboardVerticalOffset={Platform.OS === "ios" ? 10 : 30}
            >
                {loading ? <ActivityIndicator size="large" color={colors.blue} style={{ marginTop: 50, flex: 1 }} /> : (
                    <FlatList
                        ref={flatListRef}
                        data={displayMessages}
                        style={{ flex: 1 }}
                        renderItem={({ item }) => (
                            <MessageBubble
                                item={item}
                                isMe={item.senderId === user?.id}
                                onReply={onReply}
                                onCopy={onCopy}
                                onForward={onForward}
                                onDelete={confirmDelete}
                                onEdit={handleEditMessage}
                                onImagePress={(url) => {
                                    const allImages = localMessages.filter(m => m.type === 'image');
                                    const idx = allImages.findIndex(img => img.mediaUrl === url);
                                    setViewerIndex(idx);
                                }}
                                isSelected={selectedMessageIds.includes(item.id)}
                                isSelectionMode={isSelectionMode}
                                onToggleSelection={toggleMessageSelection}
                                isMenuOpen={activeMenu?.id === item.id}
                                onMenuToggle={(id, measurement) => {
                                    if (!id) {
                                        setActiveMenu(null);
                                    } else if (measurement) {
                                        setActiveMenu({ id, y: measurement.y, isMe: measurement.isMe });
                                    }
                                }}
                                // @ts-ignore
                                onReactionOpen={(msg, y) => {
                                    setReactionMenu({
                                        id: msg.id,
                                        top: y - 50, // Position above click
                                        align: msg.senderId === user?.id ? 'left' : 'right'
                                    });
                                }}
                                onReactionClick={toggleReaction}
                                isMobile={isMobile}
                            />
                        )}
                        keyExtractor={(item) => item.clientId || item.id}
                        inverted
                        extraData={activeMenu} // Ensure re-render when menu changes
                        CellRendererComponent={({ item, index, style, children, ...props }) => {
                            const isActive = item.id === activeMenu?.id;
                            return (
                                <View
                                    style={[
                                        style,
                                        isActive && { zIndex: 9999, elevation: 9999, position: 'relative' } // Force top
                                    ]}
                                    {...props}
                                >
                                    {children}
                                </View>
                            );
                        }}
                        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 20 }}
                        showsVerticalScrollIndicator={false}
                        onScroll={(e) => setShowScrollButton(e.nativeEvent.contentOffset.y > 200)}
                        onScrollBeginDrag={() => setActiveMenu(null)} // Close menu on scroll
                        removeClippedSubviews={false}
                        onScrollToIndexFailed={() => { }} // Silent fail
                    />
                )}
                {/* Scroll Button */}
                {showScrollButton && (
                    <TouchableOpacity
                        style={[styles.scrollToBottomBtn, { backgroundColor: colors.background === '#000000' ? '#333' : '#FFF' }]}
                        onPress={() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true })}
                    >
                        <ChevronDown size={24} color={colors.text} />
                    </TouchableOpacity>
                )}

                <ConfirmationModal
                    visible={confirmVisible}
                    title="Delete Message"
                    message="Are you sure you want to delete this message?"
                    confirmText="Delete"
                    isDanger
                    onConfirm={handleConfirmDelete}
                    onCancel={() => setConfirmVisible(false)}
                />

                {/* Reply Preview */}
                {replyingTo && (
                    <View style={[styles.replyPreview, { backgroundColor: colors.background === '#000000' ? '#1C1C1E' : '#F2F2F7', borderTopColor: colors.border }]}>
                        <View style={styles.replyPreviewContent}>
                            <Text style={[styles.replyName, { color: colors.blue }]}>Replying to {replyingTo.senderId === user?.id ? 'Yourself' : otherUser.username}</Text>
                            <Text numberOfLines={1} style={{ color: colors.textSecondary }}>
                                {(() => {
                                    if (replyingTo.type === 'image') return '📷 Image';
                                    if (replyingTo.type === 'contact') {
                                        try {
                                            const contact = JSON.parse(replyingTo.text);
                                            return `👤 Contact: ${contact.username}`;
                                        } catch {
                                            return '👤 Contact';
                                        }
                                    }
                                    return replyingTo.text;
                                })()}
                            </Text>
                        </View>
                        <TouchableOpacity onPress={() => setReplyingTo(null)}>
                            <X size={20} color={colors.textSecondary} />
                        </TouchableOpacity>
                    </View>
                )}

                {/* Image Preview Strip */}
                {previewImages.length > 0 && (
                    <View style={[styles.previewStrip, { backgroundColor: colors.background === '#000000' ? '#1C1C1E' : '#FFFFFF', borderTopColor: colors.border }]}>
                        <FlatList
                            data={previewImages}
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            keyExtractor={(_, i) => i.toString()}
                            contentContainerStyle={{ paddingHorizontal: 16 }}
                            renderItem={({ item, index }) => (
                                <View style={styles.previewItem}>
                                    <Image source={{ uri: item.uri }} style={styles.previewImage} resizeMode="cover" />
                                    <TouchableOpacity
                                        style={styles.removePreviewBtn}
                                        onPress={() => removePreviewImage(index)}
                                    >
                                        <X size={12} color="#FFF" />
                                    </TouchableOpacity>
                                </View>
                            )}
                        />
                    </View>
                )}

                {/* Input */}
                <View style={[styles.inputContainer, { backgroundColor: colors.background, borderTopColor: colors.border, borderTopWidth: 0.5 }]}>
                    <TouchableOpacity style={{ marginLeft: 14 }} onPress={() => setAltFeatureVisible(true)}>
                        <PlusIcon size={19} color={colors.blue} />
                    </TouchableOpacity>
                    <View style={[styles.inputWrapper, {
                        backgroundColor: colors.background === '#000000' ? Colors.darkInputBackground : '#FFFFFF',
                        borderColor: colors.border,
                        opacity: isBlocked ? 0.5 : 1
                    }]}>
                        <TextInput
                            ref={inputRef}
                            style={[styles.input, { color: colors.text, textAlignVertical: 'center' }]}
                            value={isBlocked ? "You have blocked this user" : inputText}
                            onChangeText={setInputText}
                            multiline
                            onKeyPress={handleKeyPress}
                            placeholder=""
                            placeholderTextColor={colors.textSecondary}
                            editable={!isBlocked}
                        />
                        <TouchableOpacity style={{ marginRight: 4 }} onPress={() => {
                            if (showEmojiPicker) {
                                setShowEmojiPicker(false);
                            } else {
                                Keyboard.dismiss();
                                setShowEmojiPicker(true);
                            }
                        }}>
                            <StickerIcon size={18} color={showEmojiPicker ? colors.blue : colors.blue} />
                        </TouchableOpacity>
                    </View>
                    <TouchableOpacity
                        ref={cameraIconRef}
                        onPress={openFileSharing}
                        disabled={uploading || isBlocked}
                        style={{ marginRight: 14 }}
                    >
                        <CameraIcon size={24} color={colors.blue} />
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>

            <ForwardModal
                visible={forwardModalVisible}
                onClose={() => setForwardModalVisible(false)}
                onForward={processForward}
            />

            {/* Emoji Picker (Root Level for correct Z-Index over Backdrop) */}
            {
                showEmojiPicker && (
                    <EmojiPicker
                        onSelect={(emoji) => {
                            if (emojiPickerMode === 'reaction' && reactionMenu) {
                                toggleReaction(reactionMenu.id, emoji);
                                setShowEmojiPicker(false);
                                setReactionMenu(null);
                            } else {
                                setInputText(prev => prev + emoji);
                            }
                        }}
                        onClose={() => {
                            setShowEmojiPicker(false);
                            setEmojiPickerMode('input');
                        }}
                    />
                )
            }

            {/* Reaction Pill Popover */}
            {
                reactionMenu && (
                    <View style={{
                        position: 'absolute',
                        top: reactionMenu.top,
                        [reactionMenu.align === 'left' ? 'right' : 'left']: 60, // Offset from edge
                        zIndex: 2500
                    }}>
                        <ReactionPill
                            onSelect={(emoji) => {
                                toggleReaction(reactionMenu.id, emoji);
                                setReactionMenu(null);
                            }}
                            onCustomPress={() => {
                                setEmojiPickerMode('reaction');
                                setShowEmojiPicker(true);
                            }}
                        />
                    </View>
                )
            }

            <ProfileModal
                visible={profileModalVisible}
                user={otherUser}
                chatId={chatId}
                onClose={() => setProfileModalVisible(false)}
                onClearChat={() => {
                    clearChat(chatId);
                    if (isMobile && onBack) {
                        onBack();
                    } else {
                        fetchChats();
                    }
                }}
            />

            {/* Message Menu (Root) */}
            {
                activeMenu && (
                    <View style={{
                        position: 'absolute',
                        top: activeMenu.y,
                        [activeMenu.isMe ? 'right' : 'left']: 60, // Align with bubble (approx)
                        transform: [{ translateY: -180 }], // Lift UP above chevron 
                        zIndex: 3000
                    }}>
                        <MessageMenu
                            // @ts-ignore
                            item={localMessages.find(m => m.id === activeMenu.id)}
                            isMe={activeMenu.isMe}
                            colors={colors}
                            onReply={onReply}
                            onCopy={onCopy}
                            onForward={onForward}
                            onDelete={confirmDelete}
                            onStar={(msg) => {
                                // @ts-ignore
                                useChatStore.getState().starMessage(msg.id, chatId, msg);
                                setStarAnimVisible(true);
                                setActiveMenu(null);
                            }}
                            onEdit={handleEditMessage}
                            onSelect={handleSelectMessage}
                            onClose={() => setActiveMenu(null)}
                        />
                    </View>
                )
            }

            <FileSharingModal
                visible={fileSharingVisible}
                position={fileSharingPosition}
                onClose={() => setFileSharingVisible(false)}
                onAction={handleFileAction}
            />

            <AlternativeFeatureModal
                visible={altFeatureVisible}
                onClose={() => setAltFeatureVisible(false)}
            />

            <EditMessageModal
                visible={editModalVisible}
                message={editingMessage}
                onClose={handleCancelEdit}
                onSave={handleSaveEdit}
            />

            <ImagePreviewModal
                visible={imagePreviewVisible}
                images={pickedImages}
                onClose={() => { setImagePreviewVisible(false); setPickedImages([]); }}
                onSend={handleImagesSend}
                onAddMore={() => pickImage(true)}
            />

            <ImageViewerModal
                visible={viewerIndex !== -1}
                images={localMessages.filter(m => m.type === 'image')}
                initialIndex={viewerIndex}
                onClose={() => setViewerIndex(-1)}
            />
        </View >
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        width: '100%',
        overflow: 'hidden'
    },
    headerContainer: { paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 50 : 10, paddingBottom: 10, zIndex: 100 },
    headerPill: { height: 60, borderRadius: 35, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderWidth: 1, elevation: 5, shadowOpacity: 0.1, shadowRadius: 10 },
    backButton: { marginRight: 10 },
    pillAvatar: { width: 40, height: 40, borderRadius: 20, marginRight: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
    pillName: { fontSize: 16, fontWeight: '700' },

    bubbleContainer: { flexDirection: 'row', marginBottom: 6, width: '100%', position: 'relative' }, // position: relative required for zIndex on Web
    bubbleRight: { justifyContent: 'flex-end' },
    bubbleLeft: { justifyContent: 'flex-start' },
    bubble: { maxWidth: '75%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 18, position: 'relative' },
    msgText: { fontSize: 16, lineHeight: 22, fontFamily: 'System' },
    timeText: { fontSize: 10, marginTop: 4, alignSelf: 'flex-end', opacity: 0.7, fontFamily: 'System' },

    menuTrigger: { position: 'absolute', top: 0, right: 0, padding: 6, opacity: 0.8, zIndex: 10 },
    menu: { position: 'absolute', minWidth: 120, borderRadius: 12, padding: 0, zIndex: 1000, elevation: 10 },
    menuDown: { top: 25, bottom: undefined },
    menuUp: { bottom: '100%', top: undefined, marginBottom: 5 }, // Positions above the bubble with gap
    menuOutgoing: { right: 0 },
    menuIncoming: { left: '100%', marginLeft: -10 }, // Pops out to the right

    menuItem: { flexDirection: 'row', alignItems: 'center', padding: 10, borderBottomWidth: 0.5, borderBottomColor: 'rgba(128,128,128,0.2)' },
    menuText: { marginLeft: 10, fontSize: 14, fontWeight: '500' },

    replyQuote: { borderLeftWidth: 4, paddingLeft: 8, marginBottom: 6, borderRadius: 2 },
    replyName: { fontSize: 12, fontWeight: '700', marginBottom: 2 },
    replyText: { fontSize: 12 },

    forwardedRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, opacity: 0.8 },
    forwardedText: { fontSize: 10, marginLeft: 4, fontStyle: 'italic' },

    replyPreview: { flexDirection: 'row', alignItems: 'center', padding: 10, borderBottomWidth: 0.5, borderTopWidth: 0.5 },
    replyPreviewContent: { flex: 1, borderLeftWidth: 4, borderLeftColor: '#1DAB61', paddingLeft: 10 },

    inputContainer: { flexDirection: 'row', alignItems: 'flex-end', paddingVertical: 10, paddingBottom: Platform.OS === 'ios' ? 20 : 10 },
    inputWrapper: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 0.5, paddingHorizontal: 12, minHeight: 36, maxHeight: 120, marginHorizontal: 10, paddingVertical: 4 },
    input: { flex: 1, fontSize: 16, fontFamily: 'System', outlineStyle: 'none' } as any,
    inputIcons: { flexDirection: 'row', alignItems: 'center', gap: 10 },

    scrollToBottomBtn: { position: 'absolute', right: 20, bottom: 70, width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', shadowColor: "#000", shadowOpacity: 0.2, elevation: 5, zIndex: 50 },

    toastContainer: {
        position: 'absolute',
        bottom: 20,
        left: 20,
        right: undefined,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 8,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 6,
        zIndex: 1000,
        minWidth: 200,
        maxWidth: 300,
        justifyContent: 'space-between'
    },
    toastText: { color: '#FFF', fontSize: 14, fontWeight: '500' },
    undoText: { color: '#EB4D4B', fontWeight: '700', fontSize: 14 },

    backdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1500, // Below EmojiPicker (2000) and ActiveMsg (9999)
        backgroundColor: 'transparent'
    },

    reactionTrigger: {
        position: 'absolute',
        top: '50%',
        marginTop: -14, // Center vertically (approx)
        zIndex: 10,
    },
    reactionsContainer: {
        position: 'absolute',
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4
    },
    reactionBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderRadius: 10,
        borderWidth: 1,
    },
    // New Styles for Image Preview
    previewStrip: {
        maxHeight: 100,
        paddingVertical: 8,
        borderTopWidth: 0.5,
    },
    previewItem: {
        position: 'relative',
        marginRight: 8,
        width: 70,
        height: 70,
        borderRadius: 8,
        overflow: 'hidden'
    },
    previewImage: {
        width: '100%',
        height: '100%'
    },
    removePreviewBtn: {
        position: 'absolute',
        top: 2,
        right: 2,
        backgroundColor: 'rgba(0,0,0,0.6)',
        borderRadius: 10,
        width: 20,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center'
    }
});
