import { useState, useEffect } from 'react';
import { db, storage } from '../firebase/config';
import { collection, onSnapshot, doc, setDoc, query, where, getDocs, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
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

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // ENTRANCE HUB & HYDRATION STATES
  const [isEntranceModalOpen, setIsEntranceModalOpen] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  
  const [isCheckinLookupOpen, setIsCheckinLookupOpen] = useState(false);
  const [lookupVoyagerId, setLookupVoyagerId] = useState('');
  const [lookupPasscode, setLookupPasscode] = useState('');
  const [lookupError, setLookupError] = useState('');

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
  const [launchLatitude, setLaunchLatitude] = useState('');
  const [launchLongitude, setLaunchLongitude] = useState('');
  const [launchPasscode, setLaunchPasscode] = useState('');
  const [launchImageFile, setLaunchImageFile] = useState<File | null>(null);
  const [launchingAction, setLaunchingAction] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const [isLaunchGpsActive, setIsLaunchGpsActive] = useState(false);

  // THIN RED MARKER PIN CONFIGURATION
  const [customRedIcon, setCustomRedIcon] = useState<any>(null);

  useEffect(() => {
    setHasHydrated(true);
    setIsEntranceModalOpen(true);

    const L = require('leaflet');
    const redPinInstance = new L.Icon({
      iconUrl: 'https://cdn-icons-png.flaticon.com/512/9131/9131546.png', 
      iconSize: [36, 36],
      iconAnchor: [18, 36], 
      popupAnchor: [0, -32],
    });
    setCustomRedIcon(redPinInstance);
  }, []);

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

  const handleRequestLaunchLocation = () => {
    if (typeof window !== 'undefined' && navigator.geolocation) {
      setLaunchError('REQUESTING LAUNCH POSITION CODES...');
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLaunchLatitude(position.coords.latitude.toString());
          setLaunchLongitude(position.coords.longitude.toString());
          setIsLaunchGpsActive(true);
          setLaunchError('GPS LAUNCH COORDINATES CAPTURED.');
        },
        (error) => {
          setIsLaunchGpsActive(false);
          setLaunchError('⚠️ LOCATION DENIED. PLEASE ENTER ZIP OR CITY MANUALLY.');
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    }
  };

  const handleExecuteCheckinRedirect = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = lookupVoyagerId.trim().toUpperCase();
    const enteredPass = lookupPasscode.trim();
    if (!targetId || !enteredPass) return;

    const missionDocRef = doc(db, 'voyagerMissions', targetId);
    try {
      setLookupError('VERIFYING HAND-HELD SECURITY VALUES...');
      const docSnap = await getDoc(missionDocRef);

      if (docSnap.exists()) {
        const missionData = docSnap.data();
        if (missionData.passcode && missionData.passcode === enteredPass) {
          setLookupError('');
          setLookupPasscode('');
          setLookupVoyagerId('');
          setIsCheckinLookupOpen(false);
          setIsEntranceModalOpen(false);
          router.push(`/mission/${targetId.toLowerCase()}/checkin?passKey=${encodeURIComponent(enteredPass)}`);
        } else {
          setLookupError('⚠️ SECURITY PASSCODE REJECTED. CHECK THE COVER PAGE.');
        }
      } else {
        setLookupError(`⚠️ VOLUME ${targetId} IS NOT DEPLOYED IN THE EXPEDITION REGISTRY.`);
      }
    } catch (err) {
      setLookupError('⚠️ SERVER LOG CONTEXT DISCONNECT. PLEASE TRY AGAIN.');
    }
  };

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
      setAuthActionError('Identification parameters rejected or invalid credentials.');
    } finally {
      setAuthActionLoading(false);
    }
  };

  const processVesselStats = (vesselId: string, baselineData: any) => {
    if (!baselineData) return { count: 0, lastPin: null };

    const vesselLogs = telemetryLogs
      .filter(log => log.voyagerId && log.voyagerId.toUpperCase() === vesselId.toUpperCase())
      .sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));

    const explicitPossessions = vesselLogs.filter(log => log.journalOptions?.tookPossession === true).length;
    
    let currentLat = parseFloat(String(baselineData.latitude));
    let currentLng = parseFloat(String(baselineData.longitude));
    let label = `LAUNCH LOCATION: ${baselineData.originCity}`;

    vesselLogs.forEach((log) => {
      const pLat = parseFloat(String(log.latitude));
      const pLng = parseFloat(String(log.longitude));
      if (!isNaN(pLat) && !isNaN(pLng)) {
        currentLat = pLat;
        currentLng = pLng;
        label = log.reportedLocation || 'JOURNAL ENTRY';
      }
    });

    if (isNaN(currentLat) || isNaN(currentLng)) {
      return { count: explicitPossessions, lastPin: null };
    }

    return {
      count: explicitPossessions,
      lastPin: { lat: currentLat, lng: currentLng, label }
    };
  };

  const handleLaunchNewVessel = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetVesselId = launchVoyagerId.trim().toUpperCase();
    const finalPasscode = launchPasscode.trim();
    if (!targetVesselId || !launchOriginCity.trim() || !finalPasscode) {
      setLaunchError('⚠️ ALL PARAMS INCLUDING PASSCODE REQUIREMENTS SECURED.');
      return;
    }

    setLaunchingAction(true);
    let finalOriginText = launchOriginCity.trim().toUpperCase();
    let finalLat = launchLatitude.trim();
    let finalLng = launchLongitude.trim();
    let uploadedImageUrl = '';

    const isZipCode = /^\d{5}$/.test(launchOriginCity.trim());
    if (isZipCode && !isLaunchGpsActive) {
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
        latitude: finalLat || '30.6035',
        longitude: finalLng || '-87.9011',
        launchImageUrl: uploadedImageUrl,
        launchDate: new Date().toISOString(),
        passcode: finalPasscode
      });

      await setDoc(doc(collection(db, 'telemetryLogs')), {
        voyagerId: targetVesselId,
        handlerName: 'LAUNCH BASE',
        reportedLocation: `LAUNCH LOCATION: ${finalOriginText}`,
        latitude: finalLat || '30.6035',
        longitude: finalLng || '-87.9011',
        imageUrl: uploadedImageUrl,
        timestamp: new Date(),
        verified: true,
        isLaunchPad: true,
        displayActionContext: `${targetVesselId} LAUNCHED`
      });

      setLaunchOriginCity('');
      setLaunchLatitude('');
      setLaunchLongitude('');
      setLaunchPasscode('');
      setLaunchImageFile(null);
      setIsLaunchGpsActive(false);
      setLaunchError('');
      setIsLaunchModalOpen(false);
    } catch (err) { console.error(err); }
    setLaunchingAction(false);
  };

  const activeMapMarkers = Object.keys(activeVessels)
    .map((id) => {
      const stats = processVesselStats(id, activeVessels[id]);
      if (stats.lastPin) {
        return { vesselId: id, ...stats.lastPin };
      }
      return null;
    })
    .filter((marker): marker is any => marker !== null);

  const isAdmin = userProfile?.role === 'admin';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col md:h-screen overflow-x-hidden relative">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />

      <header className="p-4 border-b border-slate-900 bg-slate-900/40 backdrop-blur shrink-0 z-40 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-black tracking-widest text-slate-100 uppercase">THE TRAVELING JOURNAL PROJECT</h1>
          <p className="text-[10px] font-mono text-slate-300 uppercase tracking-widest font-bold mt-0.5">A Collective Chronicle of Shared Travels & Handwritten Stories</p>
        </div>
        <div className="font-mono text-xs uppercase tracking-wider">
          {authLoading ? (
            <span className="text-slate-400 animate-pulse">CONNECTING ARCHIVES...</span>
          ) : currentUser && userProfile ? (
            <div className="flex items-center space-x-4">
              <span className="text-white font-black">{userProfile.username}</span>
              <Link href="/chat" className="text-blue-400 font-black hover:underline">[COMMUNICATIONS DECK]</Link>
              {isAdmin && <Link href="/admin" className="text-emerald-400 font-black hover:underline">[EDIT CONTROL]</Link>}
              <button onClick={() => getAuth().signOut()} className="text-slate-300 font-bold hover:underline bg-transparent border-0 cursor-pointer p-0">[SIGN OUT]</button>
            </div>
          ) : (
            <button onClick={() => { setIsSignUpMode(false); setAuthActionError(''); setIsAuthModalOpen(true); }} className="text-blue-400 hover:text-blue-300 font-black tracking-widest uppercase transition-all bg-transparent border-0 cursor-pointer p-0">Sign In</button>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden relative z-10">
        <section className="w-full md:w-1/2 aspect-square md:aspect-auto md:h-full border-b md:border-b-0 md:border-r border-slate-900 bg-slate-950 relative shrink-0">
          <MapContainer center={[37.0902, -95.7129]} zoom={4} style={{ height: '100%', width: '100%', background: '#020617' }} zoomControl={false}>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
            {activeMapMarkers.map((pin: any) => (
              <Marker key={pin.vesselId} position={[pin.lat, pin.lng]} icon={customRedIcon || undefined}>
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
              <div className="flex items-center space-x-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500 block"></span><span>Active Logs</span></div>
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
                  const { count } = processVesselStats(id, baseline);

                  return isDeployed ? (
                    <Link 
                      key={id} href={`/mission/${id.toLowerCase()}`}
                      className="border-2 rounded-xl p-2.5 text-center transition-all flex flex-col items-center justify-center cursor-pointer bg-blue-950/80 border-blue-500 hover:bg-blue-900 shadow-md"
                    >
                      <span className="text-[13px] font-mono font-black text-white tracking-wider">{id}</span>
                      <span className="text-[10px] font-mono font-bold text-slate-300">{count} transfer{count !== 1 ? 's' : ''}</span>
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

      {/* STABILIZED ENTRANCE SPLASH GATE INTERCEPTOR OVERLAY */}
      {hasHydrated && isEntranceModalOpen && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xl z-50 flex items-center justify-center p-4 font-mono">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800/80 rounded-3xl p-6 md:p-8 space-y-6 shadow-2xl text-center">
            <header className="space-y-2">
              <span className="text-3xl block">🌍</span>
              <h2 className="text-sm font-black uppercase text-white tracking-widest">THE TRAVELING JOURNAL</h2>
              <p className="text-[9px] text-slate-400 uppercase tracking-widest font-bold">Expedition Entry Matrix Terminal</p>
            </header>

            {!isCheckinLookupOpen ? (
              <div className="flex flex-col space-y-3">
                <button 
                  type="button" 
                  onClick={() => setIsEntranceModalOpen(false)}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold uppercase tracking-wider py-4 px-4 rounded-xl transition-all text-xs cursor-pointer text-center shadow-md border-0"
                >
                  Explore Project Overview
                </button>

                <button 
                  type="button" 
                  onClick={() => { setLookupError(''); setIsCheckinLookupOpen(true); }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest py-4 px-4 rounded-xl transition-all text-xs cursor-pointer text-center shadow-md border-0"
                >
                  Log TV Journal Check-In
                </button>

                <button 
                  type="button" 
                  onClick={() => { setIsEntranceModalOpen(false); setIsSignUpMode(true); setAuthActionError(''); setIsAuthModalOpen(true); }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold uppercase tracking-wider py-4 px-4 rounded-xl transition-all text-xs cursor-pointer text-center shadow-md border-0"
                >
                  Create a User Account
                </button>
              </div>
            ) : (
              <form onSubmit={handleExecuteCheckinRedirect} className="space-y-4 text-left">
                <div className="space-y-3">
                  <div>
                    <label className="text-[9px] font-black text-slate-400 block uppercase tracking-widest mb-1">Journal Code:</label>
                    <input type="text" required placeholder="E.G. TV-01" value={lookupVoyagerId} onChange={(e) => setLookupVoyagerId(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white uppercase text-center font-black tracking-widest focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-slate-400 block uppercase tracking-widest mb-1">Hand-Written Passcode:</label>
                    <input type="text" required placeholder="READ FROM INSIDE JOURNAL COVER" value={lookupPasscode} onChange={(e) => setLookupPasscode(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white text-center font-black focus:outline-none focus:border-blue-500 tracking-wide" />
                  </div>
                </div>
                {lookupError && <p className="text-rose-400 text-[9px] text-center uppercase font-black leading-normal">{lookupError}</p>}
                <div className="grid grid-cols-2 gap-2 pt-1 font-bold text-[10px]">
                  <button type="button" onClick={() => { setIsCheckinLookupOpen(false); setLookupVoyagerId(''); setLookupPasscode(''); setLookupError(''); }} className="w-full bg-slate-950 border border-slate-850 hover:bg-slate-900 text-slate-400 uppercase p-3 rounded-lg cursor-pointer text-center">[Back]</button>
                  <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white uppercase p-3 rounded-lg cursor-pointer text-center">Verify & Open →</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ADMIN LAUNCH ENTRY MODAL */}
      {isLaunchModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 font-mono">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl">
            <h3 className="text-sm font-black uppercase text-center text-white tracking-widest">BIND & DEPLOY JOURNAL VOLUME {launchVoyagerId}</h3>
            
            <div className="bg-slate-950/40 border border-slate-850 p-1 rounded-xl">
              <button type="button" onClick={handleRequestLaunchLocation} className={`w-full font-bold uppercase py-3 px-4 rounded-xl tracking-wider transition-all text-xs cursor-pointer border ${isLaunchGpsActive ? 'bg-blue-950/40 border-blue-500 text-blue-400' : 'bg-slate-950 border-slate-800 text-slate-200 hover:bg-slate-900'}`}>{isLaunchGpsActive ? '✓ LAUNCH COORDINATES LOCKED' : '📍 Use Current Device Location'}</button>
            </div>

            <form onSubmit={handleLaunchNewVessel} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-300 block mb-1 uppercase tracking-wider">Launch Location</label>
                  <input type="text" required placeholder="e.g. DAPHNE, AL" value={launchOriginCity} onChange={(e) => setLaunchOriginCity(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-bold focus:outline-none focus:border-blue-500 uppercase" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-300 block mb-1 uppercase tracking-wider">Secure Passcode</label>
                  <input type="text" required placeholder="e.g. PISTON2026" value={launchPasscode} onChange={(e) => setLaunchPasscode(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-black tracking-wide focus:outline-none focus:border-blue-500" />
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
              {launchError && <p className="text-blue-400 text-[10px] text-center uppercase bg-blue-950/20 border border-blue-900/30 p-2.5 rounded-xl">📌 {launchError}</p>}
              <button type="submit" disabled={launchingAction} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-widest py-3.5 px-4 rounded-xl disabled:opacity-50 cursor-pointer">{launchingAction ? 'INITIALIZING CHRONICLE LAYER...' : 'INITIALIZE VOLUME CHRONICLE'}</button>
            </form>
          </div>
        </div>
      )}

      {isAuthModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 font-mono">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-2xl relative">
            <header className="text-center space-y-1.5">
              <h2 className="text-sm font-black uppercase text-white tracking-wider">{isSignUpMode ? 'Create Account' : 'Identity Verification'}</h2>
              <p className="text-[9px] text-slate-400 uppercase tracking-wider">{isSignUpMode ? 'Register profile codes' : 'Input verification passkey'}</p>
            </header>
            <form onSubmit={handleAuthAction} className="space-y-4">
              {isSignUpMode && (
                <input type="text" required placeholder="CHOOSE USERNAME" value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white uppercase font-bold text-center focus:outline-none focus:border-blue-500" />
              )}
              <input type="email" required placeholder="EMAIL ADDR" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-blue-500" />
              <input type="password" required placeholder="PASSWORD KEY" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-blue-500" />
              {authActionError && <p className="text-rose-400 text-[10px] text-center uppercase tracking-wide bg-rose-950/20 border border-rose-900/40 p-2 rounded-lg">⚠️ {authActionError}</p>}
              <button type="submit" disabled={authActionLoading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold uppercase tracking-widest py-3.5 px-4 rounded-xl transition-all disabled:opacity-50 cursor-pointer">{authActionLoading ? 'PROCESSING...' : isSignUpMode ? 'CREATE PROFILE' : 'VERIFY KEY'}</button>
            </form>
            <div className="border-t border-slate-800 pt-4 flex flex-col space-y-2 text-[10px] text-center">
              <button type="button" onClick={() => { setIsSignUpMode(!isSignUpMode); setAuthActionError(''); }} className="text-blue-400 hover:underline uppercase bg-transparent border-0 cursor-pointer font-bold">{isSignUpMode ? '[Returning Handlers Log In]' : 'Create an account to follow the journal\'s travel'}</button>
              <button type="button" onClick={() => setIsAuthModalOpen(false)} className="text-slate-400 hover:text-slate-200 uppercase bg-transparent border-0 cursor-pointer tracking-wider text-[9px]">[Cancel]</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}