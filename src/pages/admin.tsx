import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { db, storage } from '../firebase/config';
import { collection, onSnapshot, doc, setDoc, updateDoc, getDoc, query, where, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import Link from 'next/link';

export default function AdminDashboard() {
  const router = useRouter();
  const [vessels, setVessels] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // ROLE GATEKEEPING STATES
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);

  // COPIED ALERT TIMER HOOK
  const [copiedVesselId, setCopiedVesselId] = useState('');

  // --- NEW VESSEL LAUNCH MODAL STATES ---
  const [isLaunchModalOpen, setIsLaunchModalOpen] = useState(false);
  const [launchVoyagerId, setLaunchVoyagerId] = useState('');
  const [launchOriginCity, setLaunchOriginCity] = useState('');
  const [launchDestinationCity, setLaunchDestinationCity] = useState('');
  const [launchLatitude, setLaunchLatitude] = useState('');
  const [launchLongitude, setLaunchLongitude] = useState('');
  const [launchImageFile, setLaunchImageFile] = useState<File | null>(null);
  const [launchingAction, setLaunchingAction] = useState(false);
  const [launchError, setLaunchError] = useState('');

  // TELEMETRY CORRECTION MODAL STATES
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState('');
  const [editVoyagerId, setEditVoyagerId] = useState('');
  const [editHandlerName, setEditHandlerName] = useState('');
  const [editReportedLocation, setEditReportedLocation] = useState('');
  const [editLatitude, setEditLatitude] = useState('');
  const [editLongitude, setEditLongitude] = useState('');
  const [editIsVerified, setEditIsVerified] = useState(false);
  const [savingAction, setSavingAction] = useState(false);

  // 1. ENFORCE STRICT ADMIN ROLE GATEWAY HANDSHAKE
  useEffect(() => {
    const auth = getAuth();
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.push('/');
      } else {
        const usersCollection = collection(db, 'users');
        const qProfile = query(usersCollection, where('uid', '==', user.uid));
        
        getDocs(qProfile).then((snap) => {
          if (!snap.empty && snap.docs[0].data().role === 'admin') {
            setIsAuthorized(true);
            setCheckingAccess(false);
          } else {
            router.push('/');
          }
        }).catch((err) => {
          console.error("Access verification fault:", err);
          router.push('/');
        });
      }
    });

    return () => unsubscribeAuth();
  }, [router]);

  // 2. STREAM ACTIVE REGISTRIES AND TELEMETRY CHANNELS
  useEffect(() => {
    if (!isAuthorized) return;

    const mCollection = collection(db, 'voyagerMissions');
    const unsubscribeVessels = onSnapshot(mCollection, (snapshot) => {
      const fetchedVessels: any[] = [];
      snapshot.forEach((doc) => {
        fetchedVessels.push({ id: doc.id, ...doc.data() });
      });
      fetchedVessels.sort((a, b) => a.id.localeCompare(b.id));
      setVessels(fetchedVessels);
    });

    const logsCollection = collection(db, 'telemetryLogs');
    const unsubscribeLogs = onSnapshot(logsCollection, (snapshot) => {
      const fetchedLogs: any[] = [];
      snapshot.forEach((doc) => {
        fetchedLogs.push({ id: doc.id, ...doc.data() });
      });
      // Sort chronologically to properly calculate the handoff sequence
      fetchedLogs.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
      setLogs(fetchedLogs);
      setLoading(false);
    }, (err) => {
      console.error("Stream tracking hook error:", err);
      setLoading(false);
    });

    return () => { unsubscribeVessels(); unsubscribeLogs(); };
  }, [isAuthorized]);

  const generateRandomUrlString = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const length = Math.floor(Math.random() * 4) + 12;
    let randomString = '';
    for (let i = 0; i < length; i++) {
      randomString += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return randomString;
  };

  const handleCopyRandomizedCheckinLink = (vessel: any) => {
    const vesselIdLower = vessel.id.toLowerCase();
    const cleanOrigin = window.location.origin;
    const randomSuffix = generateRandomUrlString();
    const directCheckinUrl = `${cleanOrigin}/mission/${vesselIdLower}/checkin/${randomSuffix}`;
    
    navigator.clipboard.writeText(directCheckinUrl).then(() => {
      setCopiedVesselId(vessel.id);
      setTimeout(() => setCopiedVesselId(''), 2000);
    }).catch(err => console.error("Clipboard routing fault:", err));
  };

  const handleLaunchNewVessel = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetVesselId = launchVoyagerId.trim().toUpperCase();
    
    if (!targetVesselId || !launchOriginCity.trim() || !launchDestinationCity.trim() || !launchLatitude.trim() || !launchLongitude.trim()) return;

    setLaunchingAction(true);
    setLaunchError('');
    let uploadedImageUrl = '';

    try {
      if (launchImageFile) {
        const storageRef = ref(storage, `launches/${targetVesselId}_${Date.now()}_${launchImageFile.name}`);
        const uploadSnapshot = await uploadBytes(storageRef, launchImageFile);
        uploadedImageUrl = await getDownloadURL(uploadSnapshot.ref);
      }

      const launchTimestampIso = new Date().toISOString();

      await setDoc(doc(db, 'voyagerMissions', targetVesselId), {
        missionId: targetVesselId,
        originCity: launchOriginCity.trim(),
        destinationCity: launchDestinationCity.trim(),
        latitude: launchLatitude.trim(),
        longitude: launchLongitude.trim(),
        launchImageUrl: uploadedImageUrl,
        launchDate: launchTimestampIso
      });

      const initialSeedLogRef = doc(collection(db, 'telemetryLogs'));
      await setDoc(initialSeedLogRef, {
        voyagerId: targetVesselId,
        handlerName: 'SYSTEM CONSOLE',
        reportedLocation: `DEPLOYMENT VECTOR: ${launchOriginCity.trim().toUpperCase()}`,
        latitude: launchLatitude.trim(),
        longitude: launchLongitude.trim(),
        imageUrl: uploadedImageUrl,
        timestamp: new Date(),
        verified: true,
        isLaunchPad: true
      });

      setLaunchVoyagerId('');
      setLaunchOriginCity('');
      setLaunchDestinationCity('');
      setLaunchLatitude('');
      setLaunchLongitude('');
      setLaunchImageFile(null);
      setIsLaunchModalOpen(false);
    } catch (err: any) {
      console.error("Vessel provisioning deployment error:", err);
      setLaunchError('Mainframe validation error while committing vessel profile.');
    } finally {
      setLaunchingAction(false);
    }
  };

  const openCorrectionModal = (log: any) => {
    setSelectedLogId(log.id);
    setEditVoyagerId(log.voyagerId || '');
    setEditHandlerName(log.handlerName || '');
    setEditReportedLocation(log.reportedLocation || '');
    setEditLatitude(log.latitude || '');
    setEditLongitude(log.longitude || '');
    setEditIsVerified(log.verified === true);
    setIsEditModalOpen(true);
  };

  const handleSaveTelemetryCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLogId) return;

    setSavingAction(true);
    try {
      const logDocRef = doc(db, 'telemetryLogs', selectedLogId);
      await updateDoc(logDocRef, {
        voyagerId: editVoyagerId.trim().toUpperCase(),
        handlerName: editHandlerName.trim(),
        reportedLocation: editReportedLocation.trim().toUpperCase(),
        latitude: editLatitude.trim(),
        longitude: editLongitude.trim(),
        verified: editIsVerified
      });
      setIsEditModalOpen(false);
    } catch (err) {
      console.error("Failed to commit telemetry update:", err);
    } finally {
      setSavingAction(false);
    }
  };

  const formatDisplayDate = (timestampValue: any) => {
    if (!timestampValue) return 'Pending...';
    const d = typeof timestampValue.toDate === 'function' ? timestampValue.toDate() : new Date(timestampValue);
    return isNaN(d.getTime()) ? 'Invalid Time' : d.toLocaleString();
  };

  // Helper inside the map to determine if a specific log entry has earned its verification handoff status
  const checkLogHasEarnedHandoffStar = (currentLog: any, currentIndex: number, allLogs: any[]) => {
    if (!currentLog.voyagerId) return false;
    // Look through all succeeding logs for the SAME vessel to find if at least one newer check-in is verified
    const vesselLogs = allLogs.filter(l => l.voyagerId && l.voyagerId.toUpperCase() === currentLog.voyagerId.toUpperCase());
    const internalVesselIdx = vesselLogs.findIndex(l => l.id === currentLog.id);
    
    if (internalVesselIdx === -1) return false;
    for (let i = internalVesselIdx + 1; i < vesselLogs.length; i++) {
      if (vesselLogs[i].verified === true) return true;
    }
    return false;
  };

  if (checkingAccess) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center font-mono text-xs text-slate-400 animate-pulse uppercase tracking-widest">Verifying Admin Security Clearance...</div>;
  }

  // Reverse logs right at render time so newest streams sit at the top visually
  const displayLogsNewestFirst = [...logs].reverse();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-4 md:p-6 flex flex-col h-screen overflow-hidden">
      
      <header className="pb-4 border-b border-slate-900 grid grid-cols-1 md:grid-cols-2 items-center gap-4 shrink-0">
        <div>
          <h1 className="text-xl font-black tracking-widest uppercase text-slate-100">COMMAND CONTROL CENTER</h1>
          <p className="text-[10px] font-mono text-emerald-400 font-bold uppercase tracking-widest mt-0.5">Secure Mainframe Override Panel</p>
        </div>
        <div className="flex md:justify-end items-center space-x-3 w-full">
          <Link href="/" className="text-xs font-mono font-bold bg-slate-900 border border-slate-800 hover:bg-slate-800 px-4 py-2.5 rounded-xl transition-all uppercase tracking-wider text-slate-200 whitespace-nowrap">
            ← Main Console
          </Link>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto space-y-6 mt-4 pr-1">
        
        <div className="bg-slate-900/40 border border-slate-900 rounded-2xl p-4 shadow-2xl space-y-3">
          <h2 className="text-xs font-mono font-black tracking-widest text-slate-200 uppercase">Active Deployed Vessels</h2>
          {vessels.length === 0 ? (
            <p className="text-[11px] font-mono text-slate-500 uppercase">No active vessel nodes found in system database registry.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {vessels.map((vessel) => (
                <div key={vessel.id} className="bg-slate-950/80 border border-slate-900 p-3 rounded-xl flex flex-col justify-between items-center space-y-3 font-mono text-xs">
                  <div className="text-center">
                    <span className="text-white font-black text-[13px] block">{vessel.id}</span>
                    <span className="text-[9px] text-slate-400 block truncate mt-0.5">Matrix Enabled</span>
                  </div>
                  <button
                    onClick={() => handleCopyRandomizedCheckinLink(vessel)}
                    className={`w-full text-center font-bold text-[10px] py-1.5 px-2 rounded-lg uppercase tracking-wider transition-all shadow ${
                      copiedVesselId === vessel.id ? 'bg-emerald-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    {copiedVesselId === vessel.id ? '✓ Link Copied' : 'Copy Link'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-slate-900/40 border border-slate-900 rounded-2xl flex flex-col shadow-2xl">
          <div className="p-4 border-b border-slate-900 bg-slate-950/80 backdrop-blur">
            <h2 className="text-xs font-mono font-black tracking-widest text-slate-200 uppercase">Incoming Fleet Telemetry Stream Logs</h2>
          </div>

          <div className="p-4 max-h-[500px] overflow-y-auto">
            {loading ? (
              <div className="text-center py-6 font-mono text-xs text-slate-500 animate-pulse">SYNCHRONIZING FEED LAYERS...</div>
            ) : displayLogsNewestFirst.length === 0 ? (
              <div className="text-center py-6 font-mono text-xs text-slate-500 uppercase tracking-widest">No Telemetry streams captured in cloud nodes yet.</div>
            ) : (
              <div className="space-y-3">
                {displayLogsNewestFirst.map((log, idx) => {
                  // Calculate index against original chronologically sorted state array
                  const originalStateIndex = logs.findIndex(l => l.id === log.id);
                  const isHandoffVerified = checkLogHasEarnedHandoffStar(log, originalStateIndex, logs);

                  return (
                    <div key={log.id} className="p-4 bg-slate-950/80 border border-slate-900 rounded-xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 font-mono text-xs shadow-md">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center space-x-3 flex-wrap gap-y-1">
                          <span className="text-blue-400 font-black text-sm tracking-wider">{log.voyagerId || 'UNKNOWN'}</span>
                          <span className="text-slate-100 font-bold">Sign-off: <span className="text-white font-black">{log.handlerName || 'None'}</span></span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-900 text-slate-300 border border-slate-800">
                            📍 {log.reportedLocation || 'UNRESOLVED'}
                          </span>
                          {log.verified && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-emerald-950/40 text-emerald-400 border border-emerald-900/40">
                              ✓ Approved Log
                            </span>
                          )}
                          {/* INJECT DYNAMIC HANDOFF STAR DISPLAY LOGIC INSIDE STREAM */}
                          {isHandoffVerified && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-blue-950/80 text-blue-400 border border-blue-900/40 tracking-wider">
                              🔷 Handoff Star Earned
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-slate-300 pt-0.5">
                          <div><span className="text-slate-500 font-bold">LAT:</span> {log.latitude || 'NOT SET'}</div>
                          <div><span className="text-slate-500 font-bold">LONG:</span> {log.longitude || 'NOT SET'}</div>
                          <div className="col-span-2 text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">Timestamp: {formatDisplayDate(log.timestamp)}</div>
                        </div>
                      </div>

                      <button
                        onClick={() => openCorrectionModal(log)}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] px-3.5 py-2 rounded-lg transition-all uppercase tracking-wider shrink-0 shadow w-full sm:w-auto text-center"
                      >
                        Correct Data
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* TELEMETRY CALIBRATION OVERRIDE MODAL */}
      {isEditModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-2xl relative font-mono text-xs text-slate-100">
            <header className="text-center space-y-1">
              <h3 className="text-sm font-black tracking-widest uppercase text-white">TELEMETRY VECTOR OVERRIDE</h3>
              <p className="text-[9px] text-slate-400 uppercase tracking-wider">Modifying Transmission Log Signature Reference</p>
            </header>

            <form onSubmit={handleSaveTelemetryCorrection} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-300 uppercase">VESSEL KEY ID</label>
                  <input type="text" required value={editVoyagerId} onChange={(e) => setEditVoyagerId(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-blue-500 font-bold uppercase" />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-300 uppercase">HANDLER NAME</label>
                  <input type="text" required value={editHandlerName} onChange={(e) => setEditHandlerName(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-blue-500 font-bold" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-bold text-slate-300 uppercase">REPORTED LOCATION NAME</label>
                <input type="text" required value={editReportedLocation} onChange={(e) => setEditReportedLocation(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-blue-500 uppercase font-bold" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-300 uppercase">GRID LATITUDE (X)</label>
                  <input type="text" placeholder="e.g. 36.1627" value={editLatitude} onChange={(e) => setEditLatitude(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-blue-500 font-bold" />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-300 uppercase">GRID LONGITUDE (Y)</label>
                  <input type="text" placeholder="e.g. -86.7816" value={editLongitude} onChange={(e) => setEditLongitude(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-blue-500 font-bold" />
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between mt-2">
                <div className="space-y-0.5">
                  <span className="text-[10px] font-black tracking-wide uppercase text-slate-100">VERIFIED HANDLER CHECK-IN</span>
                  <p className="text-[9px] text-slate-400 lowercase font-normal">Authorize stream accuracy status validation flag</p>
                </div>
                <input 
                  type="checkbox" 
                  checked={editIsVerified} 
                  onChange={(e) => setEditIsVerified(e.target.checked)}
                  className="w-5 h-5 accent-blue-500 cursor-pointer rounded border-slate-800 focus:ring-0 bg-slate-950"
                />
              </div>

              <div className="pt-2 flex flex-col space-y-2">
                <button type="submit" disabled={savingAction} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold uppercase tracking-widest py-3 px-4 rounded-xl transition-all disabled:opacity-50">
                  {savingAction ? 'SAVING DATA CORRECTIONS...' : 'COMMIT OVERRIDE MATRIX'}
                </button>
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="w-full bg-transparent text-slate-400 hover:text-slate-200 uppercase tracking-wider py-1.5 font-bold text-[10px]">
                  [Abort Override Request]
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}