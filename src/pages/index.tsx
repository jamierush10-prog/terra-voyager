import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { db } from '../firebase/config';
import { collection, onSnapshot, doc, setDoc, query, where, getDocs } from 'firebase/firestore';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import dynamic from 'next/dynamic';
import Link from 'next/link';

const MapContainer = dynamic(() => import('react-leaflet').then((mod) => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then((mod) => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then((mod) => mod.Marker), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then((mod) => mod.Popup), { ssr: false });

export default function Home() {
  const router = useRouter();
  const [activeVessels, setActiveVessels] = useState<Record<string, any>>({});
  const [telemetryLogs, setTelemetryLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // AUTH STATES
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // SECURITY PORTAL MODAL STATES
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authUsername, setAuthUsername] = useState('');
  const [authActionLoading, setAuthActionLoading] = useState(false);
  const [authActionError, setAuthActionError] = useState('');

  // 1. LISTEN TO REGISTRY MISSIONS
  useEffect(() => {
    const mCollection = collection(db, 'voyagerMissions');
    const unsubscribeVessels = onSnapshot(mCollection, (snapshot) => {
      const vesselMap: Record<string, any> = {};
      snapshot.forEach((doc) => {
        const data = doc.data();
        const docIdUpper = doc.id.toUpperCase();
        const propertyIdUpper = data.missionId ? data.missionId.toUpperCase() : '';
        const masterId = docIdUpper.startsWith('TV-') ? docIdUpper : propertyIdUpper;
        
        if (masterId) {
          vesselMap[masterId] = { id: doc.id, ...data };
        }
      });
      setActiveVessels(vesselMap);
    }, (err) => {
      console.error("Missions sync fault:", err);
    });

    return () => unsubscribeVessels();
  }, []);

  // 2. LISTEN TO ALL FIELD CHECK-INS
  useEffect(() => {
    const logsCollection = collection(db, 'telemetryLogs');
    const unsubscribeLogs = onSnapshot(logsCollection, (snapshot) => {
      const logsList: any[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        logsList.push({ id: doc.id, ...data });
      });
      setTelemetryLogs(logsList);
      setLoading(false);
    }, (err) => {
      console.error("Telemetry sync fault:", err);
      setLoading(false);
    });

    return () => unsubscribeLogs();
  }, []);

  // 3. USER AUTHENTICATION MONITOR
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
          console.error("Profile link fault:", err);
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

  // GENERATE ARRAY FROM TV-01 TO TV-100
  const fleetRegistryIds = Array.from({ length: 100 }, (_, i) => {
    const num = String(i + 1).padStart(2, '0');
    return `TV-${num}`;
  });

  const handleAuthAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail.trim() || !authPassword.trim()) return;
    if (isSignUpMode && !authUsername.trim()) return;

    setAuthActionLoading(true);
    setAuthActionError('');
    const auth = getAuth();

    try {
      if (isSignUpMode) {
        const credential = await createUserWithEmailAndPassword(auth, authEmail.trim(), authPassword);
        const user = credential.user;
        const newProfile = {
          uid: user.uid,
          email: user.email,
          username: authUsername.trim(),
          role: 'user'
        };
        await setDoc(doc(db, 'users', user.uid), newProfile);
        setUserProfile(newProfile);
      } else {
        await signInWithEmailAndPassword(auth, authEmail.trim(), authPassword);
      }
      setIsAuthModalOpen(false);
      setAuthEmail('');
      setAuthPassword('');
      setAuthUsername('');
    } catch (err: any) {
      setAuthActionError('Clearance criteria rejected.');
    } finally {
      setAuthActionLoading(false);
    }
  };

  // INTERSECT REGISTRIES WITH FIELD TELEMETRY TO BUILD COMPREHENSIVE LAST-KNOWN MAP MARKERS
  const mappedFleetPins = Object.keys(activeVessels).map((vesselId) => {
    const baselineRegistryData = activeVessels[vesselId];
    
    const vesselLogs = telemetryLogs
      .filter(log => log.voyagerId && log.voyagerId.toUpperCase() === vesselId)
      .sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

    let currentLat = parseFloat(baselineRegistryData.latitude);
    let currentLng = parseFloat(baselineRegistryData.longitude);
    let locationLabel = `DEPLOYMENT VECTOR: ${baselineRegistryData.originCity || 'ORIGIN'}`;
    let operatorSignoff = 'SYSTEM CONSOLE';

    if (vesselLogs.length > 0) {
      const latestLog = vesselLogs[0];
      const parsedLogLat = parseFloat(latestLog.latitude);
      const parsedLogLng = parseFloat(latestLog.longitude);
      
      if (!isNaN(parsedLogLat) && !isNaN(parsedLogLng)) {
        currentLat = parsedLogLat;
        currentLng = parsedLogLng;
        locationLabel = latestLog.reportedLocation || 'VERIFIED FIELD POINT';
        operatorSignoff = latestLog.handlerName || 'FIELD HANDLER';
      }
    }

    return {
      vesselId,
      lat: currentLat,
      lng: currentLng,
      locationLabel,
      operatorSignoff
    };
  }).filter(pin => !isNaN(pin.lat) && !isNaN(pin.lng));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col md:h-screen overflow-x-hidden relative">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />

      {/* HEADER CONTROL BLOCK */}
      <header className="p-4 border-b border-slate-900 bg-slate-900/40 backdrop-blur shrink-0 z-40 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-black tracking-widest text-slate-100 uppercase">TERRA VOYAGER</h1>
          <p className="text-[10px] font-mono text-slate-300 uppercase tracking-widest font-bold mt-0.5">Central Fleet Command & Telemetry Engine</p>
        </div>
        
        <div className="font-mono text-[11px] uppercase tracking-wider">
          {authLoading ? (
            <span className="text-slate-400 animate-pulse">CONNECTING INTERFACE...</span>
          ) : currentUser && userProfile ? (
            <div className="flex items-center space-x-4">
              <span className="text-white font-bold">📡 CALLSIGN: <span className="text-blue-400 font-black">{userProfile.username}</span></span>
              {userProfile.role === 'admin' && <Link href="/admin" className="text-emerald-400 font-black hover:underline">[CONSOLE]</Link>}
              <button onClick={() => getAuth().signOut()} className="text-slate-300 font-bold hover:underline bg-transparent border-0 cursor-pointer p-0">[DISCONNECT]</button>
            </div>
          ) : (
            <button onClick={() => { setIsSignUpMode(false); setAuthActionError(''); setIsAuthModalOpen(true); }} className="text-blue-400 hover:underline font-black bg-transparent border-0 cursor-pointer p-0">
              [LOGIN // ENLIST ACCESS KEY]
            </button>
          )}
        </div>
      </header>

      {/* MAIN TWO-COLUMN SPLIT CONTROL DECK */}
      <main className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden relative z-10">
        
        {/* COLUMN 1: MAP CONTAINER */}
        <section className="w-full md:w-1/2 aspect-square md:aspect-auto md:h-full border-b md:border-b-0 md:border-r border-slate-900 bg-slate-950 relative shrink-0">
          <MapContainer center={[37.0902, -95.7129]} zoom={4} style={{ height: '100%', width: '100%', background: '#020617' }} zoomControl={false}>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
            {mappedFleetPins.map((pin) => (
              <Marker key={pin.vesselId} position={[pin.lat, pin.lng]}>
                <Popup>
                  <div className="text-slate-900 font-mono text-xs font-bold p-1">
                    <span className="text-blue-600 font-black block text-sm">{pin.vesselId}</span>
                    <span className="block mt-1 text-slate-700">Last Status: {pin.locationLabel}</span>
                    <span className="block text-[10px] text-slate-500">Sign-off: {pin.operatorSignoff}</span>
                    <Link href={`/mission/${pin.vesselId.toLowerCase()}`} className="text-blue-500 underline block mt-2 text-[11px] uppercase font-black">Open Vessel Deck →</Link>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </section>

        {/* COLUMN 2: REGISTRY MATRIX GRID */}
        <section className="w-full md:w-1/2 flex flex-col h-auto md:h-full overflow-hidden bg-slate-900/10">
          <div className="p-4 border-b border-slate-900 bg-slate-950/80 backdrop-blur shrink-0 flex justify-between items-center">
            <h2 className="text-xs font-mono font-black text-slate-100 uppercase tracking-widest">FLEET REGISTRY MATRIX VECTOR</h2>
            <div className="flex items-center space-x-3 font-mono text-[9px] font-bold uppercase text-slate-300">
              <div className="flex items-center space-x-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 block"></span><span>Active</span></div>
              <div className="flex items-center space-x-1"><span className="w-2.5 h-2.5 rounded-full bg-yellow-400 block"></span><span>Missing</span></div>
              <div className="flex items-center space-x-1"><span className="w-2.5 h-2.5 rounded-full bg-slate-800 border border-slate-700 block"></span><span>Staged</span></div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 bg-slate-950/40">
            {loading ? (
              <div className="text-center py-12 font-mono text-xs text-slate-400 animate-pulse">QUERYING FLEET CHANNELS...</div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2.5">
                {fleetRegistryIds.map((id) => {
                  const baselineRegistryData = activeVessels[id];
                  const isDeployed = !!baselineRegistryData;

                  // DETERMINE INDIVIDUAL VESSEL LOOP STATUS WITHIN ARRAY
                  const isItemMissing = (() => {
                    if (!isDeployed) return false;
                    const currentTimeMs = new Date().getTime();
                    
                    const vesselLogs = telemetryLogs
                      .filter(log => log.voyagerId && log.voyagerId.toUpperCase() === id)
                      .sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

                    if (vesselLogs.length > 0) {
                      const latestLog = vesselLogs[0];
                      const lastCheckinMs = latestLog.timestamp?.toDate() ? latestLog.timestamp.toDate().getTime() : currentTimeMs;
                      return (currentTimeMs - lastCheckinMs) > (30 * 24 * 60 * 60 * 1000);
                    } else if (baselineRegistryData?.launchDate) {
                      return (currentTimeMs - new Date(baselineRegistryData.launchDate).getTime()) > (30 * 24 * 60 * 60 * 1000);
                    }
                    return false;
                  })();

                  return isDeployed ? (
                    // ACTIVE VESSEL MODULE CARD
                    <Link 
                      key={id}
                      href={`/mission/${id.toLowerCase()}`}
                      className={`border-2 rounded-xl p-3 text-center transition-all flex flex-col items-center justify-center space-y-1 cursor-pointer ${
                        isItemMissing 
                          ? 'bg-yellow-950/40 border-yellow-500 hover:bg-yellow-950/70 shadow-md shadow-yellow-500/5' 
                          : 'bg-blue-950/80 border-blue-500 hover:bg-blue-900 shadow-md shadow-blue-500/10'
                      }`}
                    >
                      <span className="text-[13px] font-mono font-black text-white tracking-wider">{id}</span>
                      <span className={`w-2 h-2 rounded-full block animate-pulse ${isItemMissing ? 'bg-yellow-400' : 'bg-cyan-400'}`}></span>
                    </Link>
                  ) : (
                    // MUTED UNLAUNCHED STAGED MODULE CARD
                    <div 
                      key={id}
                      className="bg-slate-900/10 border border-slate-900 rounded-xl p-3 text-center flex flex-col items-center justify-center space-y-1 opacity-[0.15] select-none"
                    >
                      <span className="text-[12px] font-mono font-bold text-slate-500 tracking-wider">{id}</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-800 block"></span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* SECURITY ACCESS IDENTITY MODAL */}
      {isAuthModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-2xl relative font-mono text-xs text-slate-100">
            <header className="text-center space-y-1.5">
              <h2 className="text-sm font-black tracking-widest text-white uppercase">{isSignUpMode ? 'ENLIST NEW ACCESS SIGNATURE' : 'SECURITY CLEARANCE PROTOCOL'}</h2>
              <p className="text-[9px] text-slate-300 uppercase tracking-wider">{isSignUpMode ? 'Register callsign coordinates' : 'Input identity validation tokens'}</p>
            </header>

            <form onSubmit={handleAuthAction} className="space-y-4">
              {isSignUpMode && (
                <div className="space-y-1.5">
                  <label className="text-[9px] font-bold text-slate-200 uppercase block tracking-wider">CHOOSE CALLSIGN / USERNAME</label>
                  <input type="text" required placeholder="e.g. DELTA_CHIEF" value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-blue-500 uppercase font-bold" />
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-[9px] font-bold text-slate-200 uppercase block tracking-wider">EMAIL COMM VECTOR</label>
                <input type="email" required placeholder="name@domain.com" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[9px] font-bold text-slate-200 uppercase block tracking-wider">SECURE PASSKEY</label>
                <input type="password" required placeholder="••••••••" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-blue-500" />
              </div>
              {authActionError && <p className="text-rose-400 text-[10px] text-center uppercase tracking-wide bg-rose-950/20 border border-rose-900/40 p-2 rounded-lg">⚠️ {authActionError}</p>}
              <button type="submit" disabled={authActionLoading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold uppercase tracking-widest py-3.5 px-4 rounded-xl transition-all disabled:opacity-50">{authActionLoading ? 'PROCESSING MATRIX...' : isSignUpMode ? 'GENERATE OVERRIDE KEY' : 'VERIFY SYSTEM ACCESS'}</button>
            </form>

            <div className="border-t border-slate-800 pt-4 flex flex-col space-y-3 text-[10px] text-center">
              <button type="button" onClick={() => { setIsSignUpMode(!isSignUpMode); setAuthActionError(''); }} className="text-blue-400 hover:underline uppercase bg-transparent border-0 cursor-pointer font-bold">{isSignUpMode ? '[Switch to Returning Log In]' : '[Request New Handler Enlistment]'}</button>
              <button type="button" onClick={() => setIsAuthModalOpen(false)} className="text-slate-400 hover:text-slate-200 uppercase bg-transparent border-0 cursor-pointer tracking-wider text-[9px]">[Cancel Request]</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}