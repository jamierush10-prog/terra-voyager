import { useState, useEffect } from 'react';
import { db, storage } from '../firebase/config';
import { collection, onSnapshot, doc, setDoc, query, where, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import dynamic from 'next/dynamic';
import Link from 'next/link';

const MapContainer = dynamic(() => import('react-leaflet').then((mod) => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then((mod) => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then((mod) => mod.Marker), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then((mod) => mod.Popup), { ssr: false });

export default function Home() {
  const [activeVessels, setActiveVessels] = useState<Record<string, any>>({});
  const [telemetryLogs, setTelemetryLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // AUTH STATES
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // MODAL STATES
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authUsername, setAuthUsername] = useState('');
  const [authActionLoading, setAuthActionLoading] = useState(false);
  const [authActionError, setAuthActionError] = useState('');

  const [isLaunchModalOpen, setIsLaunchModalOpen] = useState(false);
  const [launchVoyagerId, setLaunchVoyagerId] = useState('');
  const [launchOriginCity, setLaunchOriginCity] = useState('');
  const [launchLifecycleTarget, setLaunchLifecycleTarget] = useState('21'); 
  const [launchLatitude, setLaunchLatitude] = useState('');
  const [launchLongitude, setLaunchLongitude] = useState('');
  const [launchImageFile, setLaunchImageFile] = useState<File | null>(null);
  const [launchingAction, setLaunchingAction] = useState(false);
  const [launchError, setLaunchError] = useState('');

  useEffect(() => {
    const mCollection = collection(db, 'voyagerMissions');
    const unsubscribeVessels = onSnapshot(mCollection, (snapshot) => {
      const vesselMap: Record<string, any> = {};
      snapshot.forEach((doc) => {
        const data = doc.data();
        vesselMap[doc.id.toUpperCase()] = { id: doc.id, ...data };
      });
      setActiveVessels(vesselMap);
    });
    return () => unsubscribeVessels();
  }, []);

  useEffect(() => {
    const logsCollection = collection(db, 'telemetryLogs');
    const unsubscribeLogs = onSnapshot(logsCollection, (snapshot) => {
      const logsList: any[] = [];
      snapshot.forEach((doc) => {
        logsList.push({ id: doc.id, ...doc.data() });
      });
      setTelemetryLogs(logsList);
      setLoading(false);
    });
    return () => unsubscribeLogs();
  }, []);

  useEffect(() => {
    const auth = getAuth();
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        const usersCollection = collection(db, 'users');
        const qProfile = query(usersCollection, where('uid', '==', user.uid));
        getDocs(qProfile).then((snap) => {
          if (!snap.empty) setUserProfile(snap.docs[0].data());
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

  const fleetRegistryIds = Array.from({ length: 100 }, (_, i) => {
    return `TV-${String(i + 1).padStart(2, '0')}`;
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
          username: authUsername.trim().toUpperCase(),
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
      setAuthActionError('Clearance criteria rejected or invalid parameters.');
    } finally {
      setAuthActionLoading(false);
    }
  };

  const processVesselStats = (vesselId: string, baselineData: any) => {
    if (!baselineData) return { count: 0, target: 21, isMissing: false, isComplete: false, lastPin: null };

    const targetLimit = parseInt(baselineData.lifecycleTarget) || 21;
    const vesselLogs = telemetryLogs
      .filter(log => log.voyagerId && log.voyagerId.toUpperCase() === vesselId.toUpperCase())
      .sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));

    let totalCheckins = 0;
    let currentTimeMs = new Date().getTime();
    let lastEventTimeMs = baselineData.launchDate ? new Date(baselineData.launchDate).getTime() : currentTimeMs;
    
    let currentLat = parseFloat(baselineData.latitude);
    let currentLng = parseFloat(baselineData.longitude);
    let label = `PROLOGUE LAYER: ${baselineData.originCity}`;

    vesselLogs.forEach((log) => {
      const logTimeMs = log.timestamp?.toDate ? log.timestamp.toDate().getTime() : new Date(log.timestamp).getTime();
      
      while (logTimeMs - lastEventTimeMs > 30 * 24 * 60 * 60 * 1000) {
        totalCheckins++;
        lastEventTimeMs += 30 * 24 * 60 * 60 * 1000;
      }

      if (!log.isLaunchPad) {
        totalCheckins++;
      }
      
      lastEventTimeMs = logTimeMs;
      const pLat = parseFloat(log.latitude);
      const pLng = parseFloat(log.longitude);
      if (!isNaN(pLat) && !isNaN(pLng)) {
        currentLat = pLat;
        currentLng = pLng;
        label = log.reportedLocation || 'JOURNAL ENTRY';
      }
    });

    while (currentTimeMs - lastEventTimeMs > 30 * 24 * 60 * 60 * 1000) {
      totalCheckins++;
      lastEventTimeMs += 30 * 24 * 60 * 60 * 1000;
    }

    const timeSinceLastEvent = currentTimeMs - lastEventTimeMs;
    const isMissing = timeSinceLastEvent > (25 * 24 * 60 * 60 * 1000) && totalCheckins < targetLimit;

    return {
      count: totalCheckins,
      target: targetLimit,
      isMissing,
      isComplete: totalCheckins >= targetLimit,
      lastPin: { lat: currentLat, lng: currentLng, label }
    };
  };

  const handleLaunchNewVessel = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetVesselId = launchVoyagerId.trim().toUpperCase();
    const cleanTargetLimit = parseInt(launchLifecycleTarget.trim()) || 21;
    if (!targetVesselId || !launchOriginCity.trim()) return;

    setLaunchingAction(true);
    let finalOriginText = launchOriginCity.trim().toUpperCase();
    let finalLat = launchLatitude.trim();
    let finalLng = launchLongitude.trim();
    let uploadedImageUrl = '';

    const isZipCode = /^\d{5}$/.test(launchOriginCity.trim());
    if (isZipCode) {
      try {
        const geoResponse = await fetch(`https://nominatim.openstreetmap.org/search?postalcode=${launchOriginCity.trim()}&country=USA&format=json&addressdetails=1`);
        const geoData = await geoResponse.json();
        if (geoData && geoData.length > 0) {
          finalLat = geoData[0].lat;
          finalLng = geoData[0].lon;
          const addr = geoData[0].address;
          finalOriginText = `${(addr.city || addr.town || addr.county).toUpperCase()}, ${addr.state ? addr.state.toUpperCase() : 'USA'}`;
        }
      } catch (err) { console.error(err); }
    }

    try {
      if (launchImageFile) {
        const storageRef = ref(storage, `launches/${targetVesselId}_${launchImageFile.name}`);
        const uploadSnapshot = await uploadBytes(storageRef, launchImageFile);
        uploadedImageUrl = await getDownloadURL(uploadSnapshot.ref);
      }

      await setDoc(doc(db, 'voyagerMissions', targetVesselId), {
        missionId: targetVesselId,
        originCity: finalOriginText,
        lifecycleTarget: cleanTargetLimit, 
        latitude: finalLat,
        longitude: finalLng,
        launchImageUrl: uploadedImageUrl,
        launchDate: new Date().toISOString()
      });

      await setDoc(doc(collection(db, 'telemetryLogs')), {
        voyagerId: targetVesselId,
        handlerName: 'ARCHIVE CONSOLE',
        reportedLocation: `PROLOGUE LAYER: ${finalOriginText}`,
        latitude: finalLat,
        longitude: finalLng,
        imageUrl: uploadedImageUrl,
        timestamp: new Date(),
        verified: true,
        isLaunchPad: true
      });

      setLaunchOriginCity('');
      setLaunchLifecycleTarget('21');
      setLaunchLatitude('');
      setLaunchLongitude('');
      setLaunchImageFile(null);
      setIsLaunchModalOpen(false);
    } catch (err) { console.error(err); }
    setLaunchingAction(false);
  };

  const activeMapMarkers = Object.keys(activeVessels).map((id) => {
    const stats = processVesselStats(id, activeVessels[id]);
    return stats.lastPin ? { vesselId: id, ...stats.lastPin } : null;
  }).filter(Boolean);

  const isAdmin = userProfile?.role === 'admin';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col md:h-screen overflow-x-hidden relative">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />

      {/* FIXED HEADER WITH RIGID CLOSING TAG INTEGRATION */}
      <header className="p-4 border-b border-slate-900 bg-slate-900/40 backdrop-blur shrink-0 z-40 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-black tracking-widest text-slate-100 uppercase">THE TRAVELING JOURNAL PROJECT</h1>
          <p className="text-[10px] font-mono text-slate-300 uppercase tracking-widest font-bold mt-0.5">A Collective Chronicle of Shared Travels & Handwritten Stories</p>
        </div>
        <div className="font-mono text-[11px] uppercase tracking-wider">
          {authLoading ? (
            <span className="text-slate-400 animate-pulse">CONNECTING ARCHIVES...</span>
          ) : currentUser && userProfile ? (
            <div className="flex items-center space-x-4">
              <span className="text-white font-bold">CALLSIGN: <span className="text-blue-400 font-black">{userProfile.username}</span></span>
              {isAdmin && <Link href="/admin" className="text-emerald-400 font-black hover:underline">[EDIT CONTROL]</Link>}
              <button onClick={() => getAuth().signOut()} className="text-slate-300 font-bold hover:underline bg-transparent border-0 cursor-pointer p-0">[SIGN OUT]</button>
            </div>
          ) : (
            <button onClick={() => { setIsAuthModalOpen(true); }} className="text-blue-400 hover:underline font-black bg-transparent border-0 cursor-pointer p-0">[LOG IN TO HANDLER PORTAL]</button>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden relative z-10">
        <section className="w-full md:w-1/2 aspect-square md:aspect-auto md:h-full border-b md:border-b-0 md:border-r border-slate-900 bg-slate-950 relative shrink-0">
          <MapContainer center={[37.0902, -95.7129]} zoom={4} style={{ height: '100%', width: '100%', background: '#020617' }} zoomControl={false}>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
            {activeMapMarkers.map((pin: any) => (
              <Marker key={pin.vesselId} position={[pin.lat, pin.lng]}>
                <Popup>
                  <div className="text-slate-900 font-mono text-xs font-bold p-1">
                    <span className="text-blue-600 font-black block text-sm">{pin.vesselId}</span>
                    <span className="block mt-0.5 text-slate-700">Last entry: {pin.label}</span>
                    <Link href={`/mission/${pin.vesselId.toLowerCase()}`} className="text-blue-500 underline block mt-2 text-[11px] uppercase font-black">Open Volume Ledger →</Link>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </section>

        <section className="w-full md:w-1/2 flex flex-col h-auto md:h-full overflow-hidden bg-slate-900/10">
          <div className="p-4 border-b border-slate-900 bg-slate-950/80 backdrop-blur shrink-0 flex justify-between items-center">
            <h2 className="text-xs font-mono font-black text-slate-100 uppercase tracking-widest">VOLUME LIFE EXPEDITION REGISTRY</h2>
            <div className="flex items-center space-x-3 font-mono text-[9px] font-bold uppercase text-slate-300">
              <div className="flex items-center space-x-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 block"></span><span>Active Logs</span></div>
              <div className="flex items-center space-x-1"><span className="w-2.5 h-2.5 rounded-full bg-yellow-400 block"></span><span>MIA</span></div>
              <div className="flex items-center space-x-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 block"></span><span>Completed</span></div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 bg-slate-950/40">
            {loading ? (
              <div className="text-center py-12 font-mono text-xs text-slate-400 animate-pulse">READING VOLUME ARCHIVES...</div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2.5">
                {fleetRegistryIds.map((id) => {
                  const baseline = activeVessels[id];
                  const isDeployed = !!baseline;
                  const { count, target, isMissing, isComplete } = processVesselStats(id, baseline);

                  return isDeployed ? (
                    <Link 
                      key={id} href={`/mission/${id.toLowerCase()}`}
                      className={`border-2 rounded-xl p-2.5 text-center transition-all flex flex-col items-center justify-center cursor-pointer ${
                        isComplete ? 'bg-emerald-950/40 border-emerald-500 hover:bg-emerald-900/40 shadow-md' :
                        isMissing ? 'bg-yellow-950/40 border-yellow-500 hover:bg-yellow-950/70 shadow-md' :
                        'bg-blue-950/80 border-blue-500 hover:bg-blue-900 shadow-md'
                      }`}
                    >
                      <span className="text-[13px] font-mono font-black text-white tracking-wider">{id}</span>
                      <span className="text-[10px] font-mono font-bold text-slate-300">{count}/{target} pgs</span>
                    </Link>
                  ) : isAdmin ? (
                    <button 
                      key={id} onClick={() => { setLaunchVoyagerId(id); setIsLaunchModalOpen(true); }}
                      className="bg-slate-900/40 border border-slate-800 border-dashed hover:border-emerald-500 hover:bg-emerald-950/20 rounded-xl p-3 text-center flex flex-col items-center justify-center transition-all cursor-pointer group"
                    >
                      <span className="text-[12px] font-mono font-bold text-slate-500 group-hover:text-emerald-400">{id}</span>
                      <span className="text-[8px] font-mono font-black text-emerald-500 tracking-wider">[BIND]</span>
                    </button>
                  ) : (
                    <div key={id} className="bg-slate-900/10 border border-slate-900 rounded-xl p-3 text-center opacity-[0.15] select-none">
                      <span className="text-[12px] font-mono font-bold text-slate-500">{id}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* MODALS CONTAINMENT */}
      {isLaunchModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 font-mono">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl">
            <h3 className="text-sm font-black uppercase text-center text-white tracking-widest">BIND & DEPLOY JOURNAL VOLUME {launchVoyagerId}</h3>
            <form onSubmit={handleLaunchNewVessel} className="space-y-4 text-xs">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="text-[9px] font-bold text-slate-300 block mb-1 uppercase tracking-wider">Initial Prologue Location</label>
                  <input type="text" required placeholder="e.g. 36526" value={launchOriginCity} onChange={(e) => setLaunchOriginCity(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-bold focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-slate-300 block mb-1 uppercase tracking-wider">Page Target</label>
                  <input type="number" required min="1" max="110" value={launchLifecycleTarget} onChange={(e) => setLaunchLifecycleTarget(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-bold text-center focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="text" placeholder="LATITUDE (OPTIONAL)" value={launchLatitude} onChange={(e) => setLaunchLatitude(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-blue-500" />
                <input type="text" placeholder="LONGITUDE (OPTIONAL)" value={launchLongitude} onChange={(e) => setLaunchLongitude(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-[9px] font-bold text-slate-300 block mb-1 uppercase tracking-wider">Volume Cover Photo</label>
                <input type="file" accept="image/*" onChange={(e) => setLaunchImageFile(e.target.files?.[0] || null)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-slate-300 text-[11px] file:mr-3 file:py-1 file:px-2 file:rounded file:bg-slate-900 file:text-white file:border-0 file:text-[10px] file:uppercase file:font-bold hover:file:bg-slate-800 file:cursor-pointer" />
              </div>
              {launchError && <p className="text-rose-400 text-[10px] text-center uppercase bg-rose-950/20 border border-rose-900/40 p-2 rounded-lg">⚠️ {launchError}</p>}
              <button type="submit" className="w-full bg-emerald-600 py-3 rounded-xl font-black text-white uppercase tracking-widest">INITIALIZE VOLUME CHRONICLE</button>
            </form>
          </div>
        </div>
      )}

      {isAuthModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 font-mono">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl">
            <header className="text-center space-y-1">
              <h2 className="text-sm font-black uppercase text-white tracking-wider">{isSignUpMode ? 'Register Callsign' : 'Identity Verification'}</h2>
            </header>
            <form onSubmit={handleAuthAction} className="space-y-3">
              {isSignUpMode && <input type="text" required placeholder="CALLSIGN ID" value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white uppercase font-bold" />}
              <input type="email" required placeholder="EMAIL ADDR" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white" />
              <input type="password" required placeholder="PASSWORD KEY" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white" />
              {authActionError && <p className="text-rose-400 text-[10px] text-center bg-rose-950/20 border border-rose-900/40 p-2 rounded-lg">⚠️ {authActionError}</p>}
              <button type="submit" className="w-full bg-blue-600 py-3 rounded-xl font-black text-white uppercase">{isSignUpMode ? 'CREATE PROFILE' : 'VERIFY KEY'}</button>
            </form>
            <button type="button" onClick={() => setIsSignUpMode(!isSignUpMode)} className="w-full text-center text-blue-400 text-[10px] uppercase font-bold mt-2">
              {isSignUpMode ? '[Returning Handlers Log In]' : '[Enlist New Profile Key]'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}