import { useState, useEffect } from 'react';
import { db, storage } from '../firebase/config';
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
      
      <header className="p-5 border-b border-slate-900 bg-slate-900/60 backdrop-blur shrink-0 z-40 flex justify-between items-center">
        <div>
          <Link href="/" className="text-xs font-mono font-black text-slate-400 hover:text-blue-400 tracking-widest block mb-1">🌍 CENTRAL PORTAL</Link>
          <h1 className="text-2xl font-black tracking-wider uppercase text-slate-100">GLOBAL HEADQUARTERS CHAT</h1>
        </div>
        <div className="font-mono text-xs md:text-sm uppercase text-slate-400 font-bold">
          {userProfile ? `Active Account: ${userProfile.username}` : '[GUEST MODE]'}
        </div>
      </header>

      {/* SCALED TIMELINE STREAM */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 max-w-4xl w-full mx-auto space-y-6">
        {loading ? (
          <div className="text-center py-24 font-mono text-sm text-slate-500 uppercase tracking-widest animate-pulse">Establishing Signal Feeds...</div>
        ) : messages.length === 0 ? (
          <div className="text-center py-24 font-mono text-sm text-slate-500 uppercase tracking-wide border border-dashed border-slate-900 p-8 rounded-2xl">The log timeline is clear. Post a brief below to start the thread channel.</div>
        ) : (
          messages.map((msg) => {
            const hasLiked = currentUser ? msg.likes.includes(currentUser.uid) : false;
            const logDate = msg.timestamp?.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp);

            return (
              /* ENHANCED MESSAGE BLOCK PADDING */
              <div key={msg.id} className="bg-slate-900/40 border border-slate-900/80 rounded-2xl p-5 md:p-6 space-y-4 shadow-lg">
                
                {/* UPSCALED HEADER FONTS */}
                <header className="flex justify-between items-center border-b border-slate-950/40 pb-2.5 font-mono text-xs md:text-sm">
                  <span className="text-blue-400 font-black tracking-wide text-sm">✍️ {msg.username}</span>
                  <span className="text-slate-400 font-bold">{logDate.toLocaleString()}</span>
                </header>

                {/* BUMPED MESSAGE TEXT SIZE UP TO text-lg FOR OPTIMAL COGNITIVE SCANNABILITY */}
                <p className="text-slate-100 font-black text-base md:text-lg leading-relaxed break-words whitespace-pre-wrap">{msg.messageText}</p>

                {msg.imageUrl && (
                  <div className="relative mt-3 max-w-xl border border-slate-950 rounded-xl overflow-hidden shadow-inner">
                    <img src={msg.imageUrl} alt="Attached Asset View" className="w-full h-auto object-cover max-h-[450px]" />
                  </div>
                )}

                {/* BUMPED METRIC HUB TOOLBAR FONT SIZES */}
                <footer className="flex items-center space-x-4 pt-1 font-mono text-xs">
                  <button 
                    onClick={() => handleToggleLikeMessage(msg.id, msg.likes)}
                    disabled={!currentUser}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-xl border uppercase font-black transition-all cursor-pointer ${
                      hasLiked 
                        ? 'bg-rose-950/40 border-rose-800 text-rose-400' 
                        : 'bg-slate-950 border-slate-900 text-slate-400 hover:text-slate-200 disabled:opacity-40'
                    }`}
                  >
                    <span>{hasLiked ? '❤️ Liked' : '👍 Like'}</span>
                    <span className="bg-slate-900 px-2 py-0.5 rounded text-xs text-white font-black">{msg.likes.length}</span>
                  </button>

                  <button 
                    onClick={() => {
                      if (!currentUser) return;
                      setReplyText('');
                      setReplyImage(null);
                      setActiveReplyBoxId(activeReplyBoxId === msg.id ? null : msg.id);
                    }}
                    disabled={!currentUser}
                    className="bg-slate-950 border border-slate-900 hover:text-slate-200 text-slate-400 font-black uppercase px-4 py-2 rounded-xl transition-all disabled:opacity-40 cursor-pointer"
                  >
                    💬 Reply Thread
                  </button>
                </footer>

                {/* NESTED RESPONSE THREAD SUBGRID ROWS WITH IMPROVED FONT SIZE */}
                {msg.replies && msg.replies.length > 0 && (
                  <div className="pl-6 md:pl-8 pt-3 border-l-2 border-slate-800 space-y-4">
                    {msg.replies.map((reply) => (
                      <div key={reply.id} className="bg-slate-950/40 border border-slate-900/60 rounded-xl p-4 space-y-2.5 shadow-sm">
                        <header className="flex justify-between items-center text-xs font-mono">
                          <span className="text-indigo-400 font-black text-sm">↳ {reply.username}</span>
                          <span className="text-slate-500 font-bold">
                            {new Date(reply.timestamp).toLocaleString()}
                          </span>
                        </header>
                        {/* REPLIES BUMPED TO TEXT-BASE */}
                        <p className="text-slate-200 font-bold text-sm md:text-base break-words leading-relaxed">{reply.messageText}</p>
                        {reply.imageUrl && (
                          <div className="relative mt-2 max-w-md border border-slate-950 rounded-lg overflow-hidden">
                            <img src={reply.imageUrl} alt="Nested Asset View" className="w-full h-auto object-cover max-h-64" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* DYNAMIC INLINE REPLY SUBMISSION FIELD WITH EXPANDED PADDING */}
                {activeReplyBoxId === msg.id && (
                  <form onSubmit={(e) => handlePostThreadReply(e, msg.id)} className="pl-6 border-l-2 border-blue-500/30 pt-2 space-y-3 font-mono">
                    <div className="flex gap-3">
                      <input 
                        type="text" 
                        required 
                        placeholder="Write your nested thread response..." 
                        value={replyText} 
                        onChange={(e) => setReplyText(e.target.value)} 
                        className="w-full bg-slate-950 border border-slate-900 rounded-xl p-4 text-white focus:outline-none focus:border-blue-500 font-bold text-sm" 
                      />
                      <button type="submit" disabled={submitting} className="bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-wider px-5 rounded-xl text-xs transition-all cursor-pointer">Post</button>
                    </div>
                    <div className="text-xs text-slate-400 flex items-center space-x-2">
                      <span>📎 Photo:</span>
                      <input type="file" accept="image/*" onChange={(e) => setReplyImage(e.target.files?.[0] || null)} className="file:py-1 file:px-2 file:rounded file:bg-slate-900 file:text-slate-300 file:border-0 file:text-[10px] file:uppercase file:font-black file:cursor-pointer" />
                    </div>
                  </form>
                )}

              </div>
            );
          })
        )}
      </div>

      {/* EXPANDED PRIMARY INPUT CONTROL STATION BAR */}
      <footer className="p-4 border-t border-slate-900 bg-slate-950 shrink-0 z-40">
        <div className="max-w-4xl w-full mx-auto font-mono">
          {currentUser && userProfile ? (
            <form onSubmit={handlePostMainMessage} className="space-y-3">
              <div className="flex space-x-3">
                <input 
                  type="text" 
                  required 
                  placeholder={`Broadcast a clean message parameter as ${userProfile.username}...`} 
                  value={newMessage} 
                  onChange={(e) => setNewMessage(e.target.value)} 
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-5 text-sm text-slate-100 focus:outline-none focus:border-blue-500 font-black" 
                />
                <button type="submit" disabled={submitting} className="bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest px-8 rounded-xl transition-all shadow-lg text-sm cursor-pointer">Transmit</button>
              </div>
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center text-xs text-slate-400 gap-2 px-1">
                <div className="flex items-center space-x-3">
                  <span className="font-bold text-slate-300">📎 Attach Thread Image:</span>
                  <input type="file" accept="image/*" onChange={(e) => setParentImage(e.target.files?.[0] || null)} className="file:py-1.5 file:px-3 file:rounded-xl file:bg-slate-900 file:text-white file:border-0 file:text-[10px] file:uppercase file:font-black hover:file:bg-slate-800 file:cursor-pointer" />
                </div>
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Security Encrypted Channel Secure</span>
              </div>
            </form>
          ) : (
            <div className="text-center py-4 text-xs md:text-sm text-slate-500 uppercase tracking-widest font-black bg-slate-900/20 border border-slate-900 rounded-xl">
              [⚠️ Ident verification signature missing. Log in from the entrance deck to utilize communications deck]
            </div>
          )}
        </div>
      </footer>

    </div>
  );
}