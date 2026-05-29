import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
import { db } from '../../../firebase/config'; 
import { doc, collection, query, where, onSnapshot, addDoc, getDocs } from 'firebase/firestore';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import dynamic from 'next/dynamic';
import Link from 'next/link';

const MapContainer = dynamic(() => import('react-leaflet').then((mod) => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then((mod) => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then((mod) => mod.Marker), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then((mod) => mod.Popup), { ssr: false });
const Polyline = dynamic(() => import('react-leaflet').then((mod) => mod.Polyline), { ssr: false });

function MapFlyController({ targetFocus }: { targetFocus: [number, number] | null }) {
  const { useMap } = require('react-leaflet');
  const map = useMap();

  useEffect(() => {
    if (map && targetFocus && !isNaN(targetFocus[0]) && !isNaN(targetFocus[1])) {
      map.flyTo(targetFocus, 8, { animate: true, duration: 1.0 });
    }
  }, [targetFocus, map]);

  return null;
}

export default function MissionControl() {
  const router = useRouter();
  const { id } = router.query;
  const uppercaseId = id ? id.toString().toUpperCase() : '';

  const [vesselData, setVesselData] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ledger');

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);

  const [totalMilesTraveled, setTotalMilesTraveled] = useState(0);
  const [milesFromLaunch, setMilesFromLaunch] = useState(0); 
  const [custodyHandOffCount, setCustodyHandOffCount] = useState(0);

  const [timeSinceLaunch, setTimeSinceLaunch] = useState('0s');
  const [timeSinceCheckin, setTimeSinceCheckin] = useState('0s');

  const [isMapCollapsed, setIsMapCollapsed] = useState(false);
  const [mapTargetFocus, setMapTargetFocus] = useState<[number, number] | null>(null);

  const calculateHaversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    if (!lat1 || !lon1 || !lat2 || !lon2 || isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) return 0;
    const R = 3958.8; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const formatHumanElapsedTime = (msDuration: number, includeYear = false) => {
    if (msDuration <= 0 || isNaN(msDuration)) return '0s';
    const totalSeconds = Math.floor(msDuration / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalMinutes / 60);
    const totalDays = Math.floor(totalHours / 24);
    const displaySeconds = String(totalSeconds % 60).padStart(2, '0');
    const displayMinutes = String(totalMinutes % 60).padStart(2, '0');
    const displayHours = String(totalHours % 24).padStart(2, '0');
    let pieces: string[] = [];
    if (includeYear) {
      const years = Math.floor(totalDays / 365);
      const remainingDays = totalDays % 365;
      if (years > 0) pieces.push(`${years} yr${years > 1 ? 's' : ''}`);
      if (remainingDays > 0 || years > 0) pieces.push(`${remainingDays} day${remainingDays !== 1 ? 's' : ''}`);
    } else {
      if (totalDays > 0) pieces.push(`${totalDays} day${totalDays !== 1 ? 's' : ''}`);
    }
    pieces.push(`${displayHours}:${displayMinutes}:${displaySeconds}`);
    return pieces.join(', ');
  };

  useEffect(() => {
    if (!uppercaseId) return;

    const auth = getAuth();
    onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        const usersCollection = collection(db, 'users');
        const qProfile = query(usersCollection, where('uid', '==', user.uid));
        getDocs(qProfile).then((snap) => {
          if (!snap.empty) setUserProfile(snap.docs[0].data());
        });
      }
    });

    onSnapshot(doc(db, 'voyagerMissions', uppercaseId), (docSnap) => {
      if (docSnap.exists()) {
        setVesselData(docSnap.data());
      }
    });

    onSnapshot(collection(db, 'telemetryLogs'), (snapshot) => {
      const fetched: any[] = [];
      snapshot.forEach((d) => {
        const data = d.data();
        if (data.voyagerId && data.voyagerId.toUpperCase() === uppercaseId) fetched.push({ id: d.id, ...data });
      });
      fetched.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
      setLogs(fetched);
      setLoading(false);
    });

    onSnapshot(query(collection(db, 'crewComms'), where('voyagerId', '==', uppercaseId)), (snapshot) => {
      const messages: any[] = [];
      snapshot.forEach((d) => messages.push({ id: d.id, ...d.data() }));
      messages.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
      setChatMessages(messages);
    });
  }, [uppercaseId]);

  const timeline: any[] = [];
  let mileageCalc = 0;

  if (vesselData?.latitude) {
    let lastLat = parseFloat(vesselData.latitude);
    let lastLng = parseFloat(vesselData.longitude);
    let lastTimeMs = new Date(vesselData.launchDate).getTime();

    if (!isNaN(lastLat) && !isNaN(lastLng)) {
      timeline.push({
        id: 'LAUNCH',
        // UPDATED: 'ARCHIVE BASE' -> 'LAUNCH BASE'
        handlerName: 'LAUNCH BASE',
        reportedLocation: `LAUNCH LOCATION: ${vesselData.originCity}`,
        latitude: lastLat,
        longitude: lastLng,
        timestamp: lastTimeMs,
        isLaunchPad: true,
        // UPDATED: Standardizes display strings for baseline deployment nodes
        displayActionContext: `${uppercaseId} LAUNCHED`
      });
    }

    logs.forEach((log) => {
      const logTimeMs = log.timestamp?.toDate ? log.timestamp.toDate().getTime() : new Date(log.timestamp).getTime();

      while (logTimeMs - lastTimeMs > 30 * 24 * 60 * 60 * 1000) {
        lastTimeMs += 30 * 24 * 60 * 60 * 1000;
        if (!isNaN(lastLat) && !isNaN(lastLng)) {
          timeline.push({
            id: `MIA_${lastTimeMs}`,
            handlerName: 'SYSTEM MONITOR',
            reportedLocation: 'MIA CHECK-IN',
            latitude: lastLat,
            longitude: lastLng,
            timestamp: lastTimeMs,
            isTimeout: true,
            displayActionContext: "AUTO INTERVAL OVERRIDE"
          });
        }
      }

      if (!log.isLaunchPad) {
        const currentLat = parseFloat(log.latitude);
        const currentLng = parseFloat(log.longitude);
        
        if (!isNaN(currentLat) && !isNaN(currentLng) && !isNaN(lastLat) && !isNaN(lastLng)) {
          mileageCalc += calculateHaversine(lastLat, lastLng, currentLat, currentLng);
          lastLat = currentLat;
          lastLng = currentLng;
        }
        
        timeline.push({ 
          ...log, 
          timestamp: logTimeMs,
          latitude: isNaN(currentLat) ? lastLat : currentLat,
          longitude: isNaN(currentLng) ? lastLng : currentLng
        });
      }
      lastTimeMs = logTimeMs;
    });

    let nowMs = new Date().getTime();
    while (nowMs - lastTimeMs > 30 * 24 * 60 * 60 * 1000) {
      lastTimeMs += 30 * 24 * 60 * 60 * 1000;
      if (!isNaN(lastLat) && !isNaN(lastLng)) {
        timeline.push({
          id: `MIA_${lastTimeMs}`,
          handlerName: 'SYSTEM MONITOR',
          reportedLocation: 'MIA CHECK-IN',
          latitude: lastLat,
          longitude: lastLng,
          timestamp: lastTimeMs,
          isTimeout: true,
          displayActionContext: "AUTO INTERVAL OVERRIDE"
        });
      }
    }
  }

  useEffect(() => {
    const clockTicker = setInterval(() => {
      const rightNow = new Date().getTime();
      if (vesselData?.launchDate) {
        setTimeSinceLaunch(formatHumanElapsedTime(rightNow - new Date(vesselData.launchDate).getTime(), true));
      }
      if (timeline.length > 0) {
        const absoluteLastPoint = timeline[timeline.length - 1];
        setTimeSinceCheckin(formatHumanElapsedTime(rightNow - absoluteLastPoint.timestamp, false));
      }
    }, 1000);
    return () => clearInterval(clockTicker);
  }, [vesselData, timeline]);

  useEffect(() => {
    if (timeline.length > 0) {
      setTotalMilesTraveled(Math.round(mileageCalc));
      const explicitPossessionCount = logs.filter(log => log.journalOptions?.tookPossession === true).length;
      setCustodyHandOffCount(explicitPossessionCount);

      const launchPadNode = timeline[0];
      const latestActiveNode = timeline[timeline.length - 1];
      
      if (launchPadNode && latestActiveNode) {
        const directDisplacement = calculateHaversine(
          parseFloat(launchPadNode.latitude),
          parseFloat(launchPadNode.longitude),
          parseFloat(latestActiveNode.latitude),
          parseFloat(latestActiveNode.longitude)
        );
        setMilesFromLaunch(Math.round(directDisplacement));
      }
    }
  }, [logs, vesselData, mileageCalc, timeline]);

  const mapPoints: [number, number][] = timeline
    .map(l => [parseFloat(l.latitude), parseFloat(l.longitude)] as [number, number])
    .filter(p => p && !isNaN(p[0]) && !isNaN(p[1]));

  const fallbackCenter: [number, number] = [30.6035, -87.9011];
  const dynamicMapCenter = mapPoints.length > 0 ? mapPoints[mapPoints.length - 1] : fallbackCenter;

  const handleSendCommsMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !userProfile) return;
    try {
      await addDoc(collection(db, 'crewComms'), {
        voyagerId: uppercaseId,
        senderUid: currentUser.uid,
        username: userProfile.username || 'Author Member',
        messageText: newMessage.trim(),
        timestamp: new Date()
      });
      setNewMessage('');
    } catch (error) { console.error(error); }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col h-screen overflow-hidden">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />

      <header className="p-4 border-b border-slate-900 bg-slate-900/60 backdrop-blur shrink-0 z-50">
        <div className="max-w-7xl mx-auto flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
          <div className="w-full xl:w-auto">
            <Link href="/" className="text-xs font-mono font-black text-slate-400 hover:text-blue-400 tracking-widest block mb-1">🌍 JOURNAL PORTAL</Link>
            <h1 className="text-3xl font-black text-slate-100 uppercase mt-1">{uppercaseId}</h1>
            <p className="text-xs font-mono text-slate-300 uppercase tracking-wide mt-1">VOLUME LEDGER CHRONICLE: {vesselData?.originCity || 'PARSING...'}</p>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 w-full xl:w-auto font-mono text-xs text-left">
            <div className="bg-slate-950/80 p-2.5 border border-slate-900 rounded-xl"><span className="text-[9px] text-slate-400 block font-bold">JOURNAL AGE (TOTAL TIME)</span><span className="text-sm font-black text-blue-400 tracking-wide block mt-0.5 whitespace-nowrap">{timeSinceLaunch}</span></div>
            <div className="bg-slate-950/80 p-2.5 border border-slate-900 rounded-xl"><span className="text-[9px] text-slate-400 block font-bold">TIME SINCE LAST ENTRY</span><span className="text-sm font-black text-emerald-400 tracking-wide block mt-0.5 whitespace-nowrap">{timeSinceCheckin}</span></div>
            <div className="bg-slate-950/80 p-2.5 border border-slate-900 rounded-xl"><span className="text-[9px] text-slate-400 block font-bold">POSSESSION TRANSFERS</span><span className="text-base font-black text-indigo-400 block mt-0.5">{custodyHandOffCount}</span></div>
            <div className="bg-slate-950/80 p-2.5 border border-slate-900 rounded-xl"><span className="text-[9px] text-slate-400 block font-bold">DISPLACEMENT</span><span className="text-base font-black text-amber-500 block mt-0.5">{milesFromLaunch.toLocaleString()} MI</span></div>
            <div className="bg-slate-950/80 p-2.5 border border-slate-900 rounded-xl"><span className="text-[9px] text-slate-400 block font-bold">TOTAL MILES</span><span className="text-base font-black text-cyan-400 block mt-0.5">{totalMilesTraveled.toLocaleString()} MI</span></div>
            
            <button 
              onClick={() => setIsMapCollapsed(!isMapCollapsed)}
              className="md:hidden bg-slate-900/60 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-xl p-2 flex flex-col items-center justify-center font-mono font-black tracking-widest text-[10px] uppercase shadow transition-all cursor-pointer min-h-[46px]"
            >
              {isMapCollapsed ? 'Expand Map' : 'Collapse Map'}
            </button>

            <div className="hidden sm:block bg-slate-950/80 p-2.5 border border-slate-900 rounded-xl"><span className="text-[9px] text-slate-400 block font-bold">STATUS</span><span className="text-xs font-black text-emerald-400 block mt-0.5">IN PROGRESS</span></div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden max-w-7xl w-full mx-auto relative z-10">
        <section className={`w-full md:w-1/2 border-slate-900 relative shrink-0 transition-all duration-300 ease-in-out ${isMapCollapsed ? 'h-0 border-b-0 hidden md:block md:h-full' : 'h-[40vh] md:h-full border-b md:border-b-0 md:border-r'}`}>
          {mapPoints.length > 0 ? (
            <MapContainer center={dynamicMapCenter} zoom={5} style={{ height: '100%', width: '100%', background: '#020617' }}>
              <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
              <MapFlyController targetFocus={mapTargetFocus} />
              {mapPoints.length > 1 && <Polyline positions={mapPoints} color="#2563eb" weight={3} dashArray="5, 8" />}
              {timeline.map((point) => {
                const pLat = parseFloat(point.latitude);
                const pLng = parseFloat(point.longitude);
                if (isNaN(pLat) || isNaN(pLng)) return null;
                return (
                  <Marker key={point.id} position={[pLat, pLng]}>
                    <Popup>
                      <div className="font-mono text-xs p-1 text-slate-900 space-y-1">
                        <div className="font-black text-blue-600 block uppercase">✍️ {point.handlerName}</div>
                        {point.displayActionContext && <div className="text-[10px] font-bold text-slate-500 uppercase">Action: {point.displayActionContext}</div>}
                        <div className="text-[10px] font-black text-slate-700 uppercase">📍 {point.reportedLocation}</div>
                        <div className="text-[9px] border-t border-slate-200 pt-1 text-slate-400 font-bold mt-1">
                          {new Date(point.timestamp).toLocaleString()}
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          ) : (
            <div className="h-full w-full flex items-center justify-center font-mono text-slate-500 text-xs uppercase bg-slate-950">
              No geographical coordinate vectors recorded for this volume layout.
            </div>
          )}
        </section>

        <section className="flex-1 flex flex-col h-auto md:h-full overflow-hidden bg-slate-950/20">
          <div className="flex border-b border-slate-900 p-4 bg-slate-950 shrink-0">
            <button onClick={() => setActiveTab('ledger')} className={`flex-1 pb-2 text-sm font-bold tracking-wider uppercase ${activeTab === 'ledger' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-slate-400'}`}>Custody Log</button>
            <button onClick={() => setActiveTab('chat')} className={`flex-1 pb-2 text-sm font-bold tracking-wider uppercase ${activeTab === 'chat' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-slate-400'}`}>Marginalia // Notes</button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {activeTab === 'ledger' ? (
              [...timeline].reverse().map((point) => (
                <div 
                  key={point.id} 
                  onClick={() => {
                    const lat = parseFloat(point.latitude);
                    const lng = parseFloat(point.longitude);
                    if (!isNaN(lat) && !isNaN(lng)) {
                      setMapTargetFocus([lat, lng]);
                    }
                  }}
                  className="p-4 rounded-xl border bg-slate-900/50 border-slate-900 hover:border-blue-500/50 hover:bg-slate-900 cursor-pointer transition-all group"
                >
                  <div className="flex justify-between items-center font-mono text-xs gap-3">
                    {/* DISPLAY CHANGES WILL REFLECT LIVE IN HANDLER CODES */}
                    <span className="text-slate-200 font-bold group-hover:text-blue-400 transition-colors">Journal in possession of: <span className={`${point.isTimeout ? 'text-amber-400 font-black' : 'text-white font-black'}`}>{point.handlerName}</span></span>
                    <span className={`px-2.5 py-1 rounded text-white font-bold uppercase border text-[11px] truncate ${point.isTimeout ? 'bg-amber-950/60 border-amber-800/40 text-amber-400' : 'bg-slate-950 border-slate-800'}`}>{point.reportedLocation}</span>
                  </div>
                  
                  {point.displayActionContext && (
                    <div className="mt-2 text-[10px] font-mono font-black text-blue-400 uppercase bg-blue-950/20 border border-blue-900/30 px-2 py-1 rounded w-fit">
                      📌 Actions: {point.displayActionContext}
                    </div>
                  )}

                  {point.imageUrl && <img src={point.imageUrl} alt="Log Attachment" className="w-full max-h-64 object-cover rounded-xl mt-3 mx-auto border border-slate-950" />}
                  <div className="text-[10px] font-mono text-slate-400 mt-2 text-right">{new Date(point.timestamp).toLocaleString()}</div>
                </div>
              ))
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden space-y-4">
                <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 font-mono text-xs">
                  {chatMessages.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 uppercase text-[11px] font-bold">Secure Channel Established. Begin Margin Notes...</div>
                  ) : (
                    chatMessages.map((msg) => (
                      <div key={msg.id} className="p-2.5 bg-slate-900/40 border border-slate-900/60 rounded-xl space-y-1">
                        <div className="flex justify-between items-center border-b border-slate-950/40 pb-1 text-[11px]">
                          <span className="text-blue-400 font-black flex items-center">{msg.username}</span>
                          <span className="text-slate-400 font-bold">{msg.timestamp?.toDate ? msg.timestamp.toDate().toLocaleString() : new Date(msg.timestamp).toLocaleString()}</span>
                        </div>
                        <p className="text-slate-100 break-words pt-0.5 text-[13px] font-bold">{msg.messageText}</p>
                      </div>
                    ))
                  )}
                </div>

                {currentUser && userProfile ? (
                  <form onSubmit={handleSendCommsMessage} className="pt-2 flex items-center space-x-2 shrink-0 bg-transparent">
                    <input type="text" placeholder={`Add a margin note as ${userProfile.username}...`} value={newMessage} onChange={(e) => setNewMessage(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-500 font-bold" />
                    <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs font-bold uppercase py-3 px-5 rounded-xl transition-all shadow cursor-pointer">Send</button>
                  </form>
                ) : (
                  <div className="text-center py-4 font-mono text-[11px] text-slate-500">
                    [LOG IN AT MAIN PORTAL ROW FRAME TO ENABLE MARGINALIA BROADCASTS]
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}