import { useState, useEffect } from 'react';
import { db, storage } from '../firebase/config';
// FIXED: Appended the explicit 'where' constraint directly into the library import array
import { collection, onSnapshot, addDoc, doc, updateDoc, arrayUnion, arrayRemove, query, orderBy, where } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import Link from 'next/link';

interface Reply {
  id: string;
  username: string;
  messageText: string;
  timestamp: any;
  imageUrl?: string;
}

interface ChatMessage {
  id: string;
  username: string;
  messageText: string;
  timestamp: any;
  imageUrl?: string;
  likes: string[];
  replies?: Reply[];
}

export default function GlobalChatRoom() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [parentImage, setParentImage] = useState<File | null>(null);
  
  const [activeReplyBoxId, setActiveReplyBoxId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyImage, setReplyImage] = useState<File | null>(null);

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const auth = getAuth();
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        onSnapshot(query(collection(db, 'users'), where('uid', '==', user.uid)), (snap) => {
          if (!snap.empty) setUserProfile(snap.docs[0].data());
        });
      } else {
        setCurrentUser(null);
        setUserProfile(null);
      }
    });

    const qChat = query(collection(db, 'globalChatMessages'), orderBy('timestamp', 'asc'));
    const unsubscribeChat = onSnapshot(qChat, (snapshot) => {
      const msgList: ChatMessage[] = [];
      snapshot.forEach((d) => {
        const data = d.data();
        msgList.push({
          id: d.id,
          username: data.username || 'ANONYMOUS CUSTODIAN',
          messageText: data.messageText || '',
          timestamp: data.timestamp,
          imageUrl: data.imageUrl || null,
          likes: data.likes || [],
          replies: data.replies || []
        });
      });
      setMessages(msgList);
      setLoading(false);
    });

    return () => {
      unsubscribeAuth();
      unsubscribeChat();
    };
  }, []);

  const handlePostMainMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !userProfile || submitting) return;

    setSubmitting(true);
    let uploadedUrl = '';

    try {
      if (parentImage) {
        const fileRef = ref(storage, `chat/${Date.now()}_${parentImage.name}`);
        const snapshot = await uploadBytes(fileRef, parentImage);
        uploadedUrl = await getDownloadURL(snapshot.ref);
      }

      await addDoc(collection(db, 'globalChatMessages'), {
        username: userProfile.username.toUpperCase(),
        messageText: newMessage.trim(),
        timestamp: new Date(),
        imageUrl: uploadedUrl,
        likes: [],
        replies: []
      });

      setNewMessage('');
      setParentImage(null);
    } catch (err) {
      console.error(err);
    }
    setSubmitting(false);
  };

  const handlePostThreadReply = async (e: React.FormEvent, messageId: string) => {
    e.preventDefault();
    if (!replyText.trim() || !userProfile || submitting) return;

    setSubmitting(true);
    let uploadedReplyUrl = '';
    const targetDocRef = doc(db, 'globalChatMessages', messageId);

    try {
      if (replyImage) {
        const fileRef = ref(storage, `chat/replies/${Date.now()}_${replyImage.name}`);
        const snapshot = await uploadBytes(fileRef, replyImage);
        uploadedReplyUrl = await getDownloadURL(snapshot.ref);
      }

      const newReplyObject: Reply = {
        id: `REP_${Date.now()}`,
        username: userProfile.username.toUpperCase(),
        messageText: replyText.trim(),
        timestamp: new Date().toISOString(),
        imageUrl: uploadedReplyUrl || undefined
      };

      await updateDoc(targetDocRef, {
        replies: arrayUnion(newReplyObject)
      });

      setReplyText('');
      setReplyImage(null);
      setActiveReplyBoxId(null);
    } catch (err) {
      console.error(err);
    }
    setSubmitting(false);
  };

  const handleToggleLikeMessage = async (messageId: string, activeLikes: string[]) => {
    if (!currentUser) return;
    const targetDocRef = doc(db, 'globalChatMessages', messageId);
    const userUid = currentUser.uid;

    try {
      if (activeLikes.includes(userUid)) {
        await updateDoc(targetDocRef, { likes: arrayRemove(userUid) });
      } else {
        await updateDoc(targetDocRef, { likes: arrayUnion(userUid) });
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col h-screen overflow-hidden">
      
      <header className="p-4 border-b border-slate-900 bg-slate-900/60 backdrop-blur shrink-0 z-40 flex justify-between items-center">
        <div>
          <Link href="/" className="text-[10px] font-mono font-black text-slate-400 hover:text-blue-400 tracking-widest block mb-0.5">🌍 CENTRAL PORTAL</Link>
          <h1 className="text-xl font-black tracking-wider uppercase text-slate-100">GLOBAL HEADQUARTERS CHAT</h1>
        </div>
        <div className="font-mono text-xs uppercase text-slate-400 font-bold">
          {userProfile ? `Active Account: ${userProfile.username}` : '[GUEST MODE]'}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 max-w-3xl w-full mx-auto space-y-4">
        {loading ? (
          <div className="text-center py-24 font-mono text-xs text-slate-500 uppercase tracking-widest animate-pulse">Establishing Signal Feeds...</div>
        ) : messages.length === 0 ? (
          <div className="text-center py-24 font-mono text-xs text-slate-500 uppercase tracking-wide border border-dashed border-slate-900 p-8 rounded-2xl">The log timeline is clear. Post a brief below to start the thread channel.</div>
        ) : (
          messages.map((msg) => {
            const hasLiked = currentUser ? msg.likes.includes(currentUser.uid) : false;
            const logDate = msg.timestamp?.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp);

            return (
              <div key={msg.id} className="bg-slate-900/40 border border-slate-900/80 rounded-2xl p-4 space-y-3 shadow-md">
                
                <header className="flex justify-between items-center border-b border-slate-950/40 pb-1.5 font-mono text-[11px]">
                  <span className="text-blue-400 font-black tracking-wide">✍️ {msg.username}</span>
                  <span className="text-slate-400 font-medium">{logDate.toLocaleString()}</span>
                </header>

                <p className="text-slate-100 font-bold text-[14px] leading-relaxed break-words whitespace-pre-wrap">{msg.messageText}</p>

                {msg.imageUrl && (
                  <div className="relative mt-2 max-w-md border border-slate-950 rounded-xl overflow-hidden">
                    <img src={msg.imageUrl} alt="Attached Asset" className="w-full h-auto object-cover max-h-80" />
                  </div>
                )}

                <footer className="flex items-center space-x-4 pt-1 font-mono text-[10px]">
                  <button 
                    onClick={() => handleToggleLikeMessage(msg.id, msg.likes)}
                    disabled={!currentUser}
                    className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border uppercase font-black transition-all ${
                      hasLiked 
                        ? 'bg-rose-950/40 border-rose-800 text-rose-400' 
                        : 'bg-slate-950 border-slate-900 text-slate-400 hover:text-slate-200 disabled:opacity-40'
                    }`}
                  >
                    <span>{hasLiked ? '❤️ Liked' : '👍 Like'}</span>
                    <span className="bg-slate-900 px-1.5 py-0.5 rounded text-[9px] text-white">{msg.likes.length}</span>
                  </button>

                  <button 
                    onClick={() => {
                      if (!currentUser) return;
                      setReplyText('');
                      setReplyImage(null);
                      setActiveReplyBoxId(activeReplyBoxId === msg.id ? null : msg.id);
                    }}
                    disabled={!currentUser}
                    className="bg-slate-950 border border-slate-900 hover:text-slate-200 text-slate-400 font-black uppercase px-3 py-1.5 rounded-lg disabled:opacity-40"
                  >
                    💬 Reply Thread
                  </button>
                </footer>

                {msg.replies && msg.replies.length > 0 && (
                  <div className="pl-6 pt-2 border-l-2 border-slate-900 space-y-2.5">
                    {msg.replies.map((reply) => (
                      <div key={reply.id} className="bg-slate-950/40 border border-slate-900/60 rounded-xl p-3 space-y-2">
                        <header className="flex justify-between items-center text-[10px] font-mono">
                          <span className="text-indigo-400 font-black">↳ {reply.username}</span>
                          <span className="text-slate-500 font-medium">
                            {new Date(reply.timestamp).toLocaleString()}
                          </span>
                        </header>
                        <p className="text-slate-200 font-medium text-[12px] break-words">{reply.messageText}</p>
                        {reply.imageUrl && (
                          <div className="relative mt-1 max-w-sm border border-slate-950 rounded-lg overflow-hidden">
                            <img src={reply.imageUrl} alt="Nested Attachment" className="w-full h-auto object-cover max-h-48" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {activeReplyBoxId === msg.id && (
                  <form onSubmit={(e) => handlePostThreadReply(e, msg.id)} className="pl-6 border-l-2 border-blue-500/30 pt-1 space-y-2 font-mono text-[11px]">
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        required 
                        placeholder="Write your nested thread response..." 
                        value={replyText} 
                        onChange={(e) => setReplyText(e.target.value)} 
                        className="w-full bg-slate-950 border border-slate-900 rounded-xl p-3 text-white focus:outline-none focus:border-blue-500 font-medium text-xs" 
                      />
                      <button type="submit" disabled={submitting} className="bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-wider px-4 rounded-xl text-xs transition-all cursor-pointer">Post</button>
                    </div>
                    <div>
                      <input type="file" accept="image/*" onChange={(e) => setReplyImage(e.target.files?.[0] || null)} className="text-[10px] text-slate-400 file:mr-2 file:py-1 file:px-2 file:rounded file:bg-slate-900 file:text-slate-300 file:border-0 file:text-[9px] file:uppercase file:font-black file:cursor-pointer" />
                    </div>
                  </form>
                )}

              </div>
            );
          })
        )}
      </div>

      <footer className="p-4 border-t border-slate-900 bg-slate-950 shrink-0 z-40">
        <div className="max-w-3xl w-full mx-auto font-mono">
          {currentUser && userProfile ? (
            <form onSubmit={handlePostMainMessage} className="space-y-2">
              <div className="flex space-x-2">
                <input 
                  type="text" 
                  required 
                  placeholder={`Broadcast a clean message parameter as ${userProfile.username}...`} 
                  value={newMessage} 
                  onChange={(e) => setNewMessage(e.target.value)} 
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500 font-bold" 
                />
                <button type="submit" disabled={submitting} className="bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest px-6 rounded-xl transition-all shadow-md text-xs cursor-pointer">Transmit</button>
              </div>
              <div className="flex justify-between items-center text-[10px] text-slate-400 pl-1">
                <div className="flex items-center space-x-2">
                  <span>📎 Attach Photo:</span>
                  <input type="file" accept="image/*" onChange={(e) => setParentImage(e.target.files?.[0] || null)} className="file:py-0.5 file:px-2 file:rounded file:bg-slate-900 file:text-white file:border-0 file:text-[9px] file:uppercase file:font-bold hover:file:bg-slate-800 file:cursor-pointer" />
                </div>
                <span className="text-[9px] uppercase tracking-wider text-slate-500">Security Encrypted Channel Secure</span>
              </div>
            </form>
          ) : (
            <div className="text-center py-2.5 text-[11px] text-slate-500 uppercase tracking-widest font-bold bg-slate-900/20 border border-slate-900 rounded-xl">
              [⚠️ Ident verification signature missing. Log in from the entrance deck to utilize communications deck]
            </div>
          )}
        </div>
      </footer>

    </div>
  );
}