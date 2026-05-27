import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
import { db } from '../../../firebase/config'; 
import { collection, onSnapshot, doc, addDoc, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import dynamic from 'next/dynamic';
import Link from 'next/link';

const MapContainer = dynamic(() => import('react-leaflet').then((mod) => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then((mod) => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then((mod) => mod.Marker), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then((mod) => mod.Popup), { ssr: false });
const Polyline = dynamic(() => import('react-leaflet').then((mod) => mod.Polyline), { ssr: false });

function MapRecenter({ center }: { center: [number, number] }) {
  const { useMap } = require('react-leaflet');
  const map = useMap();
  useEffect(() => {
    if (center && !isNaN(center[0]) && !isNaN(center[1])) {
      map.setView(center, map.getZoom());
    }
  }, [center, map]);
  return null;
}

export default function VesselControl() {
  const router = useRouter();
  const { id, fromCheckin } = router.query;
  const voyagerId = id ? id.toString().toUpperCase() : '';
  
  const [activeTab, setActiveTab] = useState('ledger'); 
  const [vesselMeta, setVesselMeta] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [isMapCollapsed, setIsMapCollapsed] = useState(false); 

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);

  const [timeSinceLaunch, setTimeSinceLaunch] = useState('00:000:00:00:00');
  const [timeSinceCheckin, setTimeSinceCheckin] = useState('000:00:00:00');
  const [milesFromLaunch, setMilesFromLaunch] = useState(0);
  const [totalMilesTraveled, setTotalMilesTraveled] = useState(0);

  const defaultCenter: [number, number] = [30.6035, -87.9011]; 

  const formatDisplayDateTime = (timestampValue: any) => {
    if (!timestampValue) return 'Processing...';
    let targetDate;
    if (typeof timestampValue.toDate === 'function') {
      targetDate = timestampValue.toDate();
    } else {
      targetDate = new Date(timestampValue);
    }
    if (isNaN(targetDate.getTime())) return 'Invalid Date';
    return targetDate.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const calculateHaversineDistanceInMiles = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    if (!lat1 || !lon1 || !lat2 || !lon2 || isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) return 0;
    const R = 3958.8; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const formatOperationalDuration = (msDuration: number, includeYear = false) => {
    if (msDuration <= 0 || isNaN(msDuration)) return includeYear ? '00:000:00:00:00' : '000:00:00:00';
    const totalSeconds = Math.floor(msDuration / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalMinutes / 60);
    const totalDays = Math.floor(totalHours / 24);
    const ss = String(totalSeconds % 60).padStart(2, '0');
    const mm = String(totalMinutes % 60).padStart(2, '0');
    const hh = String(totalHours % 24).padStart(2, '0');
    return includeYear ? `${String(Math.floor(totalDays / 365)).padStart(2, '0')}:${String(totalDays % 365).padStart(3, '0')}:${hh}:${mm}:${ss}` : `${String(totalDays).padStart(3, '0')}:${hh}:${mm}:${ss}`;
  };

  const isVesselMissing = (() => {
    const currentTimeMs = new Date().getTime();
    if (logs.length > 0) {
      const latestLog = logs[logs.length - 1];
      const lastCheckinMs = latestLog.timestamp?.toDate() ? latestLog.timestamp.toDate().getTime() : currentTimeMs;
      return (currentTimeMs - lastCheckinMs) > (30 * 24 * 60 * 60 * 1000);
    } else if (vesselMeta?.launchDate) {
      return (currentTimeMs - new Date(vesselMeta.launchDate).getTime()) > (30 * 24 * 60 * 60 * 1000);
    }
    return false;
  })();

  useEffect(() => {
    if (!voyagerId) return;

    const auth = getAuth();
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        const usersCollection = collection(db, 'users');
        const qProfile = query(usersCollection, where('uid', '==', user.uid));
        getDocs(qProfile).then((snap) => {
          if (!snap.empty) setUserProfile(snap.docs[0].data());
        }).catch(err => console.error("Profile query error:", err));
      } else {
        setCurrentUser(null);
        setUserProfile(null);
      }
    });

    const vesselDocRef = doc(db, 'voyagerMissions', voyagerId);
    const unsubscribeVessel = onSnapshot(vesselDocRef, (docSnap) => {
      if (docSnap.exists()) setVesselMeta(docSnap.data());
    });

    const logsCollection = collection(db, 'telemetryLogs');
    const unsubscribeLogs = onSnapshot(logsCollection, (snapshot) => {
      const fetchedLogs: any[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.voyagerId && data.voyagerId.toUpperCase() === voyagerId) fetchedLogs.push({ id: doc.id, ...data });
      });
      // Chronological order (oldest to newest)
      fetchedLogs.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
      setLogs(fetchedLogs);
      setLoading(false);
    });

    const commsCollection = collection(db, 'crewComms');
    const qChat = query(commsCollection, where('voyagerId', '==', voyagerId));
    const unsubscribeChat = onSnapshot(qChat, (snapshot) => {
      const messages: any[] = [];
      snapshot.forEach((doc) => {
        messages.push({ id: doc.id, ...doc.data() });
      });
      messages.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
      setChatMessages(messages);
    });

    return () => { unsubscribeAuth(); unsubscribeVessel(); unsubscribeLogs(); unsubscribeChat(); };
  }, [voyagerId]);

  const unifiedWaypointTimeline: any[] = [];
  if (vesselMeta && vesselMeta.latitude && vesselMeta.longitude) {
    unifiedWaypointTimeline.push({
      id: 'LAUNCH_BASE',
      handlerName: 'SYSTEM CONSOLE',
      reportedLocation: `DEPLOYMENT VECTOR: ${vesselMeta.originCity || 'ORIGIN'}`,
      latitude: vesselMeta.latitude,
      longitude: vesselMeta.longitude,
      isLaunchPad: true,
      displayDateRaw: vesselMeta.launchDate, 
      displayIndex: 1
    });
  }

  logs.forEach((log, idx) => {
    // BLUE STAR LOGIC: A log gets verified if there is a LATER log that is approved/verified.
    // This proves they successfully handed it off to the next person!
    let isLogHandedOffAndVerified = false;
    for (let i = idx + 1; i < logs.length; i++) {
      if (logs[i].verified === true) {
        isLogHandedOffAndVerified = true;
        break;
      }
    }

    unifiedWaypointTimeline.push({
      ...log,
      isLaunchPad: false,
      displayDateRaw: log.timestamp, 
      displayIndex: unifiedWaypointTimeline.length + 1,
      hasEarnedBlueStar: isLogHandedOffAndVerified
    });
  });

  useEffect(() => {
    const timerInterval = setInterval(() => {
      const currentTime = new Date().getTime();
      if (vesselMeta?.launchDate) {
        setTimeSinceLaunch(formatOperationalDuration(currentTime - new Date(vesselMeta.launchDate).getTime(), true));
      }
      if (logs.length > 0) {
        const latestLog = logs[logs.length - 1];
        const lastCheckinMs = latestLog.timestamp?.toDate() ? latestLog.timestamp.toDate().getTime() : currentTime;
        setTimeSinceCheckin(formatOperationalDuration(currentTime - lastCheckinMs, false));
      }
    }, 1000);

    if (unifiedWaypointTimeline.length > 0) {
      const points = unifiedWaypointTimeline
        .map(l => ({ lat: parseFloat(l.latitude), lng: parseFloat(l.longitude) }))
        .filter(p => !isNaN(p.lat) && !isNaN(p.lng));

      if (points.length > 0) {
        setMilesFromLaunch(Math.round(calculateHaversineDistanceInMiles(points[0].lat, points[0].lng, points[points.length - 1].lat, points[points.length - 1].lng)));
        let runningTotal = 0;
        for (let i = 0; i < points.length - 1; i++) {
          runningTotal += calculateHaversineDistanceInMiles(points[i].lat, points[i].lng, points[i+1].lat, points[i+1].lng);
        }
        setTotalMilesTraveled(Math.round(runningTotal));
      }
    }
    return () => clearInterval(timerInterval);
  }, [vesselMeta, logs, unifiedWaypointTimeline.length]);

  const handleSendCommsMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !userProfile) return;
    try {
      await addDoc(collection(db, 'crewComms'), {
        voyagerId: voyagerId,
        senderUid: currentUser.uid,
        username: userProfile.username || 'Crew Member',
        messageText: newMessage.trim(),
        timestamp: serverTimestamp()
      });
      setNewMessage('');
    } catch (error) { console.error("Comms send fault:", error); }
  };

  const mapRoutingPolylinePoints: [number, number][] = unifiedWaypointTimeline
    .map(l => [parseFloat(l.latitude), parseFloat(l.longitude)] as [number, number])
    .filter(p => !isNaN(p[0]) && !isNaN(p[1]));

  const currentMapCenter = mapRoutingPolylinePoints.length > 0 ? mapRoutingPolylinePoints[mapRoutingPolylinePoints.length - 1] : defaultCenter;
  const isCenterValid = currentMapCenter && !isNaN(currentMapCenter[0]) && !isNaN(currentMapCenter[1]);
  const newestFirstLedgerDisplayList = [...unifiedWaypointTimeline].reverse();

  // Helper function to check if a user is in our local list of verified handoff stars
  const checkUsernameHasStarInTimeline = (name: string) => {
    if (!name) return false;
    return logs.some((log, idx) => {
      if (log.handlerName && log.handlerName.trim().toLowerCase() === name.trim().toLowerCase()) {
        for (let i = idx + 1; i < logs.length; i++) {
          if (logs[i].verified === true) return true;
        }
      }
      return false;
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col h-screen overflow-hidden">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />

      <header className="p-4 border-b border-slate-900 bg-slate-900/60 backdrop-blur shrink-0 z-50">
        <div className="max-w-7xl mx-auto flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
          <div className="space-y-1.5 w-full xl:w-auto">
            {fromCheckin === 'true' && (
              <Link href={`/mission/${voyagerId.toLowerCase()}/checkin`} className="inline-block text-xs font-mono uppercase font-bold text-blue-400 tracking-widest hover:underline mb-1">
                ← Return to Field Portal
              </Link>
            )}
            <div className="flex justify-between items-center w-full">
              <div className="flex flex-col">
                <span className="text-xs font-mono font-bold tracking-widest text-slate-400 uppercase">VESSEL</span>
                <h1 className="text-3xl font-black tracking-wider text-slate-100 uppercase leading-none mt-1">{voyagerId}</h1>
              </div>
              <div className="flex items-center space-x-2">
                {isVesselMissing ? (
                  <span className="px-2 py-0.5 text-[10px] font-mono font-black tracking-widest uppercase rounded bg-yellow-950/80 text-yellow-400 border border-yellow-600/50 animate-pulse">
                    MISSING
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold tracking-widest uppercase rounded bg-blue-950/60 text-blue-400 border border-blue-900/40">
                    IN TRANSIT
                  </span>
                )}
                <button onClick={() => setIsMapCollapsed(!isMapCollapsed)} className="md:hidden bg-slate-900 hover:bg-slate-800 text-slate-100 border border-slate-800 font-mono text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-all">
                  {isMapCollapsed ? 'Expand Map' : 'Collapse Map'}
                </button>
              </div>
            </div>
            {vesselMeta && <p className="text-xs font-mono text-slate-300 uppercase tracking-wide">Routing Node Matrix: {vesselMeta.originCity} → {vesselMeta.destinationCity}</p>}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full xl:w-auto font-mono text-left">
            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-900"><span className="text-[10px] text-slate-200 block font-bold uppercase">T-MET (SINCE LAUNCH)</span><span className="text-sm font-black text-blue-400 tracking-widest">{timeSinceLaunch}</span></div>
            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-900"><span className="text-[10px] text-slate-200 block font-bold uppercase">TSLC (SINCE CHECKIN)</span><span className="text-sm font-black text-emerald-400 tracking-widest">{timeSinceCheckin}</span></div>
            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-900"><span className="text-[10px] text-slate-200 block font-bold uppercase">DISPLACEMENT</span><span className="text-base font-black text-amber-500">{milesFromLaunch.toLocaleString()} MI</span></div>
            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-900"><span className="text-[10px] text-slate-200 block font-bold uppercase">TOTAL TRAVELED</span><span className="text-base font-black text-cyan-400">{totalMilesTraveled.toLocaleString()} MI</span></div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden max-w-7xl w-full mx-auto relative z-10">
        <section className={`w-full md:w-1/2 border-slate-900 relative shrink-0 transition-all duration-300 ease-in-out ${isMapCollapsed ? 'h-0 border-b-0 hidden' : 'h-64 md:h-full border-b md:border-b-0 md:border-r'}`}>
          {isCenterValid ? (
            <MapContainer center={currentMapCenter} zoom={5} style={{ height: '100%', width: '100%', background: '#020617' }} zoomControl={false}>
              <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
              <MapRecenter center={currentMapCenter} />
              {mapRoutingPolylinePoints.length > 1 && <Polyline positions={mapRoutingPolylinePoints} color="#3b82f6" weight={4} dashArray="5, 10" />}
              {unifiedWaypointTimeline
                .map((log) => ({ ...log, lat: parseFloat(log.latitude), lng: parseFloat(log.longitude) }))
                .filter(log => !isNaN(log.lat) && !isNaN(log.lng))
                .map((log) => (
                  <Marker key={log.id} position={[log.lat, log.lng]}>
                    <Popup>
                      <div className="text-slate-900 font-mono text-xs font-bold">
                        Checkpoint #{log.displayIndex}<br/>Handler: {log.handlerName} {log.hasEarnedBlueStar && '🔷'}
                      </div>
                    </Popup>
                  </Marker>
                ))
              }
            </MapContainer>
          ) : (
            <div className="w-full h-full bg-slate-950 flex items-center justify-center font-mono text-xs text-slate-400 animate-pulse">CALIBRATING LOCAL MAP COORDINATES...</div>
          )}
        </section>

        <section className="flex-1 flex flex-col h-auto md:h-full overflow-hidden bg-slate-950/20">
          <div className="flex border-b border-slate-900 p-4 shrink-0 bg-slate-950">
            <button onClick={() => setActiveTab('ledger')} className={`flex-1 pb-2 text-sm font-bold tracking-wider uppercase transition-all ${activeTab === 'ledger' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-slate-400'}`}>Vessel Ledger</button>
            <button onClick={() => setActiveTab('chat')} className={`flex-1 pb-2 text-sm font-bold tracking-wider uppercase transition-all ${activeTab === 'chat' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-slate-400'}`}>Crew Comms</button>
          </div>

          <div className="flex-1 flex flex-col overflow-hidden p-4">
            {loading ? (
              <div className="text-center py-12 text-xs font-mono text-slate-400 animate-pulse">SYNCHRONIZING TELEMETRY STREAM...</div>
            ) : activeTab === 'ledger' ? (
              <div className="space-y-5 overflow-y-auto flex-1 pr-1">
                {newestFirstLedgerDisplayList.map((log) => (
                  <div key={log.id} className="p-4 bg-slate-900/50 border border-slate-900 rounded-xl space-y-4 shadow-2xl backdrop-blur-sm">
                    <div className="flex justify-between items-center text-xs font-mono">
                      <div className="flex items-center space-x-2 text-[13px]">
                        <span className="text-blue-400 font-black">#{log.displayIndex}</span>
                        <span className="text-slate-100 font-bold">Sign-off:</span>
                        <span className="text-white font-black tracking-wide flex items-center">
                          {log.handlerName}
                          {/* INJECT BLUE STAR BADGE ON LEDGER */}
                          {log.hasEarnedBlueStar && (
                            <span className="ml-1.5 text-blue-400 text-xs bg-blue-950/80 border border-blue-500/30 px-1 py-0.5 rounded font-black tracking-tighter text-[9px]">
                              🔷 {voyagerId}
                            </span>
                          )}
                        </span>
                      </div>
                      <span className="bg-slate-950 px-2.5 py-1 rounded-md text-white border border-slate-800 font-black uppercase tracking-wide text-[12px]">
                        📍 {log.reportedLocation.includes("DEPLOYMENT") ? "ORIGIN BASE" : log.reportedLocation}
                      </span>
                    </div>

                    {log.imageUrl && (
                      <div className="relative border border-slate-950 bg-slate-950 rounded-lg overflow-hidden shadow-inner">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={log.imageUrl} alt="Verification Asset" className="w-full h-auto max-h-80 object-cover rounded-md mx-auto" />
                      </div>
                    )}

                    <div className="text-[11px] font-mono text-slate-200 uppercase tracking-widest flex justify-between items-center bg-slate-950/40 p-2 rounded-lg border border-slate-900/40">
                      <span className="font-bold">{log.isLaunchPad ? "Initial Base Setup" : log.verified ? "Verified Check-in" : "Pending Verification"}</span>
                      <span className="text-white font-black tracking-normal">
                        ⏰ {formatDisplayDateTime(log.displayDateRaw)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                {currentUser && userProfile ? (
                  <div className="flex-1 flex flex-col overflow-hidden space-y-4">
                    <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 font-mono text-xs">
                      {chatMessages.length === 0 ? (
                        <div className="text-center py-12 text-slate-300 uppercase text-[11px] font-bold">Secure Channel Established. Begin Comms Broadcast...</div>
                      ) : (
                        chatMessages.map((msg) => {
                          const userHasStar = checkUsernameHasStarInTimeline(msg.username);
                          return (
                            <div key={msg.id} className="p-2.5 bg-slate-900/40 border border-slate-900/60 rounded-xl space-y-1">
                              <div className="flex justify-between items-center border-b border-slate-950/40 pb-1 text-[11px]">
                                <span className="text-blue-400 font-black flex items-center">
                                  📡 {msg.username}
                                  {/* INJECT BLUE STAR BADGE ON COMMS DECK FEED */}
                                  {userHasStar && (
                                    <span className="ml-1.5 text-blue-400 text-[8px] bg-blue-950/80 border border-blue-500/30 px-1 py-0.5 rounded font-black tracking-tighter">
                                      🔷 {voyagerId}
                                    </span>
                                  )}
                                </span>
                                <span className="text-slate-200 font-bold">
                                  ⏰ {formatDisplayDateTime(msg.timestamp)}
                                </span>
                              </div>
                              <p className="text-slate-100 break-words pt-0.5 text-[13px] font-bold">{msg.messageText}</p>
                            </div>
                          );
                        })
                      )}
                    </div>

                    <form onSubmit={handleSendCommsMessage} className="border-t border-slate-900 pt-3 flex items-center space-x-2 shrink-0 bg-slate-950/40">
                      <input type="text" placeholder={`Transmit as ${userProfile.username}...`} value={newMessage} onChange={(e) => setNewMessage(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-500 font-bold" />
                      <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs font-bold uppercase py-3 px-5 rounded-xl transition-all shadow">Send</button>
                    </form>
                  </div>
                ) : (
                  <div className="text-center py-12 font-mono text-xs text-slate-200 font-bold">
                    COMMS CHANNEL SECURE OVERRIDE REQUIRED
                    <p className="text-[11px] text-slate-400 mt-2 font-normal">
                      <Link href="/" className="text-blue-400 underline font-bold">[RETURN TO PORTAL MAIN FRAME TO LOG IN]</Link>
                    </p>
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