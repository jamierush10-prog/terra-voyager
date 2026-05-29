import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
// FIXED: Calibrated the exact directory depth step back to the Firebase configuration path
import { db, storage } from '../../../../firebase/config';
import { collection, addDoc, doc, setDoc, query, where, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';

export default function FieldCheckin() {
  const router = useRouter();
  const { id } = router.query;
  const voyagerId = id ? id.toString().toUpperCase() : '';

  const [handlerName, setHandlerName] = useState('');
  const [reportedLocation, setReportedLocation] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  
  const [optReceived, setOptReceived] = useState(false);
  const [optPassedOn, setOptPassedOn] = useState(false);
  const [optRoutine, setOptRoutine] = useState(false);
  
  const [recipientName, setRecipientName] = useState('');

  // USER REGISTRATION STATES
  const [wantsAccount, setWantsAccount] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');

  // IN-LINE MODAL SIGN IN STATES
  const [isSignInModalOpen, setIsSignInModalOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [isGpsActive, setIsGpsActive] = useState(false);

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);

  useEffect(() => {
    const auth = getAuth();
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        const usersCollection = collection(db, 'users');
        const qProfile = query(usersCollection, where('uid', '==', user.uid));
        getDocs(qProfile).then((snap) => {
          if (!snap.empty) {
            const profileData = snap.docs[0].data();
            setUserProfile(profileData);
            if (profileData.username) {
              setHandlerName(profileData.username.toUpperCase());
            }
          }
        });
      } else {
        setCurrentUser(null);
        setUserProfile(null);
      }
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLatitude(position.coords.latitude.toString());
          setLongitude(position.coords.longitude.toString());
          setIsGpsActive(true);
        },
        (error) => {
          setIsGpsActive(false);
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    }
  }, []);

  const handleRequestDeviceLocation = () => {
    if (typeof window !== 'undefined' && navigator.geolocation) {
      setStatusMessage('REQUESTING DEVICE PING...');
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLatitude(position.coords.latitude.toString());
          setLongitude(position.coords.longitude.toString());
          setIsGpsActive(true);
          setStatusMessage('DEVICE LOCATION CAPTURED FOR THIS ENTRY.');
        },
        (error) => {
          setIsGpsActive(false);
          setStatusMessage('⚠️ LOCATION REQUEST DENIED. PLEASE ENTER MANUALLY.');
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    }
  };

  const handleInlineLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail.trim() || !loginPassword.trim()) return;
    setLoginError('');
    
    try {
      const auth = getAuth();
      await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
      setIsSignInModalOpen(false);
      setLoginEmail('');
      setLoginPassword('');
    } catch (err: any) {
      setLoginError('Invalid login credentials or validation key rejected.');
    }
  };

  const handleTransmitTelemetry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voyagerId || !handlerName.trim() || !reportedLocation.trim()) return;

    if (!optReceived && !optPassedOn && !optRoutine) {
      setStatusMessage('⚠️ PLEASE SELECT AT LEAST ONE CHECK-IN OPTION FROM THE LIST.');
      return;
    }

    setSubmitting(true);
    setStatusMessage('INITIALIZING SECURE LEDGER CONNECT...');
    
    let finalLocationText = reportedLocation.trim().toUpperCase();
    let finalLat = latitude;
    let finalLng = longitude;
    let uploadedImageUrl = '';

    const isZipCode = /^\d{5}$/.test(reportedLocation.trim());
    
    if (isZipCode && !isGpsActive) {
      try {
        setStatusMessage('RESOLVING ZIP BOUNDARIES & CITY LABELS...');
        const geoResponse = await fetch(
          `https://nominatim.openstreetmap.org/search?postalcode=${reportedLocation.trim()}&country=USA&format=json&addressdetails=1`
        );
        const geoData = await geoResponse.json();
        
        if (geoData && geoData.length > 0) {
          const matchNode = geoData[0];
          finalLat = matchNode.lat;
          finalLng = matchNode.lon;
          const addr = matchNode.address;
          const city = addr.city || addr.town || addr.village || addr.hamlet || addr.county || 'UNKNOWN CITY';
          const state = addr.state ? addr.state.toUpperCase() : 'USA';
          finalLocationText = `${city.toUpperCase()}, ${state}`;
        }
      } catch (err) {
        console.error(err);
      }
    }

    try {
      if (!currentUser && wantsAccount) {
        if (!authEmail.trim() || !authPassword.trim()) {
          setStatusMessage('⚠️ ACCOUNT PROVISIONING REQUIRES BOTH EMAIL AND PASSKEY.');
          setSubmitting(false);
          return;
        }
        setStatusMessage('INKING ACCOUNT CODES...');
        const auth = getAuth();
        const credential = await createUserWithEmailAndPassword(auth, authEmail.trim(), authPassword);
        const newUser = credential.user;

        await setDoc(doc(db, 'users', newUser.uid), {
          uid: newUser.uid,
          email: newUser.email,
          username: handlerName.trim().toUpperCase(),
          role: 'user'
        });
      }

      if (imageFile) {
        setStatusMessage('ARCHIVING ATTACHED FILE COPIES...');
        const storageRef = ref(storage, `telemetry/${voyagerId}_${Date.now()}_${imageFile.name}`);
        const uploadSnapshot = await uploadBytes(storageRef, imageFile);
        uploadedImageUrl = await getDownloadURL(uploadSnapshot.ref);
      }

      let actionsList: string[] = [];
      if (optReceived) actionsList.push("POSSESSION INITIALIZED");
      if (optPassedOn) actionsList.push(`TRANSFERRED CUSTODY${recipientName ? ` TO ${recipientName.trim().toUpperCase()}` : ''}`);
      if (optRoutine) actionsList.push("ROUTING UPDATE");

      setStatusMessage('SEALING CUSTODY LOG TRANSFERS...');
      await addDoc(collection(db, 'telemetryLogs'), {
        voyagerId: voyagerId,
        handlerName: handlerName.trim().toUpperCase(),
        reportedLocation: finalLocationText, 
        latitude: finalLat || 'NOT RECORDED',
        longitude: finalLng || 'NOT RECORDED',
        imageUrl: uploadedImageUrl,
        timestamp: new Date(),
        verified: false,
        journalOptions: {
          tookPossession: optReceived,
          passedPossession: optPassedOn,
          recipient: recipientName.trim().toUpperCase() || null,
          routineUpdate: optRoutine
        },
        displayActionContext: actionsList.join(" // ")
      });

      setIsSuccess(true);
      setStatusMessage('LEDGER STAMP APPLIED. CHRONICLE PATH UPDATE SECURED.');
      
      setTimeout(() => {
        router.push(`/mission/${voyagerId.toLowerCase()}?fromCheckin=true`);
      }, 3000);

    } catch (err: any) {
      console.error(err);
      setStatusMessage(`⚠️ TRANSACTION REJECTED: ${err.message || 'DATABASE WRITE FAILURE.'}`);
      setSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 font-mono text-center">
        <div className="w-full max-w-md bg-slate-900 border-2 border-emerald-500 rounded-2xl p-8 space-y-4 shadow-2xl">
          <span className="text-4xl">✍️</span>
          <h2 className="text-base font-black text-emerald-400 uppercase tracking-widest">LOG DATA SECURED</h2>
          <p className="text-xs text-slate-300 uppercase leading-relaxed">{statusMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-4 flex flex-col items-center justify-center overflow-y-auto relative">
      <div className="w-full max-w-md bg-slate-900/60 border border-slate-900 rounded-3xl p-6 md:p-8 space-y-6 shadow-2xl backdrop-blur-sm my-8">
        <header className="flex justify-between items-start border-b border-slate-900/40 pb-4">
          <div className="text-left">
            <h1 className="text-2xl font-black tracking-widest uppercase text-white leading-none">JOURNAL PORTAL</h1>
            <p className="text-[10px] font-mono text-emerald-400 font-black uppercase tracking-widest mt-1">FIELD CUSTODY TERMINAL // {voyagerId || 'SYNCING...'}</p>
          </div>
          <div className="font-mono text-[10px] uppercase">
            {currentUser && userProfile ? (
              <button type="button" onClick={() => getAuth().signOut()} className="text-slate-400 hover:text-slate-200 underline bg-transparent border-0 cursor-pointer p-0">[Sign Out]</button>
            ) : (
              <button type="button" onClick={() => { setLoginError(''); setIsSignInModalOpen(true); }} className="text-blue-400 hover:text-blue-300 font-black underline bg-transparent border-0 cursor-pointer p-0">Sign In</button>
            )}
          </div>
        </header>

        <form onSubmit={handleTransmitTelemetry} className="space-y-4 font-mono text-xs">
          
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-300 uppercase block tracking-wider">YOUR NAME / SIGN-OFF</label>
            <input type="text" required placeholder="E.G., MARK" value={handlerName} onChange={(e) => setHandlerName(e.target.value)} disabled={!!(currentUser && userProfile)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-white focus:outline-none focus:border-blue-500 font-black uppercase disabled:opacity-60 disabled:cursor-not-allowed" />
          </div>

          {/* CHECKBOX MATRIX SELECTION BOXES */}
          <div className="space-y-2.5 bg-slate-950/40 border border-slate-900 p-4 rounded-xl">
            <label className="text-[10px] font-bold text-slate-400 uppercase block tracking-wider mb-1">Select Check-in Options (Select all that apply):</label>
            
            <label className="flex items-start space-x-3 cursor-pointer select-none py-0.5">
              <input type="checkbox" checked={optReceived} onChange={(e) => setOptReceived(e.target.checked)} className="w-4 h-4 accent-blue-500 bg-slate-900 border-slate-800 rounded cursor-pointer mt-0.5" />
              <span className="text-[11px] font-medium text-slate-200">I have taken initial possession of this journal</span>
            </label>

            <label className="flex items-start space-x-3 cursor-pointer select-none py-0.5">
              <input type="checkbox" checked={optPassedOn} onChange={(e) => setOptPassedOn(e.target.checked)} className="w-4 h-4 accent-blue-500 bg-slate-900 border-slate-800 rounded cursor-pointer mt-0.5" />
              <span className="text-[11px] font-medium text-slate-200">The journal is no longer in my possession</span>
            </label>

            {optPassedOn && (
              <div className="pl-7 pt-1 space-y-1">
                <label className="text-[9px] font-bold text-slate-400 uppercase block tracking-wider">Who did you turn the journal over to?</label>
                <input type="text" required={optPassedOn} placeholder="RECIPIENT NAME OR CALLSIGN" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} className="w-full bg-slate-950 border border-slate-850 rounded-lg p-2 text-white font-bold uppercase focus:outline-none focus:border-blue-500" />
              </div>
            )}

            <label className="flex items-start space-x-3 cursor-pointer select-none py-0.5">
              <input type="checkbox" checked={optRoutine} onChange={(e) => setOptRoutine(e.target.checked)} className="w-4 h-4 accent-blue-500 bg-slate-900 border-slate-800 rounded cursor-pointer mt-0.5" />
              <span className="text-[11px] font-medium text-slate-200">Routine status update (Still in hand / traveling)</span>
            </label>
          </div>

          <div className="bg-blue-950/20 border border-blue-900/40 rounded-xl p-3.5 space-y-2.5 text-slate-300 text-[11px] leading-relaxed">
            <p>
              📌 <strong className="text-blue-400 uppercase tracking-wide text-[10px]">Positioning Note:</strong> Selecting <em>"Use Device Location"</em> transmits a single, isolated geographic coordinate ping at the exact moment of entry submission only. The system does not continuously track your device. If you prefer, you can decline location permissions and manually type your current City or ZIP code below.
            </p>
            <button type="button" onClick={handleRequestDeviceLocation} className="w-full bg-slate-950 border border-slate-800 text-slate-200 hover:bg-slate-900 font-bold uppercase py-2 px-3 rounded-lg text-[10px] tracking-wider transition-all cursor-pointer">
              {isGpsActive ? '✓ DEVICE POSITION LOCKED' : 'Use Device Location'}
            </button>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-300 uppercase block tracking-wider">CURRENT PHYSICAL LOCATION OR ZIP CODE</label>
            <input type="text" required placeholder="E.G. 36526 OR DAPHNE, AL" value={reportedLocation} onChange={(e) => setReportedLocation(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-white focus:outline-none focus:border-blue-500 font-bold uppercase" />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-300 uppercase block tracking-wider">ATTACH AN IMAGE (OPTIONAL)</label>
            <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] || null)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-300 text-[11px] file:mr-3 file:py-1 file:px-2 file:rounded-md file:bg-slate-900 file:text-white file:border-0 file:text-[10px] file:uppercase file:font-bold hover:file:bg-slate-800 file:cursor-pointer" />
          </div>

          {!currentUser && (
            <div className="bg-slate-950/80 border border-slate-850 p-3.5 rounded-xl space-y-3 mt-2">
              <label className="flex items-center space-x-3 cursor-pointer select-none">
                <input type="checkbox" checked={wantsAccount} onChange={(e) => setWantsAccount(e.target.checked)} className="w-4 h-4 accent-blue-500 bg-slate-900 border-slate-800 rounded cursor-pointer" />
                <span className="text-[10px] font-black tracking-wide text-slate-200 uppercase">Create a User Account to follow the journal's travel</span>
              </label>

              {wantsAccount && (
                <div className="space-y-3 pt-2 border-t border-slate-900">
                  <input type="email" required={wantsAccount} placeholder="name@domain.com" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500" />
                  <input type="password" required={wantsAccount} placeholder="PASSWORD PASSKEY" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500" />
                </div>
              )}
            </div>
          )}

          {statusMessage && <p className="text-[10px] text-center uppercase tracking-wider bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-slate-300">{statusMessage}</p>}

          <button type="submit" disabled={submitting} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-widest py-3.5 px-4 rounded-xl transition-all shadow-lg text-[13px] disabled:opacity-50 cursor-pointer">
            {submitting ? 'RECORDING LOG DATA...' : 'LOG VOLUME CUSTODY TRANSFER'}
          </button>
        </form>
      </div>

      {/* CHECK-IN INLINE ACCESS SECURITY SIGN IN MODAL */}
      {isSignInModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 font-mono">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-2xl">
            <header className="text-center">
              <h2 className="text-sm font-black uppercase text-white tracking-widest">IDENTITY VERIFICATION</h2>
            </header>
            <form onSubmit={handleInlineLogin} className="space-y-4 text-xs">
              <input type="email" required placeholder="EMAIL ADDR" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-blue-500 font-bold" />
              <input type="password" required placeholder="PASSWORD KEY" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-blue-500 font-bold" />
              {loginError && <p className="text-rose-400 text-[10px] text-center uppercase bg-rose-950/20 border border-rose-900/40 p-2 rounded-lg">⚠️ {loginError}</p>}
              <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest py-3.5 rounded-xl transition-all shadow cursor-pointer">VERIFY KEY</button>
              <button type="button" onClick={() => setIsSignInModalOpen(false)} className="w-full text-center text-slate-500 text-[10px] uppercase font-bold tracking-wider bg-transparent border-0 p-0 cursor-pointer mt-1 hover:text-slate-400">[Abort Pass]</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}