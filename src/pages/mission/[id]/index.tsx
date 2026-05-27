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

function MapRecenter({ center }) {
  const { useMap } = require('react-leaflet');
  const map = useMap();
  useEffect(() => {
    if (center && !isNaN(center[0]) && !isNaN(center[1])) {
      map.setView(center, map.getZoom());
    }
  }, [center, map]);
  return null;
}

export default function MissionControl() {
  const router = useRouter();
  const { id, fromCheckin } = router.query;
  const voyagerId = id ? id.toString().toUpperCase() : '';
  
  const [activeTab, setActiveTab] = useState('ledger'); 
  const [missionMeta, setMissionMeta] = useState(null);
  const [logs, setLogs] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);

  const [timeSinceLaunch, setTimeSinceLaunch] = useState('00:000:00:00:00');
  const [timeSinceCheckin, setTimeSinceCheckin] = useState('000:00:00:00');
  const [milesFromLaunch, setMilesFromLaunch] = useState(0);
  const [totalMilesTraveled, setTotalMilesTraveled] = useState(0);

  const defaultCenter = [30.6035, -87.9011]; 

  // UNIFIED TIMESTAMP FORMATTING UTILITY
  const formatDisplayDateTime = (timestampValue) => {
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

  const calculateHaversineDistanceInMiles = (lat1, lon1, lat2, lon2) => {
    if (!lat1 || !lon1 || !lat2 || !lon2 || isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) return 0;
    const R = 3958.8; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const formatOperationalDuration = (msDuration, includeYear = false) => {
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

    const missionDocRef = doc(db, 'voyagerMissions', voyagerId);
    const unsubscribeMission = onSnapshot(missionDocRef, (docSnap) => {
      if (docSnap.exists()) setMissionMeta(docSnap.data());
    });

    const logsCollection = collection(db, 'telemetryLogs');
    const unsubscribeLogs = onSnapshot(logsCollection, (snapshot) => {
      const fetchedLogs = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.voyagerId && data.voyagerId.toUpperCase() === voyagerId) fetchedLogs.push({ id: doc.id, ...data });
      });
      fetchedLogs.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
      setLogs(fetchedLogs);
      setLoading(false);
    });

    const commsCollection = collection(db, 'crewComms');
    const qChat = query(commsCollection, where('voyagerId', '==', voyagerId));
    const unsubscribeChat = onSnapshot(qChat, (snapshot) => {
      const messages = [];
      snapshot.forEach((doc) => {
        messages.push({ id: doc.id, ...doc.data() });
      });
      messages.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
      setChatMessages(messages);
    });

    return () => { unsubscribeAuth(); unsubscribeMission(); unsubscribeLogs(); unsubscribeChat(); };
  }, [voyagerId]);

  const unifiedWaypointTimeline = [];
  if (missionMeta && missionMeta.latitude && missionMeta.longitude) {
    unifiedWaypointTimeline.push({
      id: 'LAUNCH_BASE',
      handlerName: 'MISSION CONTROL',
      reportedLocation: `LAUNCHPAD DEPLOYMENT: ${missionMeta.originCity || 'ORIGIN'}`,
      latitude: missionMeta.latitude,
      longitude: missionMeta.longitude,
      isLaunchPad: true,
      displayDateRaw: missionMeta.launchDate, 
      displayIndex: 1
    });
  }

  logs.forEach((log) => {
    unifiedWaypointTimeline.push({
      ...log,
      isLaunchPad: false,
      displayDateRaw: log.timestamp, 
      displayIndex: unifiedWaypointTimeline.length + 1
    });
  });

  useEffect(() => {
    const timerInterval = setInterval(() => {
      const currentTime = new Date().getTime();
      if (missionMeta?.launchDate) {
        setTimeSinceLaunch(formatOperationalDuration(currentTime - new Date(missionMeta.launchDate).getTime(), true));
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
  }, [missionMeta, logs, unifiedWaypointTimeline.length]);

  const handleSendCommsMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !userProfile || !hasVerifiedCheckinAccess) return;
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

  const mapRoutingPolylinePoints = unifiedWaypointTimeline
    .map(l => [parseFloat(l.latitude), parseFloat(l.longitude)])
    .filter(p => !isNaN(p[0]) && !isNaN(p[1]));

  const currentMapCenter = mapRoutingPolylinePoints.length > 0 ? mapRoutingPolylinePoints[mapRoutingPolylinePoints.length - 1] : defaultCenter;
  const isCenterValid = currentMapCenter && !isNaN(currentMapCenter[0]) && !isNaN(currentMapCenter[1]);
  const newestFirstLedgerDisplayList = [...unifiedWaypointTimeline].reverse();

  const hasVerifiedCheckinAccess = userProfile?.role === 'admin' || logs.some(log => 
    log.handlerName && userProfile?.username && log.handlerName.trim().toLowerCase() === userProfile.username.trim().toLowerCase()
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col h-screen overflow-hidden">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />

      <header className="p-4 border-b border-slate-900 bg-slate-900/60 backdrop-blur shrink-0 z-50">
        <div className="max-w-7xl mx-auto flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
          <div className="space-y-1.5">
            {fromCheckin === 'true' && (
              <Link href={`/mission/${voyagerId.toLowerCase()}/checkin`} className="inline-block text-[10px] font-mono uppercase font-bold text-blue-500 tracking-widest hover:underline mb-0.5">
                ← Return to Field Portal
              </Link>
            )}
            <div className="flex items-center space-x-3">
              <h1 className="text-xl font-black tracking-wider text-slate-200 uppercase">LOGBOOK // {voyagerId}</h1>
              <span className="px-2 py-0.5 text-[9px] font-mono font-bold tracking-widest uppercase rounded bg-blue-950/60 text-blue-400 border border-blue-900/40">
                TRAVELLING
              </span>
            </div>
            {missionMeta && <p className="text-[10px] font-mono text-slate-500 uppercase">Registry Vector: {missionMeta.originCity} → {missionMeta.destinationCity}</p>}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full xl:w-auto font-mono text-left">
            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-900"><span className="text-[9px] text-slate-500 block uppercase">T-MET (SINCE LAUNCH)</span><span className="text-xs font-black text-blue-400 tracking-widest">{timeSinceLaunch}</span></div>
            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-900"><span className="text-[9px] text-slate-500 block uppercase">TSLC (SINCE CHECKIN)</span><span className="text-xs font-black text-emerald-400 tracking-widest">{timeSinceCheckin}</span></div>
            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-900"><span className="text-[9px] text-slate-500 block uppercase">DISPLACEMENT</span><span className="text-sm font-black text-amber-500">{milesFromLaunch.toLocaleString()} MI</span></div>
            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-900"><span className="text-[9px] text-slate-500 block uppercase">TOTAL MILES TRAVELED</span><span className="text-sm font-black text-cyan-400">{totalMilesTraveled.toLocaleString()} MI</span></div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden max-w-7xl w-full mx-auto relative z-10">
        <section className="w-full md:w-1/2 h-64 md:h-full border-b md:border-b-0 md:border-r border-slate-900 relative shrink-0">
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
                        Checkpoint #{log.displayIndex}<br/>Sign-off: {log.handlerName}<br/>Location: {log.reportedLocation}
                      </div>
                    </Popup>
                  </Marker>
                ))
              }
            </MapContainer>
          ) : (
            <div className="w-full h-full bg-slate-950 flex items-center justify-center font-mono text-xs text-slate-600 animate-pulse">CALIBRATING INITIAL VECTOR MAP NODES...</div>
          )}
        </section>

        <section className="w-full md:w-1/2 flex flex-col h-auto md:h-full overflow-hidden bg-slate-950/20">
          <div className="flex border-b border-slate-900 p-4 shrink-0 bg-slate-950">
            <button onClick={() => setActiveTab('ledger')} className={`flex-1 pb-2 text-xs font-bold tracking-wider uppercase transition-all ${activeTab === 'ledger' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-slate-500'}`}>Field Ledger</button>
            <button onClick={() => setActiveTab('chat')} className={`flex-1 pb-2 text-xs font-bold tracking-wider uppercase transition-all ${activeTab === 'chat' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-slate-500'}`}>Crew Comms</button>
          </div>

          <div className="flex-1 flex flex-col overflow-hidden p-4">
            {loading ? (
              <div className="text-center py-12 text-xs font-mono text-slate-600 animate-pulse">SYNCHRONIZING ARCHIVES...</div>
            ) : activeTab === 'ledger' ? (
              <div className="space-y-5 overflow-y-auto flex-1 pr-1">
                {newestFirstLedgerDisplayList.map((log) => (
                  <div key={log.id} className="p-4 bg-slate-900/50 border border-slate-900 rounded-xl space-y-4 shadow-2xl backdrop-blur-sm">
                    <div className="flex justify-between items-center text-xs font-mono">
                      <div className="flex items-center space-x-2">
                        <span className="text-blue-500 font-bold">#{log.displayIndex}</span>
                        <span className="text-slate-400 font-bold">Sign-off:</span>
                        <span className="text-slate-200 font-black tracking-wide">{log.handlerName}</span>
                      </div>
                      <span className="bg-slate-950 px-2.5 py-1 rounded-md text-slate-400 border border-slate-900 font-bold uppercase tracking-wide text-[11px]">
                        📍 {log.reportedLocation.includes("LAUNCHPAD") ? "ORIGIN VECTOR" : log.reportedLocation}
                      </span>
                    </div>

                    {log.imageUrl ? (
                      <div className="relative border border-slate-950 bg-slate-950 rounded-lg overflow-hidden shadow-inner">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={log.imageUrl} alt="Verification Asset" className="w-full h-auto max-h-80 object-cover rounded-md mx-auto" />
                      </div>
                    ) : log.isLaunchPad && (
                      <div className="p-8 text-center text-xs border border-dashed border-slate-900 rounded-xl bg-slate-950/40 text-slate-500 uppercase tracking-widest font-mono">
                        🛸 Initial Deployment Launched Successfully // Book In Transit
                      </div>
                    )}

                    <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest flex justify-between items-center bg-slate-950/40 p-2 rounded-lg border border-slate-900/40">
                      <span>{log.isLaunchPad ? "Initial Base" : "Verified Checkpoint"}</span>
                      <span className="text-slate-400 font-semibold tracking-normal">
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
                    
                    {/* CREW COMMS CONTAINER UPDATED WITH DYNAMIC TIMESTAMPS */}
                    <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 font-mono text-xs">
                      {chatMessages.length === 0 ? (
                        <div className="text-center py-12 text-slate-600 uppercase text-[10px]">Secure Channel Established. Begin Comms Broadcast...</div>
                      ) : (
                        chatMessages.map((msg) => (
                          <div key={msg.id} className="p-2.5 bg-slate-900/40 border border-slate-900/60 rounded-xl space-y-1">
                            <div className="flex justify-between items-center border-b border-slate-950/40 pb-1 text-[10px]">
                              <span className="text-blue-400 font-black">📡 {msg.username}</span>
                              <span className="text-slate-500 font-semibold">
                                ⏰ {formatDisplayDateTime(msg.timestamp)}
                              </span>
                            </div>
                            <p className="text-slate-300 break-words pt-0.5">{msg.messageText}</p>
                          </div>
                        ))
                      )}
                    </div>

                    {hasVerifiedCheckinAccess ? (
                      <form onSubmit={handleSendCommsMessage} className="border-t border-slate-900 pt-3 flex items-center space-x-2 shrink-0 bg-slate-950/40">
                        <input type="text" placeholder={`Transmit as ${userProfile.username}...`} value={newMessage} onChange={(e) => setNewMessage(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500" />
                        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs font-bold uppercase py-3 px-5 rounded-xl transition-all shadow">Send</button>
                      </form>
                    ) : (
                      <div className="border-t border-slate-900 pt-3 bg-slate-950/40 p-4 rounded-xl text-center font-mono text-[10px] text-rose-500/90 bg-rose-950/10 border border-rose-950/30 uppercase tracking-wider">
                        🔒 TRANSMISSION MUTED // RECEIVE ONLY
                        <p className="text-[9px] text-slate-500 tracking-normal lowercase mt-1">You must physically handle and check in logbook {voyagerId} to unlock its communication uplink channel.</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12 font-mono text-xs text-slate-500">
                    COMMS CHANNEL RECEPTION ONLY // SECURE OVERRIDE STAGED
                    <p className="text-[10px] text-slate-600 mt-2 lowercase">enlist via field portal to authorize communication transmission keys.</p>
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