# Firestore Usage Analysis & Optimization Report

**Status:** 🚨 **CRITICAL ISSUES FOUND**
**Impact:** High Read Costs & Latency

You asked for a deep audit of why your reads are exceeding limits. I have analyzed your backend controllers and frontend store logic. Below are the **Three Silent Killers** draining your quota.

---

## 🛑 1. The "N+1" Chat List Killer (Backend)
**Location:** `backend/src/controllers/userController.js` -> `getChats`
**Severity:** Critical

### The Code Pattern
```javascript
// userController.js
for (const doc of snapshot.docs) {
    // 1 READ (Chat Doc)
    const data = doc.data(); 
    const otherUserId = data.participants.find(p => p !== currentUserId);
    
    // 💥 1 EXTRA READ PER CHAT 💥
    const userDoc = await db.collection('users').doc(otherUserId).get(); 
}
```

### Why it destroys usage
If a user has **50 chats** and refreshes the list:
- **Expected:** 1 Query (or 50 docs read)
- **Actual:** 50 Chat Reads + 50 User Profile Reads = **100 Reads**.
- **Multiplier:** If 100 users refresh 5 times a day = **50,000 Reads/day** just for knowing usage.

### ✅ The Fix: Denormalization
Store the other user's basic info (`username`, `avatar`) **inside the chat document** when the chat is created or when the profile is updated.

**Optimized Code Structure:**
```javascript
// On Create Chat
const newChat = {
    participants: [uid1, uid2],
    participantData: {
        [uid1]: { username: 'A', avatar: '...' },
        [uid2]: { username: 'B', avatar: '...' }
    }
    // ...
};

// On Get Chats (0 Extra Reads)
snapshot.forEach(doc => {
    const data = doc.data();
    chats.push({
        id: doc.id,
        // No DB call needed!
        otherUser: data.participantData[otherId] 
    });
});
```

---

## 🔁 2. The "Refetch Everything" Trigger (Frontend)
**Location:** `frontend/src/stores/useChatStore.ts`
**Severity:** High

### The Code Pattern
```typescript
newSocket.on('message_deleted', ({ chatId, messageId }) => {
    // ... updates local messages ...
    get().fetchChats(); // 💥 RE-FETCHES ALL CHATS FROM SERVER 💥
});
```

### Why it's bad
You are re-downloading the entire chat list (and triggering the **N+1** backend issue above) every time *any* single message is deleted or edited using the sockets.

### ✅ The Fix: Local State Update
Update the local `chats` array optimistically. Do not call server.

```typescript
// useChatStore.ts
newSocket.on('message_deleted', ({ chatId, messageId }) => {
    // 1. Remove message from message list (You already do this)
    // 2. Update Chat List local state ONLY
    set(state => ({
        chats: state.chats.map(c => {
            if (c.id === chatId && c.lastMessage?.id === messageId) {
                return { ...c, lastMessage: { ...c.lastMessage, text: 'Message deleted' } };
            }
            return c;
        })
    }));
    // NO fetchChats() call!
});
```

---

## 🔍 3. The "Existence Scan" (Backend)
**Location:** `backend/src/controllers/userController.js` -> `createChat`
**Severity:** Moderate

### The Code Pattern
```javascript
// To check if a chat exists between A and B:
const snapshot = await chatsRef.where('participants', 'array-contains', currentUserId).get();
snapshot.forEach(...) // Scanning ALL user's chats
```

### Why it's bad
To start a chat, you download *all* the user's existing chats to check for a duplicate. As the user's history grows, this query gets heavier.

### ✅ The Fix: Deterministic IDs
Generate the Chat ID based on the sorted user IDs. You never need to query.

```javascript
// userController.js
const chatId = [currentUserId, targetUserId].sort().join('_');
const chatDoc = await db.collection('chats').doc(chatId).get(); // 1 Direct Read

if (chatDoc.exists) return res.json(chatDoc.data());
// else create...
```

---

## 🏆 Ideal Firestore Data Model
To minimize reads long-term, adopt this structure:

1.  **Users Collection**: `{ id, username, avatar }`
2.  **Chats Collection** (ID: `userA_userB`):
    *   `participants`: `[uidA, uidB]`
    *   `userData`: `{ [uidA]: { username, avatar }, [uidB]: { username, avatar } }`
    *   `lastMessage`: `{ text, senderId, timestamp }`
3.  **Messages Sub-collection**: `{ text, senderId, ... }`

**Key Rule:** Never read a related document inside a loop. Duplicate the data you need for the list view into the parent document.

---

## 🚀 Recommended Action Plan
1.  **Immediate**: Remove `fetchChats()` from `message_deleted/edited` listeners in frontend.
2.  **High Priority**: Implement **Deterministic Chat IDs** (`userA_userB`) to kill the "Existence Scan".
3.  **Critical Refactor**: Modify `createChat` to save `userData` in the chat doc, and update `getChats` to read from it instead of fetching `users` collection.

---

## 🎧 Listener Lifecycle Rules (Best Practices)

To avoid "Zombie Listeners" that keep reading after you leave a screen:

1.  **React `useEffect` Cleanup**: Always return an unsubscribe function.
    ```javascript
    useEffect(() => {
        const unsubscribe = db.collection('chats').onSnapshot(...);
        return () => unsubscribe(); // CRITICAL: Detaches listener on unmount
    }, []);
    ```

2.  **Navigation Focus**: If a tab is hidden but not unmounted (common in React Navigation), use `useFocusEffect` to attach/detach listeners so you don't read data for background tabs.

3.  **Background State**: Detach all listeners when the App State goes to `background` (using `AppState` API) to prevent reads while the phone is in the pocket.

