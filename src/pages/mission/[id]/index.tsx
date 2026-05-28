import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
import { db } from '../../../firebase/config'; 
import { collection, onSnapshot, doc, query, where, getDocs } from 'firebase/firestore';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import dynamic from 'next/dynamic';
import Link from 'next/link';

const MapContainer = dynamic(() => import('react-leaflet').then((mod) => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then((mod) => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then((mod) => mod.Marker), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then((mod) => mod.Popup), { ssr: false });
const Polyline = dynamic(() => import('react-leaflet').then((mod) => mod.Polyline), { ssr: false });

export default function VesselControl() {
  const router = useRouter();
  const { id, fromCheckin } = router.query;
  const voyagerId = id ? id.toString().toUpperCase() : '';
  
  const [activeTab, setActiveTab] = useState('ledger'); 
  const [vesselMeta, setVesselMeta] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);

  const [totalMilesTraveled, setTotalMilesTraveled] = useState(0);
  const [lifecycleCount, setLifecycleCount] = useState(0);
  const [lifecycleTarget, setLifecycleTarget] = useState(21); // Default safe fallback

  const calculateHaversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    if (!lat1 || !lon1 || !lat2 || !lon2 || isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) return 0;
    const R = 3958.8; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  useEffect(() => {
    if (!voyagerId) return;

    const auth = getAuth();
    onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        getDocs(query(collection(db, 'users'), where('uid', '==', user.uid))).then((snap) => {
          if (!snap.empty) setUserProfile(snap.docs[0].data());
        });
      }
    });

    onSnapshot(doc(db, 'voyagerMissions', voyagerId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setVesselMeta(data);
        if (data.lifecycleTarget) setLifecycleTarget(parseInt(data.lifecycleTarget) || 21);
      }
    });

    onSnapshot(collection(db, 'telemetryLogs'), (snapshot) => {
      const fetched: any[] = [];
      snapshot.forEach((d) => {
        const data = d.data();
        if (data.voyagerId && data.voyagerId.toUpperCase() === voyagerId) fetched.push({ id: d.id, ...data });
      });
      fetched.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
      setLogs(fetched);
      setLoading(false);
    });

    onSnapshot(query(collection(db, 'crewComms'), where('voyagerId', '==', voyagerId)), (snapshot) => {
      const messages: any[] = [];
      snapshot.forEach((d) => messages.push({ id: d.id, ...d.data() }));
      messages.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
      setChatMessages(messages);
    });
  }, [voyagerId]);

  const timeline: any[] = [];
  let mileageCalc = 0;

  if (vesselMeta?.latitude) {
    let lastLat = parseFloat(vesselMeta.latitude);
    let lastLng = parseFloat(vesselMeta.longitude);
    let lastTimeMs = new Date(vesselMeta.launchDate).getTime();

    timeline.push({
      id: 'LAUNCH',
      handlerName: 'SYSTEM CONSOLE',
      reportedLocation: `DEPLOYMENT VECTOR: ${vesselMeta.originCity}`,
      latitude: lastLat,
      longitude: lastLng,
      timestamp: lastTimeMs,
      isLaunchPad: true
    });

    logs.forEach((log) => {
      const logTimeMs = log.timestamp?.toDate ? log.timestamp.toDate().getTime() : new Date(log.timestamp).getTime();

      // Inject explicit MIA CHECK-IN waypoints if stagnant for over 30 days
      while (logTimeMs - lastTimeMs > 30 * 24 * 60 * 60 * 1000) {
        lastTimeMs += 30 * 24 * 60 * 60 * 1000;
        timeline.push({
          id: `MIA_${lastTimeMs}`,
          handlerName: 'SYSTEM MONITOR',
          reportedLocation: 'MIA CHECK-IN',
          latitude: lastLat,
          longitude: lastLng,
          timestamp: lastTimeMs,
          isTimeout: true
        });
      }

      if (!log.isLaunchPad) {
        const currentLat = parseFloat(log.latitude);
        const currentLng = parseFloat(log.longitude);
        if (!isNaN(currentLat) && !isNaN(currentLng)) {
          mileageCalc += calculateHaversine(lastLat, lastLng, currentLat, currentLng);
          lastLat = currentLat;
          lastLng = currentLng;
        }
        timeline.push({ ...log, timestamp: logTimeMs });
      }
      lastTimeMs = logTimeMs;
    });

    let nowMs = new Date().getTime();
    while (nowMs - lastTimeMs > 30 * 24 * 60 * 60 * 1000) {
      lastTimeMs += 30 * 24 * 60 * 60 * 1000;
      timeline.push({
        id: `MIA_${lastTimeMs}`,
        handlerName: 'SYSTEM MONITOR',
        reportedLocation: 'MIA CHECK-IN',
        latitude: lastLat,
        longitude: lastLng,
        timestamp: lastTimeMs,
        isTimeout: true
      });
    }
  }

  useEffect(() => {
    if (timeline.length > 0) {
      setTotalMilesTraveled(Math.round(mileageCalc));
      const actualCheckins = timeline.filter(item => !item.isLaunchPad).length;
      setLifecycleCount(actualCheckins);
    }
  }, [logs, vesselMeta, mileageCalc, timeline.length]);

  const mapPoints: [number, number][] = timeline
    .map(l => [parseFloat(l.latitude), parseFloat(l.longitude)] as [number, number])
    .filter(p => !isNaN(p[0]) && !isNaN(p[1]));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col h-screen overflow-hidden">
      <header className="p-4 border-b border-slate-900 bg-slate-900/60 backdrop-blur shrink-0 z-50">
        <div className="max-w-7xl mx-auto flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
          <div>
            <Link href="/" className="text-xs font-mono font-black text-slate-400 hover:text-blue-400 tracking-widest block mb-1">🌍 FLEET PORTAL</Link>
            <h1 className="text-3xl font-black text-slate-100 uppercase mt-1">{voyagerId}</h1>
            <p className="text-xs font-mono text-slate-400 uppercase tracking-wide mt-1">Dynamic Lifecycle Challenge Module</p>
          </div>
          <div className="grid grid-cols-3 gap-4 font-mono text-left">
            <div className="bg-slate-950/80 p-3 border border-slate-900 rounded-xl"><span className="text-[10px] text-slate-400 block font-bold">LIFECYCLE</span><span className="text-xl font-black text-blue-400">{lifecycleCount}/{lifecycleTarget}</span></div>
            <div className="bg-slate-950/80 p-3 border border-slate-900 rounded-xl"><span className="text-[10px] text-slate-400 block font-bold">MILES TRAVELED</span><span className="text-xl font-black text-cyan-400">{totalMilesTraveled.toLocaleString()} MI</span></div>
            <div className="bg-slate-950/80 p-3 border border-slate-900 rounded-xl"><span className="text-[10px] text-slate-400 block font-bold">STATUS</span><span className="text-sm font-black text-emerald-400 block mt-1">{lifecycleCount >= lifecycleTarget ? "ACCOMPLISHED" : "IN PROGRESS"}</span></div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden max-w-7xl w-full mx-auto relative z-10">
        <section className="w-full md:w-1/2 h-64 md:h-full border-b md:border-b-0 md:border-r border-slate-900 bg-slate-950 relative shrink-0">
          {mapPoints.length > 0 && (
            <MapContainer center={mapPoints[mapPoints.length - 1]} zoom={5} style={{ height: '100%', width: '100%', background: '#020617' }} zoomControl={false}>
              <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
              {mapPoints.length > 1 && <Polyline positions={mapPoints} color="#2563eb" weight={3} dashArray="5, 8" />}
              {timeline.map((point, index) => (
                <Marker key={point.id} position={[parseFloat(point.latitude), parseFloat(point.longitude)]}>
                  <Popup><span className="font-mono text-xs font-bold text-slate-900">Stop #{index} - {point.reportedLocation}</span></Popup>
                </Marker>
              ))}
            </MapContainer>
          )}
        </section>

        <section className="flex-1 flex flex-col h-auto md:h-full overflow-hidden bg-slate-950/20">
          <div className="flex border-b border-slate-900 p-4 bg-slate-950">
            <button onClick={() => setActiveTab('ledger')} className={`flex-1 pb-2 text-sm font-bold tracking-wider uppercase ${activeTab === 'ledger' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-slate-400'}`}>Ledger History</button>
            <button onClick={() => setActiveTab('chat')} className={`flex-1 pb-2 text-sm font-bold tracking-wider uppercase ${activeTab === 'chat' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-slate-400'}`}>Crew Comms</button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {activeTab === 'ledger' ? (
              [...timeline].reverse().map((point, idx) => (
                <div key={point.id} className={`p-4 rounded-xl border ${point.isTimeout ? 'bg-amber-950/20 border-amber-800/60 shadow-md shadow-amber-900/5' : 'bg-slate-900/50 border-slate-900'}`}>
                  <div className="flex justify-between items-center font-mono text-xs">
                    <span className="text-slate-200 font-bold">Sign-off: <span className={`${point.isTimeout ? 'text-amber-400 font-black' : 'text-white font-black'}`}>{point.handlerName}</span></span>
                    <span className={`px-2.5 py-1 rounded text-white font-bold uppercase border ${point.isTimeout ? 'bg-amber-950/60 border-amber-800/40 text-amber-400 text-[11px]' : 'bg-slate-950 border-slate-800'}`}>{point.reportedLocation}</span>
                  </div>
                  {point.imageUrl && <img src={point.imageUrl} alt="Asset" className="w-full max-h-64 object-cover rounded-xl mt-3" />}
                  <div className="text-[10px] font-mono text-slate-400 mt-2 text-right">SYSTEM TIMESTAMP: {new Date(point.timestamp).toLocaleString()}</div>
                </div>
              ))
            ) : (
              <div className="text-slate-400 font-mono text-xs text-center py-12">CHANNEL SECURE. SEND COMPASS BROADCASTS.</div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}