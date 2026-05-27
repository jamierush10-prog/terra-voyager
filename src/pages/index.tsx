import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { db } from '../firebase/config';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import Link from 'next/link';

export default function Home() {
  const router = useRouter();
  const [vesselIdInput, setVesselIdInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  // FIXED AUTH STATE TYPE BYPASS FOR VERCEL
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const auth = getAuth();
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        const usersCollection = collection(db, 'users');
        const qProfile = query(usersCollection, where('uid', '==', user.uid));
        getDocs(qProfile).then((snap) => {
          if (!snap.empty) {
            setUserProfile(snap.docs[0].data());
          }
          setAuthLoading(false);
        }).catch((err) => {
          console.error("Profile fetch error:", err);
          setAuthLoading(false);
        });
      } else {
        setCurrentUser(null);
        setUserProfile(null);
        setAuthLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  const handleTrackVesselId = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vesselIdInput.trim()) return;

    setSearching(true);
    setSearchError('');
    const targetId = vesselIdInput.trim().toUpperCase();

    try {
      const docRef = doc(db, 'voyagerMissions', targetId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        router.push(`/mission/${targetId.toLowerCase()}`);
      } else {
        setSearchError(`Vessel node [${targetId}] is not registered in the central routing network.`);
      }
    } catch (err) {
      console.error("Search system error:", err);
      setSearchError('Transmission fault occurred while querying vessel database.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col items-center justify-center p-4 relative overflow-hidden">
      
      {/* BACKGROUND GRAPHIC LAYER */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(30,41,59,0.3),transparent_top)] z-0" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(15,23,42,0.1)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.1)_1px,transparent_1px)] bg-[size:4rem_4rem] z-0" />

      <main className="w-full max-w-md bg-slate-900/40 backdrop-blur-xl border border-slate-900 rounded-2xl p-6 space-y-8 shadow-2xl relative z-10">
        <header className="text-center space-y-2">
          <h1 className="text-2xl font-black tracking-widest text-slate-200 uppercase">TERRA VOYAGER</h1>
          <p className="text-[10px] font-mono text-slate-400 uppercase tracking-widest font-bold">Global Object Telemetry Engine // v1.0.0</p>
        </header>

        {/* VESSEL TRACKING SEARCH INPUT TERMINAL */}
        <form onSubmit={handleTrackVesselId} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-mono font-bold tracking-widest text-slate-200 uppercase block">ENTER REGISTRY VESSEL ID</label>
            <input
              type="text"
              placeholder="e.g. TV-20"
              value={vesselIdInput}
              onChange={(e) => setVesselIdInput(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-center font-mono font-bold uppercase text-slate-100 tracking-widest focus:outline-none focus:border-blue-500 transition-all text-sm shadow-inner"
              disabled={searching}
            />
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs font-bold uppercase tracking-widest py-3.5 px-4 rounded-xl transition-all shadow-lg active:scale-[0.99] disabled:opacity-50"
            disabled={searching || !vesselIdInput.trim()}
          >
            {searching ? 'LINKING CODES...' : 'CONNECT UPLINK FEED'}
          </button>

          {searchError && (
            <p className="text-center font-mono text-[10px] text-rose-400/90 bg-rose-950/20 border border-rose-950/40 p-2.5 rounded-lg uppercase tracking-wide animate-pulse">
              ⚠️ {searchError}
            </p>
          )}
        </form>

        {/* PORTAL GATEWAY NAVIGATION ROUTER */}
        <div className="border-t border-slate-900/80 pt-5 text-center font-mono text-[11px] uppercase tracking-wider space-y-3">
          {authLoading ? (
            <span className="text-white font-black animate-pulse">SCANNING BIOMETRIC ACCESS TOKENS...</span>
          ) : currentUser && userProfile ? (
            <div className="space-y-2.5">
              <p className="text-slate-200 font-bold">Authorized Handle: <span className="text-blue-400 font-black">📡 {userProfile.username}</span></p>
              <div className="flex justify-center gap-4">
                {userProfile.role === 'admin' && (
                  <Link href="/admin" className="text-emerald-400 hover:underline font-black">
                    [Command Console]
                  </Link>
                )}
                <Link href="/api/auth/signout" className="text-slate-300 hover:underline font-bold">
                  [Disconnect Uplink]
                </Link>
              </div>
            </div>
          ) : (
            <p className="text-slate-300 font-bold tracking-wide">
              FIELD HANDLER?{' '}
              <Link href="/login" className="text-blue-400 hover:underline font-black">
                [LOGIN // ENLIST ACCESS KEY]
              </Link>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}