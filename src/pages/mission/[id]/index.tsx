import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
import { db, storage } from '../../firebase/config';
import { doc, getDoc, collection, query, where, onSnapshot, setDoc, addDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import dynamic from 'next/dynamic';
import Link from 'next/link';

const MapContainer = dynamic(() => import('react-leaflet').then((mod) => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then((mod) => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then((mod) => mod.Marker), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then((mod) => mod.Popup), { ssr: false });
const Polyline = dynamic(() => import('react-leaflet').then((mod) => mod.Polyline), { ssr: false });

export default function MissionControl() {
  const router = useRouter();
  const { id } = router.query;
  const uppercaseId = id ? id.toString().toUpperCase() : '';

  const [vesselData, setVesselData] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // AUTH STATES
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);

  // FORM INPUTS
  const [handlerName, setHandlerName] = useState('');
  const [reportedLocation, setReportedLocation] = useState('');
  const [inputLat, setInputLat] = useState('');
  const [inputLng, setInputLng] = useState('');
  const [logImage, setLogImage] = useState<File | null>(null);
  const [submittingLog, setSubmittingLog] = useState(false);

  // MIA MANUAL SWITCH INPUTS
  const [miaDate, setMiaDate] = useState('');
  const [submittingMia, setSubmittingMia] = useState(false);

  useEffect(() => {
    if (!uppercaseId) return;

    const vRef = doc(db, 'voyagerMissions', uppercaseId);
    getDoc(vRef).then((snap) => {
      if (snap.exists()) {
        setVesselData(snap.data());
      }
    });

    const logsCollection = collection(db, 'telemetryLogs');
    const q = query(logsCollection, where('voyagerId', '==', uppercaseId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logsList: any[] = [];
      snapshot.forEach((doc) => {
        logsList.push({ id: doc.id, ...doc.data() });
      });
      // Order entries from earliest prologue to newest page
      logsList.sort((a, b) => {
        const tA = a.timestamp?.seconds || 0;
        const tB = b.timestamp?.seconds || 0;
        return tA - tB;
      });
      setLogs(logsList);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [uppercaseId]);

  useEffect(() => {
    const auth = getAuth();
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        const usersCollection = collection(db, 'users');
        const qProfile = query(usersCollection, where('uid', '==', user.uid));
        getDocs(qProfile).then((snap) => {
          if (!snap.empty) setUserProfile(snap.docs[0].data());
        });
      } else {
        setCurrentUser(null);
        setUserProfile(null);
      }
    });
    return () => unsubscribeAuth();
  }, []);

  // Helper helper to pull user document snapshot async
  async function getDocs(q: any) {
    const s = await getDoc(q.toDevRef ? q.toDevRef() : doc(db, 'users', 'null'));
    return { empty: true, docs: [] as any[] }; 
  }

  // RE-INJECTING EXPLICIT FIRESTORE FALLBACK READER FOR PROFILE OVERRIDES
  useEffect(() => {
    if (currentUser) {
      getDocsForProfile(currentUser.uid);
    }
  }, [currentUser]);

  async function getDocsForProfile(uid: string) {
    try {
      const snap = await getDocs(query(collection(db, 'users'), where('uid', '==', uid)));
      const usersCollection = collection(db, 'users');
      const qProfile = query(usersCollection, where('uid', '==', uid));
      const res = await getDoc(doc(db, 'users', uid));
      if (res.exists()) setUserProfile(res.data());
    } catch(e){}
  }

  // COMPUTE CHRONICLE TIMELINE METRICS (COORDINATING INDIVIDUAL HANDWRITTEN PAGES vs MIA system SWITCHES)
  const computeComprehensiveJourneyStats = () => {
    if (!vesselData) return { totalCheckins: 0, currentLat: 37, currentLng: -95, displacementMiles: 0, cumulativeMiles: 0, timeline: [] as any[], isMiaActive: false };

    const targetLimit = parseInt(vesselData.lifecycleTarget) || 21;
    let baselineLat = parseFloat(vesselData.latitude) || 37.0902;
    let baselineLng = parseFloat(vesselData.longitude) || -95.7129;

    let processedTimeline: any[] = [];
    let totalCheckins = 0;
    let cumulativeMiles = 0;

    let currentLat = baselineLat;
    let currentLng = baselineLng;

    let currentTimeMs = new Date().getTime();
    let lastEventTimeMs = vesselData.launchDate ? new Date(vesselData.launchDate).getTime() : currentTimeMs;

    // Seed Initial Entry
    processedTimeline.push({
      type: 'PROLOGUE',
      handlerName: 'ARCHIVE BASE',
      reportedLocation: `VOLUME LOG SEED: ${vesselData.originCity}`,
      timestamp: vesselData.launchDate ? new Date(vesselData.launchDate) : new Date(),
      latitude: baselineLat,
      longitude: baselineLng,
      imageUrl: vesselData.launchImageUrl || ''
    });

    const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 3958.8; // Radius of Earth in Miles
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(sqrt(a), sqrt(1 - a));
      return R * c;
    };
    function sqrt(val: number) { return Math.sqrt(val); }

    // Interleave explicit manual log updates with structural time gaps
    logs.forEach((log) => {
      if (log.isLaunchPad) return; // Already handled by baseline prologue

      const logTimeMs = log.timestamp?.toDate ? log.timestamp.toDate().getTime() : new Date(log.timestamp).getTime();

      while (logTimeMs - lastEventTimeMs > 30 * 24 * 60 * 60 * 1000) {
        totalCheckins++;
        const simulatedTime = new Date(lastEventTimeMs + 30 * 24 * 60 * 60 * 1000);
        processedTimeline.push({
          type: 'MIA_SWITCH',
          handlerName: 'SYSTEM TIMEOUT',
          reportedLocation: 'MIA OVERRIDE WAYPOINT',
          timestamp: simulatedTime,
          latitude: currentLat,
          longitude: currentLng
        });
        lastEventTimeMs += 30 * 24 * 60 * 60 * 1000;
      }

      totalCheckins++;
      const pLat = parseFloat(log.latitude);
      const pLng = parseFloat(log.longitude);

      if (!isNaN(pLat) && !isNaN(pLng)) {
        const legDistance = haversineDistance(currentLat, currentLng, pLat, pLng);
        cumulativeMiles += legDistance;
        currentLat = pLat;
        currentLng = pLng;
      }

      processedTimeline.push({
        type: 'HANDLER_ENTRY',
        handlerName: log.handlerName || 'ANONYMOUS AUTHOR',
        reportedLocation: log.reportedLocation || 'LOCAL ROAD WAYPOINT',
        timestamp: log.timestamp?.toDate ? log.timestamp.toDate() : new Date(log.timestamp),
        latitude: pLat,
        longitude: pLng,
        imageUrl: log.imageUrl || ''
      });

      lastEventTimeMs = logTimeMs;
    });

    while (currentTimeMs - lastEventTimeMs > 30 * 24 * 60 * 60 * 1000) {
      totalCheckins++;
      const simulatedTime = new Date(lastEventTimeMs + 30 * 24 * 60 * 60 * 1000);
      processedTimeline.push({
        type: 'MIA_SWITCH',
        handlerName: 'SYSTEM TIMEOUT',
        reportedLocation: 'MIA OVERRIDE WAYPOINT',
        timestamp: simulatedTime,
        latitude: currentLat,
        longitude: currentLng
      });
      lastEventTimeMs += 30 * 24 * 60 * 60 * 1000;
    }

    const displacementMiles = haversineDistance(baselineLat, baselineLng, currentLat, currentLng);
    const timeSinceLastEvent = currentTimeMs - lastEventTimeMs;
    const isMiaActive = timeSinceLastEvent > (25 * 24 * 60 * 60 * 1000) && totalCheckins < targetLimit;

    return {
      totalCheckins,
      currentLat,
      currentLng,
      displacementMiles,
      cumulativeMiles,
      timeline: processedTimeline,
      isMiaActive
    };
  };

  const stats = computeComprehensiveJourneyStats();
  const isAdmin = userProfile?.role === 'admin';

  // SUBMIT MANUALLY SCANNED HANDWRITTEN LOG PAGE
  const handleAddJournalEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportedLocation.trim() || !handlerName.trim()) return;

    setSubmittingLog(true);
    let finalLat = inputLat.trim();
    let finalLng = inputLng.trim();
    let uploadedImageUrl = '';

    const isZipCode = /^\d{5}$/.test(reportedLocation.trim());
    if (isZipCode && (!finalLat || !finalLng)) {
      try {
        const geoResponse = await fetch(`https://nominatim.openstreetmap.org/search?postalcode=${reportedLocation.trim()}&country=USA&format=json`);
        const geoData = await geoResponse.json();
        if (geoData && geoData.length > 0) {
          finalLat = geoData[0].lat;
          finalLng = geoData[0].lon;
        }
      } catch (err) { console.error(err); }
    }

    try {
      if (logImage) {
        const storageRef = ref(storage, `journals/${uppercaseId}_${Date.now()}_${logImage.name}`);
        const uploadSnapshot = await uploadBytes(storageRef, logImage);
        uploadedImageUrl = await getDownloadURL(uploadSnapshot.ref);
      }

      await addDoc(collection(db, 'telemetryLogs'), {
        voyagerId: uppercaseId,
        handlerName: handlerName.trim().toUpperCase(),
        reportedLocation: reportedLocation.trim().toUpperCase(),
        latitude: finalLat,
        longitude: finalLng,
        imageUrl: uploadedImageUrl,
        timestamp: new Date(),
        verified: true
      });

      setHandlerName('');
      setReportedLocation('');
      setInputLat('');
      setInputLng('');
      setLogImage(null);
    } catch (err) { console.error(err); }
    setSubmittingLog(false);
  };

  // ADMIN OVERRIDE TO FORCE ARCHIVE INTERVALLING GAPS MANUALLY
  const handleForceArchiveInterval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!miaDate || !isAdmin) return;
    setSubmittingMia(true);

    try {
      await addDoc(collection(db, 'telemetryLogs'), {
        voyagerId: uppercaseId,
        handlerName: 'MANUAL LEDGER ADJUSTMENT',
        reportedLocation: 'MIA OVERRIDE WAYPOINT',
        latitude: stats.currentLat.toString(),
        longitude: stats.currentLng.toString(),
        imageUrl: '',
        timestamp: new Date(miaDate),
        verified: true,
        forcedMiaMarker: true
      });
      setMiaDate('');
    } catch (err) { console.error(err); }
    setSubmittingMia(false);
  };

  // Build sequential polyline mapping path from historical coordinates
  const pathCoordinates = stats.timeline
    .map((evt) => {
      const lat = parseFloat(evt.latitude);
      const lng = parseFloat(evt.longitude);
      return !isNaN(lat) && !isNaN(lng) ? [lat, lng] : null;
    })
    .filter(Boolean) as [number, number][];

  if (loading || !vesselData) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-mono flex items-center justify-center text-xs animate-pulse">
        RETRIEVING BINDING RECORDS & LEDGER FILE {uppercaseId}...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col md:h-screen overflow-x-hidden relative">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />

      {/* HEADER DECK */}
      <header className="p-4 border-b border-slate-900 bg-slate-900/40 backdrop-blur shrink-0 z-40 flex justify-between items-center">
        <div>
          <div className="flex items-center space-x-2">
            <Link href="/" className="text-[10px] font-mono font-black text-blue-400 hover:underline tracking-widest uppercase">← INDEX DECK</Link>
            <span className="text-slate-700 text-[10px] font-mono">/</span>
            <h1 className="text-sm font-mono font-black tracking-widest text-slate-100 uppercase">VOLUME CHRONICLE: {uppercaseId}</h1>
          </div>
          <p className="text-[9px] font-mono text-slate-400 uppercase tracking-widest font-bold mt-1">
            Current Placement: {stats.timeline[stats.timeline.length - 1]?.reportedLocation || 'UNKNOWN'}
          </p>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-wider flex items-center space-x-3">
          {stats.isMiaActive ? (
            <span className="bg-yellow-950 text-yellow-400 border border-yellow-800 px-2.5 py-1 rounded-full font-black animate-pulse">STATUS: MIA STALLED</span>
          ) : stats.totalCheckins >= (parseInt(vesselData.lifecycleTarget) || 21) ? (
            <span className="bg-emerald-950 text-emerald-400 border border-emerald-800 px-2.5 py-1 rounded-full font-black">STATUS: ACCOMPLISHED</span>
          ) : (
            <span className="bg-blue-950 text-blue-400 border border-blue-800 px-2.5 py-1 rounded-full font-black">STATUS: ACTIVE</span>
          )}
        </div>
      </header>

      {/* TWO-COLUMN JOURNAL LAYOUT */}
      <main className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden relative z-10">
        
        {/* LEFT COLUMN: METADATA, MAPS & CALCULATIONS */}
        <section className="w-full md:w-5/12 border-b md:border-b-0 md:border-r border-slate-900 flex flex-col h-auto md:h-full bg-slate-950 overflow-y-auto custom-scrollbar">
          
          {/* GEOGRAPHIC ROUTE MAP */}
          <div className="w-full aspect-[16/10] bg-slate-950 border-b border-slate-900 relative shrink-0">
            <MapContainer center={[stats.currentLat, stats.currentLng]} zoom={5} style={{ height: '100%', width: '100%', background: '#020617' }} zoomControl={false}>
              <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
              {pathCoordinates.length > 1 && <Polyline positions={pathCoordinates} color="#3b82f6" weight={2} dashArray="4, 6" />}
              {stats.timeline.map((evt, idx) => {
                const lat = parseFloat(evt.latitude);
                const lng = parseFloat(evt.longitude);
                if (isNaN(lat) || !isNaN(lng)) return null; // safety wrap
                return (
                  <Marker key={idx} position={[lat, lng]}>
                    <Popup>
                      <div className="text-slate-900 font-mono text-[11px] font-bold p-0.5">
                        <span className="text-blue-600 block uppercase font-black">{evt.handlerName}</span>
                        <span className="block mt-0.5 text-slate-700">{evt.reportedLocation}</span>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          </div>

          <div className="p-5 space-y-6 flex-1">
            {/* VOLUME PROLOGUE LAYOUT */}
            <div className="bg-slate-900/30 border border-slate-900 rounded-2xl p-4 space-y-3">
              <h3 className="text-[10px] font-mono font-black uppercase text-slate-400 tracking-widest border-b border-slate-900 pb-2">Volume Prologue Origins</h3>
              <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                <div>
                  <span className="text-slate-500 block text-[9px] uppercase tracking-wider">Initial Launch Spot</span>
                  <span className="font-bold text-white uppercase">{vesselData.originCity}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[9px] uppercase tracking-wider">Binding Handshake Date</span>
                  <span className="font-bold text-white">{vesselData.launchDate ? new Date(vesselData.launchDate).toLocaleDateString() : 'N/A'}</span>
                </div>
              </div>
              {vesselData.launchImageUrl && (
                <div className="mt-3 border border-slate-800 rounded-xl overflow-hidden aspect-[16/10] bg-slate-950 relative">
                  <img src={vesselData.launchImageUrl} alt="Volume Cover" className="object-cover w-full h-full" />
                </div>
              )}
            </div>

            {/* CHRONICLE MILEAGE LEDGER */}
            <div className="bg-slate-900/30 border border-slate-900 rounded-2xl p-4 space-y-4">
              <h3 className="text-[10px] font-mono font-black uppercase text-slate-400 tracking-widest border-b border-slate-900 pb-2">Chronicle Mileage Ledger</h3>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="bg-slate-950/60 border border-slate-900 p-3 rounded-xl">
                  <span className="text-[9px] font-mono font-bold text-slate-500 block uppercase tracking-wider mb-0.5">Absolute Displacement</span>
                  <span className="text-base font-mono font-black text-blue-400">{stats.displacementMiles.toFixed(1)} <span className="text-[10px] text-slate-400">mi</span></span>
                </div>
                <div className="bg-slate-950/60 border border-slate-900 p-3 rounded-xl">
                  <span className="text-[9px] font-mono font-bold text-slate-500 block uppercase tracking-wider mb-0.5">Cumulative Distance</span>
                  <span className="text-base font-mono font-black text-emerald-400">{stats.cumulativeMiles.toFixed(1)} <span className="text-[10px] text-slate-400">mi</span></span>
                </div>
              </div>
              <div className="bg-slate-950/60 border border-slate-900 p-3.5 rounded-xl flex justify-between items-center text-xs font-mono">
                <div>
                  <span className="text-slate-400 font-bold block uppercase text-[10px] tracking-wide">Folio Page Progress Counter</span>
                  <span className="text-[10px] text-slate-500 mt-0.5 block">Combined handwritten pages + system timeouts</span>
                </div>
                <div className="text-right">
                  <span className="text-lg font-black text-white">{stats.totalCheckins}</span>
                  <span className="text-slate-500 font-bold"> / {vesselData.lifecycleTarget || 21}</span>
                </div>
              </div>
            </div>

            {/* ARCHIVE INTERVAL LOG OVERRIDE (ADMIN ONLY) */}
            {isAdmin && (
              <div className="bg-rose-950/10 border border-rose-950/60 rounded-2xl p-4 space-y-3 font-mono">
                <h3 className="text-[10px] font-black uppercase text-rose-400 tracking-widest">Archive Interval Log Override</h3>
                <p className="text-[10px] text-slate-400 leading-relaxed">Inject a forced historical interval log checkpoint into the ledger track database.</p>
                <form onSubmit={handleForceArchiveInterval} className="flex gap-2 items-center pt-1">
                  <input type="datetime-local" required value={miaDate} onChange={(e) => setMiaDate(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white focus:outline-none focus:border-rose-500 flex-1" />
                  <button type="submit" disabled={submittingMia} className="bg-rose-900 hover:bg-rose-800 text-white font-black uppercase text-[10px] tracking-wider px-4 py-2.5 rounded-xl transition-all disabled:opacity-40 shrink-0 cursor-pointer">
                    {submittingMia ? 'STORING...' : 'COMMIT INTERMISSION'}
                  </button>
                </form>
              </div>
            )}
          </div>
        </section>

        {/* RIGHT COLUMN: JOURNAL RECORD LOG STREAM & ENTRY INPUT */}
        <section className="w-full md:w-7/12 flex flex-col h-auto md:h-full bg-slate-900/10 overflow-hidden">
          
          {/* NEW CHRONICLE ENTRY SUBMISSION TERMINAL */}
          <div className="p-5 border-b border-slate-900 bg-slate-950/90 backdrop-blur shrink-0 space-y-3.5">
            <h2 className="text-[10px] font-mono font-black text-slate-300 uppercase tracking-widest">RECORD NEW VERIFIED CHRONICLE PAGE</h2>
            <form onSubmit={handleAddJournalEntry} className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs">
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-500 uppercase block tracking-wider">Handler Signature Name</label>
                <input type="text" required placeholder="e.g. AUTHOR CALLSIGN" value={handlerName} onChange={(e) => setHandlerName(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white placeholder-slate-700 font-bold uppercase focus:outline-none focus:border-blue-500" />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-500 uppercase block tracking-wider">Current Location / Zip Code</label>
                <input type="text" required placeholder="e.g. 36608 or Mobile, AL" value={reportedLocation} onChange={(e) => setReportedLocation(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white placeholder-slate-700 font-bold uppercase focus:outline-none focus:border-blue-500" />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-500 uppercase block tracking-wider">Folio Page Copy Upload</label>
                <input type="file" accept="image/*" onChange={(e) => setLogImage(e.target.files?.[0] || null)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-1.5 text-slate-400 file:mr-2 file:py-1 file:px-2 file:rounded file:bg-slate-900 file:text-white file:border-0 file:text-[9px] file:uppercase file:font-black hover:file:bg-slate-800 file:cursor-pointer" />
              </div>
              <div className="sm:col-span-3 grid grid-cols-2 sm:grid-cols-4 gap-2 items-center pt-1">
                <input type="text" placeholder="LATITUDE (OPTIONAL)" value={inputLat} onChange={(e) => setInputLat(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-xl p-2 text-slate-300 focus:outline-none focus:border-blue-500" />
                <input type="text" placeholder="LONGITUDE (OPTIONAL)" value={inputLng} onChange={(e) => setInputLng(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-xl p-2 text-slate-300 focus:outline-none focus:border-blue-500" />
                <div className="col-span-2 sm:text-right">
                  <button type="submit" disabled={submittingLog} className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 font-black uppercase tracking-widest text-white px-6 py-2.5 rounded-xl transition-all disabled:opacity-40 shadow-md cursor-pointer">
                    {submittingLog ? 'INKING PAGES TO RECORD...' : 'AUTHENTICATE & LOG FOLIO PAGE'}
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* CHRONICLE LOG HISTORY STREAM */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
            <h3 className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest">HAND-INKED ENTRY LOG CHRONICLES</h3>
            
            {stats.timeline.length === 0 ? (
              <div className="text-center font-mono text-xs text-slate-600 py-12 uppercase tracking-wide">No entry nodes found in database logs.</div>
            ) : (
              <div className="space-y-3 font-mono">
                {stats.timeline.map((event: any, index: number) => {
                  const isPrologue = event.type === 'PROLOGUE';
                  const isMia = event.type === 'MIA_SWITCH';

                  return (
                    <div 
                      key={index} 
                      className={`border rounded-2xl p-4 flex flex-col sm:flex-row gap-4 items-start transition-all shadow-sm ${
                        isPrologue ? 'bg-slate-900/60 border-blue-900/60' :
                        isMia ? 'bg-yellow-950/20 border-yellow-900/40 opacity-75' :
                        'bg-slate-950 border-slate-900 hover:border-slate-800'
                      }`}
                    >
                      {/* Entry Metadata Block */}
                      <div className="flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-md uppercase bg-slate-900 text-slate-300 border border-slate-800">
                            Folio #{index}
                          </span>
                          <span className={`text-[10px] font-black uppercase ${isPrologue ? 'text-blue-400' : isMia ? 'text-yellow-500' : 'text-slate-200'}`}>
                            {event.handlerName}
                          </span>
                          <span className="text-slate-700 text-[10px]">•</span>
                          <span className="text-slate-500 text-[10px] font-bold">
                            {event.timestamp ? new Date(event.timestamp).toLocaleString() : 'DATETIME UNKNOWN'}
                          </span>
                        </div>

                        <div className="text-xs">
                          <span className="text-slate-400 font-bold block uppercase text-[9px] tracking-wider mb-0.5">Reported Location Node</span>
                          <span className="text-white font-black uppercase tracking-wide">{event.reportedLocation}</span>
                        </div>

                        <div className="text-[10px] text-slate-500 flex space-x-3">
                          <span>LAT: <span className="text-slate-400 font-bold">{parseFloat(event.latitude).toFixed(4)}</span></span>
                          <span>LNG: <span className="text-slate-400 font-bold">{parseFloat(event.longitude).toFixed(4)}</span></span>
                        </div>
                      </div>

                      {/* Handwritten folio page visual anchor */}
                      {event.imageUrl && (
                        <div className="w-full sm:w-32 aspect-[4/3] sm:aspect-square bg-slate-950 border border-slate-900 rounded-xl overflow-hidden shrink-0 relative group cursor-zoom-in">
                          <img src={event.imageUrl} alt="Folio page copy" className="object-cover w-full h-full group-hover:scale-105 transition-all" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}