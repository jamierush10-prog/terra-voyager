import { useState, useEffect } from 'react';
import { db, storage } from '../firebase/config';
import { collection, onSnapshot, doc, setDoc, query, where, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';

const MapContainer = dynamic(() => import('react-leaflet').then((mod) => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then((mod) => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then((mod) => mod.Marker), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then((mod) => mod.Popup), { ssr: false });

export default function HomeDashboard() {
  const router = useRouter();
  const [missions, setMissions] = useState([]);
  const [allLogs, setAllLogs] = useState([]); // Track all telemetry logs to pinpoint latest positions
  const [loading, setLoading] = useState(true);

  // Authentication Context States
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);

  // Launch Sequence Modal States
  const [selectedLaunchTv, setSelectedLaunchTv] = useState(null);
  const [originCity, setOriginCity] = useState('');
  const [destinationCity, setDestinationCity] = useState('');
  const [commencementDate, setCommencementDate] = useState('');
  const [launchLat, setLaunchLat] = useState('');
  const [launchLng, setLaunchLng] = useState('');
  
  // Image Upload States
  const [launchImageFile, setLaunchImageFile] = useState(null);
  const [launchImagePreview, setLaunchImagePreview] = useState(null);
  const [isDeploying, setIsDeploying] = useState(false);

  useEffect(() => {
    // 1. Session Auth Observer
    const auth = getAuth();
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        const usersCollection = collection(db, 'users');
        const qProfile = query(usersCollection, where('uid', '==', user.uid));
        getDocs(qProfile).then((snap) => {
          if (!snap.empty) setUserProfile(snap.docs[0].data());
        }).catch(err => console.error("Admin verification mapping fault:", err));
      } else {
        setCurrentUser(null);
        setUserProfile(null);
      }
    });

    // 2. Real-Time Sync across all voyager documents
    const missionsCollection = collection(db, 'voyagerMissions');
    const unsubscribeMissions = onSnapshot(missionsCollection, (snapshot) => {
      const activeMissions = [];
      snapshot.forEach((doc) => {
        activeMissions.push({ id: doc.id.toUpperCase(), ...doc.data() });
      });
      setMissions(activeMissions);
    });

    // 3. Real-Time Sync across all check-in telemetry logs globally
    const logsCollection = collection(db, 'telemetryLogs');
    const unsubscribeLogs = onSnapshot(logsCollection, (snapshot) => {
      const logsList = [];
      snapshot.forEach((doc) => {
        logsList.push({ id: doc.id, ...doc.data() });
      });
      // Sort chronologically so newest logs are easily identifiable
      logsList.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
      setAllLogs(logsList);
      setLoading(false);
    });

    return () => {
      unsubscribeAuth();
      unsubscribeMissions();
      unsubscribeLogs();
    };
  }, []);

  const handleImageFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const handleCommenceLaunch = async (e) => {
    e.preventDefault();
    if (userProfile?.role !== 'admin') {
      alert("UNAUTHORIZED ACCESS: Admin permissions required.");
      return;
    }

    if (!originCity || !destinationCity || !commencementDate || !launchLat || !launchLng) {
      alert("Please fill out all positioning parameters.");
      return;
    }

    const parsedLat = parseFloat(launchLat);
    const parsedLng = parseFloat(launchLng);

    if (isNaN(parsedLat) || isNaN(parsedLng)) {
      alert("Validation Error: Coordinates must be valid numeric expressions.");
      return;
    }

    setIsDeploying(true);
    let uploadedCoverUrl = '';

    try {
      if (launchImageFile) {
        const fileRef = ref(storage, `deployments/${selectedLaunchTv}-${Date.now()}-${launchImageFile.name}`);
        const snapshot = await uploadBytes(fileRef, launchImageFile);
        uploadedCoverUrl = await getDownloadURL(snapshot.ref);
      }

      const secureToken = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);

      await setDoc(doc(db, 'voyagerMissions', selectedLaunchTv), {
        originCity: originCity.trim(),
        destinationCity: destinationCity.trim(),
        launchDate: new Date(commencementDate).toISOString(),
        status: 'ACTIVE',
        secretToken: secureToken,
        latitude: parsedLat,
        longitude: parsedLng,
        coverImageUrl: uploadedCoverUrl,
        crewRoster: []
      });

      setSelectedLaunchTv(null);
      setOriginCity(''); setDestinationCity(''); setCommencementDate(''); setLaunchLat(''); setLaunchLng('');
      setLaunchImageFile(null); setLaunchImagePreview(null);
    } catch (error) {
      console.error("Deployment initialization fault:", error);
      alert(`System Error: ${error.message}`);
    } finally {
      setIsDeploying(false);
    }
  };

  // DYNAMIC MAP PIN RESOLUTION PIPELINE: Always calculates the absolute newest vector node location
  const mapActivePins = missions
    .filter(m => m.status === 'ACTIVE')
    .map(mission => {
      // Find all check-ins for this specific book module
      const bookSpecificLogs = allLogs.filter(log => log.voyagerId?.toUpperCase() === mission.id.toUpperCase());
      
      // If handlers have posted live updates, grab the coordinates from the newest check-in log document
      if (bookSpecificLogs.length > 0) {
        const absoluteNewestCheckin = bookSpecificLogs[bookSpecificLogs.length - 1];
        return {
          id: mission.id,
          latitude: absoluteNewestCheckin.latitude,
          longitude: absoluteNewestCheckin.longitude,
          originCity: mission.originCity,
          destinationCity: mission.destinationCity,
          currentLocationLabel: absoluteNewestCheckin.reportedLocation || 'In Transit'
        };
      }

      // Fallback: If no check-ins have occurred yet, render the baseline launch pad configuration location
      return {
        id: mission.id,
        latitude: mission.latitude,
        longitude: mission.longitude,
        originCity: mission.originCity,
        destinationCity: mission.destinationCity,
        currentLocationLabel: `Launched from ${mission.originCity}`
      };
    })
    .filter(pin => pin.latitude && pin.longitude && !isNaN(pin.latitude) && !isNaN(pin.longitude));

  const isCurrentUserAdmin = userProfile?.role === 'admin';
  const baseFloorLimitCount = 20;

  const maxDeployedIndexId = missions.reduce((max, m) => {
    const match = m.id.match(/TV-(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      return num > max ? num : max;
    }
    return max;
  }, baseFloorLimitCount); 

  const generatedDynamicFleetIds = Array.from({ length: maxDeployedIndexId }, (_, i) => {
    const numericIndex = i + 1;
    const paddingValue = numericIndex < 10 ? '0' : '';
    return `TV-${paddingValue}${numericIndex}`;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col h-screen overflow-hidden font-sans">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />

      {/* TOP RADAR MONITOR PATH LINES MAP */}
      <section className="h-2/5 w-full border-b border-slate-900 relative z-10 shrink-0 bg-slate-950">
        <MapContainer center={[37.0902, -95.7129]} zoom={4} style={{ height: '100%', width: '100%', background: '#020617' }} zoomControl={false}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
          {mapActivePins.map((pin) => (
            <Marker key={pin.id} position={[pin.latitude, pin.longitude]}>
              <Popup>
                <div className="text-slate-900 font-mono text-xs font-bold p-1">
                  <span className="text-blue-600 block font-black">{pin.id} // ACTIVE</span>
                  Position: {pin.currentLocationLabel}<br/>
                  Registry: {pin.originCity} → {pin.destinationCity}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </section>

      {/* BOTTOM CONTROL CARD GRID HOUSING */}
      <section className="flex-1 p-6 overflow-y-auto max-w-6xl w-full mx-auto space-y-4">
        <header className="text-center">
          <h2 className="text-xs font-mono font-bold tracking-widest text-slate-500 uppercase">Fleet Status Array</h2>
        </header>

        {loading ? (
          <div className="text-center py-12 font-mono text-xs text-slate-600 animate-pulse">STREAMING MISSION REGISTRIES...</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {generatedDynamicFleetIds.map((id) => {
              const activeRecord = missions.find(m => m.id === id);
              const isLaunched = !!activeRecord;
              const currentStatus = activeRecord?.status || 'STAGED';

              return (
                <div 
                  key={id} 
                  onClick={() => {
                    if (currentStatus === 'ACTIVE') {
                      router.push(`/mission/${id.toLowerCase()}`);
                    } else if (isCurrentUserAdmin) {
                      setSelectedLaunchTv(id);
                      setCommencementDate(new Date().toISOString().slice(0, 16));
                    }
                  }}
                  className={`border rounded-2xl p-6 flex flex-col items-center justify-center min-h-[140px] shadow-lg transition-all select-none ${
                    currentStatus === 'ACTIVE'
                      ? 'bg-slate-900 border-slate-800 hover:border-slate-600 cursor-pointer hover:bg-slate-900/80'
                      : `bg-slate-900/20 border-slate-900 text-slate-500/80 ${isCurrentUserAdmin ? 'cursor-pointer hover:border-blue-900 hover:bg-slate-900/40' : 'cursor-default'}`
                  }`}
                >
                  <div className="text-center space-y-2">
                    <span className={`block font-mono text-base font-black tracking-wide ${currentStatus === 'ACTIVE' ? 'text-slate-200' : 'text-slate-500'}`}>
                      {id}
                    </span>
                    <span className={`inline-block font-mono text-[9px] font-bold px-2 py-0.5 rounded tracking-widest border ${
                      currentStatus === 'ACTIVE' 
                        ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/40' 
                        : 'bg-slate-950 text-slate-500/40 border-slate-900/60'
                    }`}>
                      {currentStatus}
                    </span>
                  </div>
                  
                  <div className="text-[9px] font-mono uppercase mt-4">
                    {currentStatus === 'ACTIVE' ? (
                      <span className="text-blue-400 font-bold">Monitor Deck →</span>
                    ) : isCurrentUserAdmin ? (
                      <span className="text-slate-400 font-semibold underline decoration-dotted">🔒 Click to Deploy</span>
                    ) : (
                      <span className="text-slate-600 font-medium tracking-wide">Staged Log</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* LAUNCH FORM MODAL OVERLAY */}
      {selectedLaunchTv && isCurrentUserAdmin && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
            <header className="flex justify-between items-center border-b border-slate-800 pb-3">
              <div>
                <span className="text-[9px] text-blue-400 font-mono uppercase font-bold tracking-widest">Launch Sequence</span>
                <h3 className="text-lg font-black font-mono text-slate-200">INITIALIZE: {selectedLaunchTv}</h3>
              </div>
              <button onClick={() => { setSelectedLaunchTv(null); setLaunchImagePreview(null); setLaunchImageFile(null); }} className="text-slate-500 hover:text-slate-300 font-mono text-xs uppercase font-bold tracking-wider">Cancel</button>
            </header>

            <form onSubmit={handleCommenceLaunch} className="space-y-4 font-mono text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">1. Launch Pad Origin City</label>
                  <input type="text" required placeholder="e.g. Daphne, AL" value={originCity} onChange={(e) => setOriginCity(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">2. Target Destination</label>
                  <input type="text" required placeholder="e.g. Boston, MA" value={destinationCity} onChange={(e) => setDestinationCity(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-blue-500" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 bg-slate-950 p-3 rounded-xl border border-slate-850">
                <div>
                  <label className="block text-[9px] uppercase font-bold text-slate-500 mb-1">Launch Latitude</label>
                  <input type="text" required placeholder="e.g. 30.6035" value={launchLat} onChange={(e) => setLaunchLat(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-slate-100 focus:outline-none focus:border-blue-500 font-bold" />
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-bold text-slate-500 mb-1">Launch Longitude</label>
                  <input type="text" required placeholder="e.g. -87.9011" value={launchLng} onChange={(e) => setLaunchLng(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-slate-100 focus:outline-none focus:border-blue-500 font-bold" />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">3. Commencement Date</label>
                <input type="datetime-local" required value={commencementDate} onChange={(e) => setCommencementDate(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-400 focus:outline-none focus:border-blue-500" />
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1.5">4. Upload Launch Photo Cover (Required)</label>
                {launchImagePreview ? (
                  <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950 p-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={launchImagePreview} alt="Launch Cover Preview" className="w-full h-36 object-cover rounded-lg" />
                    <button type="button" onClick={() => { setLaunchImageFile(null); setLaunchImagePreview(null); }} className="absolute top-3 right-3 bg-rose-600 hover:bg-rose-700 text-white font-mono text-[9px] uppercase font-bold px-2 py-0.5 rounded shadow">Clear</button>
                  </div>
                ) : (
                  <div className="relative border border-dashed border-slate-800 rounded-xl bg-slate-950 hover:border-slate-700 transition-colors">
                    <input type="file" accept="image/*" required onChange={handleImageFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20" />
                    <div className="p-5 text-center space-y-1">
                      <span className="text-xl block">📸</span>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Select Cover Snapshot</span>
                    </div>
                  </div>
                )}
              </div>

              <button type="submit" disabled={isDeploying} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 text-white font-mono font-black py-3.5 px-4 rounded-xl uppercase tracking-widest text-xs transition-all shadow-xl mt-2">
                🚀 COMMENCE VEHICLE LAUNCH
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}