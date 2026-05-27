import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, onSnapshot, doc, updateDoc, setDoc } from 'firebase/firestore';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';

export default function AdminDashboard() {
  // Master Logbook Deployment State Parameters
  const [voyagerId, setVoyagerId] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [launchDate, setLaunchDate] = useState('');
  const [launchLat, setLaunchLat] = useState('');
  const [launchLng, setLaunchLng] = useState('');
  
  // Account Provisioning States
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [setupSecurityKey, setSetupSecurityKey] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  // Live Stream Feed Datasets
  const [deployedMissions, setDeployedMissions] = useState([]);
  const [allCheckinLogs, setAllCheckinLogs] = useState([]);
  const [loadingFeeds, setLoadingFeeds] = useState(true);

  // Modal Coordinate Editor States
  const [activeModalTarget, setActiveModalTarget] = useState(null); // 'mission' or 'checkin'
  const [selectedDocId, setSelectedDocId] = useState('');
  const [modalTitle, setModalTitle] = useState('');
  const [modalLat, setModalLat] = useState('');
  const [modalLng, setModalLng] = useState('');
  const [isPatchingCoords, setIsPatchingCoords] = useState(false);

  // Configuration Drawer Overlays
  const [isLinksModalOpen, setIsLinksModalOpen] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);

  const BACKDOOR_SECURITY_PASSPHRASE = "CHIEF_LOGISTICS_2026"; 

  useEffect(() => {
    // 1. Live stream every launched Voyager record book
    const mCollection = collection(db, 'voyagerMissions');
    const unsubscribeMissions = onSnapshot(mCollection, (snapshot) => {
      const missions = [];
      snapshot.forEach((doc) => {
        missions.push({ id: doc.id, ...doc.data() });
      });
      missions.sort((a, b) => new Date(b.launchDate).getTime() - new Date(a.launchDate).getTime());
      setDeployedMissions(missions);
    });

    // 2. Live stream every field checkpoint log transmitted
    const logsCollection = collection(db, 'telemetryLogs');
    const unsubscribeLogs = onSnapshot(logsCollection, (snapshot) => {
      const logs = [];
      snapshot.forEach((doc) => {
        logs.push({ id: doc.id, ...doc.data() });
      });
      logs.sort((a, b) => {
        const tA = a.timestamp?.seconds || 0;
        const tB = b.timestamp?.seconds || 0;
        return tB - tA;
      });
      setAllCheckinLogs(logs);
      setLoadingFeeds(false);
    });

    return () => {
      unsubscribeMissions();
      unsubscribeLogs();
    };
  }, []);

  // Open coordinate modifier configuration workspace
  const openCoordinatesModal = (type, item) => {
    setActiveModalTarget(type);
    setSelectedDocId(item.id);
    setModalLat(item.latitude || '');
    setModalLng(item.longitude || '');
    
    if (type === 'mission') {
      setModalTitle(`Modify Mission Base Coords: ${item.id}`);
    } else {
      setModalTitle(`Modify Check-In Coords: ${item.handlerName} (${item.voyagerId})`);
    }
  };

  const closeCoordinatesModal = () => {
    setActiveModalTarget(null);
    setSelectedDocId('');
    setModalTitle('');
    setModalLat('');
    setModalLng('');
  };

  // Submit modification update payload straight to Firestore
  const handlePatchCoordinatesSubmit = async (e) => {
    e.preventDefault();
    if (!selectedDocId || !modalLat || !modalLng) {
      alert("Please provide valid entries for both properties.");
      return;
    }

    const latNum = parseFloat(modalLat);
    const lngNum = parseFloat(modalLng);

    if (isNaN(latNum) || isNaN(lngNum)) {
      alert("Validation Error: Latitude and Longitude fields must be parsed as clean numbers.");
      return;
    }

    setIsPatchingCoords(true);
    const collectionPath = activeModalTarget === 'mission' ? 'voyagerMissions' : 'telemetryLogs';

    try {
      const docRef = doc(db, collectionPath, selectedDocId);
      await updateDoc(docRef, {
        latitude: latNum,
        longitude: lngNum
      });

      alert("TELEMETRY UPDATED: Document geometry overwritten successfully.");
      closeCoordinatesModal();
    } catch (err) {
      console.error("Database tracking geometry sync failure:", err);
      alert(`System Error: ${err.message}`);
    } finally {
      setIsPatchingCoords(false);
    }
  };

  const handleRegisterAdminAccount = async (e) => {
    e.preventDefault();
    if (!adminEmail || !adminUsername || !adminPassword) {
      alert("Please fill out all identity profile fields.");
      return;
    }

    if (setupSecurityKey !== BACKDOOR_SECURITY_PASSPHRASE) {
      alert("SECURITY BREACH VETO: The provided Setup Security Key is invalid.");
      return;
    }

    setIsRegistering(true);
    const auth = getAuth();

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, adminEmail.trim(), adminPassword);
      const user = userCredential.user;

      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        email: user.email.toLowerCase().trim(),
        username: adminUsername.trim().replace(/\s+/g, '_'),
        role: 'admin', 
        createdAt: new Date().toISOString()
      });

      alert(`ADMIN ACCOUNT PROVISIONED:\nWelcome, ${adminUsername}. Your profile is active.`);
      setShowRegisterForm(false);
      setAdminEmail(''); setAdminUsername(''); setAdminPassword(''); setSetupSecurityKey('');
    } catch (error) {
      console.error("Administrative profile provision fault:", error);
      alert(`Provision Error: ${error.message}`);
    } finally {
      setIsRegistering(false);
    }
  };

  const handleLaunchLogbook = async (e) => {
    e.preventDefault();
    if (!voyagerId || !origin || !destination || !launchDate || !launchLat || !launchLng) {
      alert("Please fill out all launch parameters including coordinates.");
      return;
    }

    const latNum = parseFloat(launchLat);
    const lngNum = parseFloat(launchLng);

    if (isNaN(latNum) || isNaN(lngNum)) {
      alert("Validation Error: Coordinates must be valid numbers.");
      return;
    }

    setIsLaunching(true);
    const randomizedToken = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);

    try {
      await setDoc(doc(db, 'voyagerMissions', voyagerId.toUpperCase().trim()), {
        originCity: origin.trim(),
        destinationCity: destination.trim(),
        launchDate: new Date(launchDate).toISOString(),
        status: 'ACTIVE',
        secretToken: randomizedToken,
        latitude: latNum,
        longitude: lngNum,
        crewRoster: []
      });

      alert(`LAUNCH SUCCESSFUL: Logbook ${voyagerId.toUpperCase()} deployed.`);
      setVoyagerId(''); setOrigin(''); setDestination(''); setLaunchDate(''); setLaunchLat(''); setLaunchLng('');
    } catch (error) {
      console.error("Launch failure:", error);
      alert("System fault: Failed to register deployment parameters.");
    } finally {
      setIsLaunching(false);
    }
  };

  const handleCopyCheckinLink = (secretToken) => {
    if (!secretToken) {
      alert("Error: This unit is missing an active token.");
      return;
    }
    const secureDomainUrl = window.location.origin;
    const completeCheckinAddress = `${secureDomainUrl}/mission/${secretToken}/checkin`;

    navigator.clipboard.writeText(completeCheckinAddress)
      .then(() => alert("COPIED TO CLIPBOARD:\n" + completeCheckinAddress))
      .catch(err => console.error("Clipboard blocking error:", err));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6 space-y-8 flex flex-col items-center">
      
      {/* HEADER CONTROL PANEL NAVIGATION HUD BAR */}
      <div className="w-full max-w-6xl flex flex-col sm:flex-row justify-between items-center gap-4 border-b border-slate-900 pb-4 shrink-0">
        <div>
          <h1 className="text-xl font-black font-mono tracking-wider text-slate-200">CENTRAL COMMAND HUB</h1>
          <p className="text-xs text-slate-500 font-mono uppercase tracking-wide mt-0.5">Logbook Fleet Administrations Array</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto justify-end">
          <button
            onClick={() => setShowRegisterForm(!showRegisterForm)}
            className={`text-xs font-mono uppercase tracking-wider font-bold py-2.5 px-4 rounded-xl transition-all border ${
              showRegisterForm 
                ? 'bg-rose-950/40 text-rose-400 border-rose-900' 
                : 'bg-slate-900 hover:bg-slate-850 text-emerald-400 border-slate-800'
            }`}
          >
            {showRegisterForm ? '✕ Close Sign Up' : '⚡ Initialize Admin Profile'}
          </button>
          <button
            onClick={() => setIsLinksModalOpen(true)}
            className="bg-slate-900 hover:bg-slate-850 text-blue-400 border border-slate-800 text-xs font-mono uppercase tracking-wider font-bold py-2.5 px-4 rounded-xl transition-all shadow-xl"
          >
            📋 Check-In Links Drawer ({deployedMissions.length})
          </button>
        </div>
      </div>

      {/* CORE DISPLAY HOUSING GRID COMMAND MATRIX */}
      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* PANEL ROW 1: INPUT DEPLOYMENT CAPTURE LOG BLOCKS */}
        <div className="lg:col-span-1 space-y-6">
          {showRegisterForm && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4">
              <header className="border-b border-slate-800 pb-2">
                <span className="text-[9px] bg-emerald-950 text-emerald-400 font-mono px-2 py-0.5 rounded font-bold uppercase tracking-widest border border-emerald-900/30">PROVISION</span>
                <h2 className="text-md font-black font-mono text-slate-200 uppercase mt-1">Generate Master Account</h2>
              </header>
              <form onSubmit={handleRegisterAdminAccount} className="space-y-3">
                <div>
                  <label className="block text-[9px] font-mono uppercase font-bold text-slate-400 mb-1">Email</label>
                  <input type="email" required placeholder="admin@domain.com" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-[9px] font-mono uppercase font-bold text-slate-400 mb-1">Username</label>
                  <input type="text" required placeholder="e.g. Chief_Admin" value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-[9px] font-mono uppercase font-bold text-slate-400 mb-1">Password</label>
                  <input type="password" required placeholder="Min 6 characters" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-[9px] font-mono uppercase font-bold text-rose-400 mb-1">Setup Key Phrase</label>
                  <input type="password" required placeholder="Paste variable code key" value={setupSecurityKey} onChange={(e) => setSetupSecurityKey(e.target.value)} className="w-full bg-slate-950 border border-rose-950 rounded-xl p-2.5 text-xs font-mono text-rose-200 focus:outline-none focus:border-rose-500 font-bold" />
                </div>
                <button type="submit" disabled={isRegistering} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-mono font-black py-2.5 px-4 rounded-xl uppercase tracking-widest text-xs transition-all">{isRegistering ? 'PROVISIONING...' : '⚡ INITIALIZE ADMIN MASTER'}</button>
              </form>
            </div>
          )}

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4">
            <header className="border-b border-slate-800 pb-2">
              <span className="text-[9px] bg-blue-950 text-blue-400 font-mono px-2 py-0.5 rounded font-bold uppercase tracking-widest border border-blue-900/30">OVERRIDE</span>
              <h2 className="text-md font-black font-mono text-slate-200 uppercase mt-1">Launch Logbook Fleet</h2>
            </header>
            <form onSubmit={handleLaunchLogbook} className="space-y-3">
              <div>
                <label className="block text-[9px] font-mono uppercase font-bold text-slate-400 mb-1">Voyager ID Name</label>
                <input type="text" required placeholder="e.g. TV-03" value={voyagerId} onChange={(e) => setVoyagerId(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500 uppercase" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[9px] font-mono uppercase font-bold text-slate-400 mb-1">Origin City</label>
                  <input type="text" required placeholder="Tulsa, OK" value={origin} onChange={(e) => setOrigin(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-[9px] font-mono uppercase font-bold text-slate-400 mb-1">Destination Target</label>
                  <input type="text" required placeholder="Daphne, AL" value={destination} onChange={(e) => setDestination(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 bg-slate-950 p-2.5 rounded-xl border border-slate-850">
                <div>
                  <label className="block text-[8px] font-mono uppercase font-bold text-slate-500 mb-1">Launch Lat</label>
                  <input type="text" required placeholder="e.g. 30.6035" value={launchLat} onChange={(e) => setLaunchLat(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-[8px] font-mono uppercase font-bold text-slate-500 mb-1">Launch Lng</label>
                  <input type="text" required placeholder="e.g. -87.9011" value={launchLng} onChange={(e) => setLaunchLng(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-[9px] font-mono uppercase font-bold text-slate-400 mb-1">Launch Timestamp</label>
                <input type="datetime-local" required value={launchDate} onChange={(e) => setLaunchDate(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs font-mono text-slate-400 focus:outline-none focus:border-blue-500" />
              </div>
              <button type="submit" disabled={isLaunching} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 text-white font-mono font-black py-3 px-4 rounded-xl uppercase tracking-widest text-xs transition-all shadow-xl">
                🚀 DEPLOY & LAUNCH BOOK
              </button>
            </form>
          </div>
        </div>

        {/* PANEL ROW 2 & 3: CENTRAL DATA TRAFFIC FEEDS REGISTRIES DISPLAY TABLES */}
        <div className="lg:col-span-2 space-y-6 w-full">
          {loadingFeeds ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-xs font-mono text-slate-500 animate-pulse uppercase">
              Streaming System Logs array modules...
            </div>
          ) : (
            <>
              {/* DEPLOYED MISSION LIST TABLE */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl flex flex-col h-[42vh]">
                <header className="border-b border-slate-800 pb-2 mb-3 shrink-0">
                  <h3 className="text-xs font-black font-mono uppercase tracking-wider text-blue-400">Deployed Logbook Fleet ({deployedMissions.length})</h3>
                  <p className="text-[10px] font-mono text-slate-500 uppercase mt-0.5">Click any coordinate slot or Missing badge to modify metrics</p>
                </header>
                <div className="overflow-x-auto overflow-y-auto flex-1 font-mono text-xs">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase tracking-wider font-bold">
                        <th className="pb-2">Logbook ID</th>
                        <th className="pb-2">Route Origin Vectors</th>
                        <th className="pb-2">Target End Destination</th>
                        <th className="pb-2">Launch Lat/Lng</th>
                        <th className="pb-2 text-right">Launch Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900/60 text-slate-300">
                      {deployedMissions.map((m) => {
                        const hasCoords = m.latitude && m.longitude;
                        return (
                          <tr key={m.id} className="hover:bg-slate-950/40 transition-colors">
                            <td className="py-2.5 font-bold text-slate-200">{m.id}</td>
                            <td className="py-2.5">{m.originCity}</td>
                            <td className="py-2.5 text-slate-400">{m.destinationCity}</td>
                            <td className="py-2.5">
                              <button 
                                onClick={() => openCoordinatesModal('mission', m)}
                                className={`text-[11px] px-2 py-1 rounded transition-all font-mono font-bold tracking-wide uppercase ${
                                  hasCoords 
                                    ? 'bg-blue-950/40 text-blue-400 border border-blue-900/30 hover:bg-blue-600 hover:text-white' 
                                    : 'bg-rose-950/60 text-rose-400 border border-rose-900/40 animate-pulse hover:bg-rose-600 hover:text-white'
                                }`}
                              >
                                {hasCoords ? `${m.latitude}, ${m.longitude}` : '⚠️ MISSING'}
                              </button>
                            </td>
                            <td className="py-2.5 text-right text-[11px] text-slate-500">{new Date(m.launchDate).toLocaleDateString()}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* TRANSMITTED FIELD CHECK-IN ENTRY TABLE */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl flex flex-col h-[42vh]">
                <header className="border-b border-slate-800 pb-2 mb-3 shrink-0">
                  <h3 className="text-xs font-black font-mono uppercase tracking-wider text-emerald-400">Global Field Check-In Telemetry ({allCheckinLogs.length})</h3>
                  <p className="text-[10px] font-mono text-slate-500 uppercase mt-0.5">Click any coordinate slot or Missing badge to modify metrics</p>
                </header>
                <div className="overflow-x-auto overflow-y-auto flex-1 font-mono text-xs">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase tracking-wider font-bold">
                        <th className="pb-2">Parent ID</th>
                        <th className="pb-2">Field Handler</th>
                        <th className="pb-2">Reported Landmark Scene</th>
                        <th className="pb-2">Captured Lat/Lng</th>
                        <th className="pb-2 text-right">Time Logged</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900/60 text-slate-300">
                      {allCheckinLogs.map((log) => {
                        const hasCoords = log.latitude && log.longitude;
                        return (
                          <tr key={log.id} className="hover:bg-slate-950/40 transition-colors">
                            <td className="py-2.5 text-blue-400 font-black uppercase">{log.voyagerId}</td>
                            <td className="py-2.5 font-bold text-slate-200">{log.handlerName}</td>
                            <td className="py-2.5 text-slate-400 max-w-[140px] truncate">{log.reportedLocation}</td>
                            <td className="py-2.5">
                              <button 
                                onClick={() => openCoordinatesModal('checkin', log)}
                                className={`text-[11px] px-2 py-1 rounded transition-all font-mono font-bold tracking-wide uppercase ${
                                  hasCoords 
                                    ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/30 hover:bg-emerald-600 hover:text-white' 
                                    : 'bg-rose-950/60 text-rose-400 border border-rose-900/40 animate-pulse hover:bg-rose-600 hover:text-white'
                                }`}
                              >
                                {hasCoords ? `${log.latitude}, ${log.longitude}` : '⚠️ MISSING COORDS'}
                              </button>
                            </td>
                            <td className="py-2.5 text-right text-[11px] text-slate-500">
                              {log.timestamp?.toDate() ? log.timestamp.toDate().toLocaleDateString() : 'Pending'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

      </div>

      {/* DYNAMIC PATCHING MULTI-PURPOSE EDITOR MODAL OVERLAY */}
      {activeModalTarget && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4">
            <header className="border-b border-slate-800 pb-3 flex justify-between items-center">
              <div>
                <span className="text-[8px] bg-amber-950 text-amber-400 font-mono px-2 py-0.5 rounded font-bold uppercase tracking-widest border border-amber-900/30">GEOMETRY MODIFIER OVERRIDE</span>
                <h3 className="text-sm font-bold font-mono text-slate-200 uppercase mt-1">{modalTitle}</h3>
              </div>
              <button onClick={closeCoordinatesModal} className="text-slate-500 hover:text-slate-300 text-xs font-mono font-bold uppercase tracking-wider p-1">✕</button>
            </header>
            
            <form onSubmit={handlePatchCoordinatesSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3 bg-slate-950 p-3 rounded-xl border border-slate-850">
                <div>
                  <label className="block text-[9px] font-mono uppercase font-bold text-slate-500 mb-1">Target Latitude</label>
                  <input 
                    type="text" required placeholder="e.g. 30.6035" value={modalLat} 
                    onChange={(e) => setModalLat(e.target.value)} 
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-amber-500 font-bold" 
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-mono uppercase font-bold text-slate-500 mb-1">Target Longitude</label>
                  <input 
                    type="text" required placeholder="e.g. -87.9011" value={modalLng} 
                    onChange={(e) => setModalLng(e.target.value)} 
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-amber-500 font-bold" 
                  />
                </div>
              </div>

              <div className="flex space-x-2 pt-2">
                <button 
                  type="button" onClick={closeCoordinatesModal}
                  className="w-1/3 bg-slate-950 hover:bg-slate-850 text-slate-400 border border-slate-800 font-mono text-xs font-bold py-2.5 rounded-xl uppercase tracking-wider transition-all"
                >
                  Cancel
                </button>
                <button 
                  type="submit" disabled={isPatchingCoords}
                  className="w-2/3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 text-slate-950 font-mono font-black py-2.5 px-4 rounded-xl uppercase tracking-widest text-xs transition-all shadow-xl"
                >
                  {isPatchingCoords ? 'COMMITTING OVERWRITE...' : '⚡ SAVE TARGET LOCATION'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* LINKS CONFIG MASTER RECOGNITION DRAWER */}
      {isLinksModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 flex flex-col max-h-[80vh]">
            <header className="flex justify-between items-center border-b border-slate-800 pb-4 mb-4 shrink-0">
              <div>
                <h2 className="text-sm font-black font-mono tracking-wider text-slate-200 uppercase">DEPLOYED LINKS TOKEN MASTER</h2>
                <p className="text-[10px] font-mono text-slate-500 uppercase mt-0.5">Copy unguessable field routing check-in links</p>
              </div>
              <button onClick={() => setIsLinksModalOpen(false)} className="text-slate-500 hover:text-slate-300 font-mono text-xs uppercase tracking-wider font-bold p-1">✕ Close</button>
            </header>
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {deployedMissions.map((mission) => (
                <div key={mission.id} className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl flex items-center justify-between gap-4 font-mono text-xs">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-slate-200 font-black tracking-wide">{mission.id}</span>
                      <span className="text-[9px] bg-slate-900 text-slate-500 px-1.5 py-0.5 rounded border border-slate-800 font-bold uppercase tracking-widest">{mission.status}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 truncate max-w-[240px] sm:max-w-[300px] mt-1">Token Key: <span className="text-blue-500 font-semibold">{mission.secretToken}</span></p>
                  </div>
                  <button onClick={() => handleCopyCheckinLink(mission.secretToken)} className="bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-2 rounded-lg transition-all shadow shrink-0">📋 Copy Link</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}