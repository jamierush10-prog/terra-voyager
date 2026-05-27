import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
import { db, storage } from '../../../../firebase/config';
import { collection, addDoc, doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';

export default function FieldCheckin() {
  const router = useRouter();
  const { id } = router.query;
  const voyagerId = id ? id.toString().toUpperCase() : '';

  // CORE CHECK-IN LOG FIELDS
  const [handlerName, setHandlerName] = useState('');
  const [reportedLocation, setReportedLocation] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  
  // NEW ACCOUNT CREATION EXPANSION STATES
  const [wantsAccount, setWantsAccount] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');

  // TRANSACTION CONTROL RUNTIMES
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  // AUTOMATED BROWSER GEOLOCATION HARVESTER
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLatitude(position.coords.latitude.toString());
          setLongitude(position.coords.longitude.toString());
        },
        (error) => {
          console.warn("Telemetry coordinates declined. Falling back to base manual inputs.");
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
  }, []);

  const handleTransmitTelemetry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voyagerId || !handlerName.trim() || !reportedLocation.trim()) return;

    setSubmitting(true);
    setStatusMessage('INITIALIZING SECURE FIELD UPLINK...');
    let uploadedImageUrl = '';

    try {
      // 1. INLINE ACCOUNT PROVISIONING HANDSHAKE (IF REQUESTED)
      if (wantsAccount) {
        if (!authEmail.trim() || !authPassword.trim()) {
          setStatusMessage('⚠️ EMAIL AND PASSWORD ARE REQUIRED FOR PROFILE REGISTRATION.');
          setSubmitting(false);
          return;
        }
        setStatusMessage('CREATING HANDLER IDENTITY ENLISTMENT...');
        
        const auth = getAuth();
        const credential = await createUserWithEmailAndPassword(auth, authEmail.trim(), authPassword);
        const newUser = credential.user;

        // Save account record reference blueprint using top-level imports
        setStatusMessage('PROVISIONING PROFILE RECORD...');
        const userDocRef = doc(db, 'users', newUser.uid);
        await setDoc(userDocRef, {
          uid: newUser.uid,
          email: newUser.email,
          username: handlerName.trim(),
          role: 'user'
        });
      }

      // 2. FILE STORAGE ASSET ARCHIVE UPLINK
      if (imageFile) {
        setStatusMessage('TRANSMITTING PICTURE DATA BULK...');
        const storageRef = ref(storage, `telemetry/${voyagerId}_${Date.now()}_${imageFile.name}`);
        const uploadSnapshot = await uploadBytes(storageRef, imageFile);
        uploadedImageUrl = await getDownloadURL(uploadSnapshot.ref);
      }

      // 3. COMMIT TELEMETRY LAYER LOG ENTRY
      setStatusMessage('SEALING TRANSACTION STREAM BLOCK...');
      await addDoc(collection(db, 'telemetryLogs'), {
        voyagerId: voyagerId,
        handlerName: handlerName.trim(),
        reportedLocation: reportedLocation.trim().toUpperCase(),
        latitude: latitude || 'NOT RECORDED',
        longitude: longitude || 'NOT RECORDED',
        imageUrl: uploadedImageUrl,
        timestamp: new Date(),
        verified: false // Awaiting Chief override signature approval
      });

      setIsSuccess(true);
      setStatusMessage('TRANSMISSION SUCCESSFUL. DATA SECTIONS LOCKED IN.');
      
      setTimeout(() => {
        router.push(`/mission/${voyagerId.toLowerCase()}?fromCheckin=true`);
      }, 3000);

    } catch (err: any) {
      console.error("Transmission stack crash details:", err);
      setStatusMessage(`⚠️ CRITICAL FAIL: ${err.message || 'TRANSACTION MATRIX REJECTED BY DATABASE.'}`);
      setSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 font-mono text-center">
        <div className="w-full max-w-md bg-slate-900 border-2 border-emerald-500 rounded-2xl p-8 space-y-4 shadow-2xl">
          <span className="text-4xl">⚡</span>
          <h2 className="text-base font-black text-emerald-400 uppercase tracking-widest">TRANSMISSION COMPLETION SUCCESS</h2>
          <p className="text-xs text-slate-300 uppercase leading-relaxed">{statusMessage}</p>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider animate-pulse pt-2">Returning control deck routing lines...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col items-center justify-center p-4 overflow-y-auto">
      
      <div className="w-full max-w-md bg-slate-900/60 border border-slate-900 rounded-3xl p-6 md:p-8 space-y-6 shadow-2xl backdrop-blur-sm my-8">
        <header className="text-center space-y-1.5">
          <h1 className="text-2xl font-black tracking-widest uppercase text-white leading-none">VESSEL PORTAL</h1>
          <p className="text-[10px] font-mono text-emerald-400 font-black uppercase tracking-widest">SECURE FIELD LINK // {voyagerId || 'SYNCING...'}</p>
        </header>

        <form onSubmit={handleTransmitTelemetry} className="space-y-4 font-mono text-xs">
          
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-300 uppercase block tracking-wider">HANDLER ID SIGN-OFF</label>
            <input 
              type="text" 
              required 
              placeholder="e.g., Carl" 
              value={handlerName} 
              onChange={(e) => setHandlerName(e.target.value)} 
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-white focus:outline-none focus:border-blue-500 font-bold" 
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-300 uppercase block tracking-wider">CURRENT PHYSICAL LOCATION</label>
            <input 
              type="text" 
              required 
              placeholder="E.G. TULSA, OK" 
              value={reportedLocation} 
              onChange={(e) => setReportedLocation(e.target.value)} 
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-white focus:outline-none focus:border-blue-500 uppercase font-bold" 
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-300 uppercase block tracking-wider">CAPTURE VERIFICATION ASSET (PHOTO/POSTCARD)</label>
            <input 
              type="file" 
              accept="image/*" 
              required
              onChange={(e) => setImageFile(e.target.files?.[0] || null)} 
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-300 text-[11px] file:mr-3 file:py-1 file:px-2.5 file:rounded-md file:bg-slate-900 file:text-white file:border-0 file:text-[10px] file:uppercase file:font-bold hover:file:bg-slate-800 file:cursor-pointer" 
            />
          </div>

          <div className="bg-slate-950/80 border border-slate-850 p-3.5 rounded-xl space-y-3 mt-2">
            <label className="flex items-center space-x-3 cursor-pointer select-none">
              <input 
                type="checkbox" 
                checked={wantsAccount}
                onChange={(e) => setWantsAccount(e.target.checked)}
                className="w-4 h-4 accent-blue-500 bg-slate-900 border-slate-800 rounded cursor-pointer"
              />
              <span className="text-[10px] font-black tracking-wide text-slate-200 uppercase">
                New Handler? Create a permanent crew account
              </span>
            </label>

            {wantsAccount && (
              <div className="space-y-3 pt-2 border-t border-slate-900">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">EMAIL COMM MATRIX</label>
                  <input 
                    type="email" 
                    required={wantsAccount}
                    placeholder="name@domain.com" 
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">SECURE SYSTEM PASSKEY</label>
                  <input 
                    type="password" 
                    required={wantsAccount}
                    placeholder="••••••••" 
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            )}
          </div>

          {statusMessage && (
            <p className="text-[10px] text-center uppercase tracking-wider bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-slate-300">
              {statusMessage}
            </p>
          )}

          <button 
            type="submit" 
            disabled={submitting}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-widest py-3.5 px-4 rounded-xl transition-all shadow-lg text-[13px] disabled:opacity-50 cursor-pointer"
          >
            {submitting ? 'PROCESSING COMPILATION...' : 'TRANSMIT VESSEL TELEMETRY'}
          </button>

        </form>
      </div>

    </div>
  );
}