import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
import { db, storage } from '../../../../firebase/config';
import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import Link from 'next/link';

export default function FieldCheckin() {
  const router = useRouter();
  const { id } = router.query;
  const voyagerId = id ? id.toString().toUpperCase() : '';
const [mission, setMission] = useState<any>(null);
  // FIXED TYPESCRIPT OVERRIDES FOR STATES
  const [mission, setMission] = useState<any>(null);
  const [voyagerDocId, setVoyagerDocId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);

  const [handlerName, setHandlerName] = useState('');
  const [reportedLocation, setReportedLocation] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const auth = getAuth();
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        const usersCollection = collection(db, 'users');
        const qProfile = query(usersCollection, where('uid', '==', user.uid));
        getDocs(qProfile).then((snap) => {
          if (!snap.empty) {
            const pData = snap.docs[0].data();
            setUserProfile(pData);
            if (pData.username) setHandlerName(pData.username);
          }
        }).catch(err => console.error("Profile query error:", err));
      } else {
        setCurrentUser(null);
        setUserProfile(null);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!voyagerId) return;

    const mCollection = collection(db, 'voyagerMissions');
    const q = query(mCollection, where('missionId', '==', voyagerId));

    getDocs(q).then((snap) => {
      if (!snap.empty) {
        const targetDoc = snap.docs[0];
        setMission(targetDoc.data());
        setVoyagerDocId(targetDoc.id);
      } else {
        setError(`Logbook vector [${voyagerId}] is not active in the mainframe registry.`);
      }
      setLoading(false);
    }).catch((err) => {
      console.error("Fetch mission fault:", err);
      setError('Failed to securely link with the mission database grid.');
      setLoading(false);
    });
  }, [voyagerId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setImageFile(e.target.files[0]);
    }
  };

  const handleTransmitCheckin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voyagerId || !reportedLocation.trim() || !handlerName.trim()) return;

    setSubmitting(true);
    let finalImageUrl = '';

    try {
      if (imageFile) {
        const storageRef = ref(storage, `telemetry/${voyagerId}_${Date.now()}_${imageFile.name}`);
        const uploadSnapshot = await uploadBytes(storageRef, imageFile);
        finalImageUrl = await getDownloadURL(uploadSnapshot.ref);
      }

      await addDoc(collection(db, 'telemetryLogs'), {
        voyagerId: voyagerId,
        handlerName: handlerName.trim(),
        reportedLocation: reportedLocation.trim().toUpperCase(),
        imageUrl: finalImageUrl,
        timestamp: serverTimestamp()
      });

      setSuccess(true);
    } catch (err) {
      console.error("Transmission fault:", err);
      alert('Secure data upload failed. Check network link tokens.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center font-mono text-xs text-slate-600 animate-pulse">VERIFYING TARGET MATRIX DATA...</div>;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col items-center justify-center p-4 relative">
      <main className="w-full max-w-md bg-slate-900/40 backdrop-blur-xl border border-slate-900 rounded-2xl p-6 space-y-6 shadow-2xl relative z-10">
        <header className="text-center space-y-1.5">
          <h1 className="text-xl font-black tracking-widest text-slate-200 uppercase">FIELD LOG PORTAL</h1>
          <p className="text-[10px] font-mono text-emerald-500 uppercase tracking-widest">SECURE UPLINK NODE // {voyagerId}</p>
        </header>

        {error ? (
          <div className="text-center font-mono text-[10px] text-rose-400 bg-rose-950/20 border border-rose-950/40 p-4 rounded-xl uppercase">
            ⚠️ {error}
          </div>
        ) : success ? (
          <div className="space-y-4 text-center font-mono uppercase">
            <div className="p-4 bg-emerald-950/20 border border-emerald-900/40 rounded-xl text-emerald-400 text-[11px] tracking-wide">
              🚀 TELEMETRY TRANSMISSION SUCCESSFUL // MATRIX RECALIBRATED
            </div>
            <Link href={`/mission/${voyagerId.toLowerCase()}?fromCheckin=true`} className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-3.5 px-4 rounded-xl tracking-widest transition-all">
              ENTER CONTROL DECK LOGBOOK
            </Link>
          </div>
        ) : (
          <form onSubmit={handleTransmitCheckin} className="space-y-4 font-mono text-xs text-slate-400">
            <div className="space-y-1">
              <label className="text-[9px] font-bold tracking-widest uppercase block text-slate-500">HANDLER ID SIGN-OFF</label>
              <input
                type="text"
                value={handlerName}
                onChange={(e) => setHandlerName(e.target.value)}
                placeholder="Enter Your Name"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 focus:outline-none focus:border-blue-500"
                required
                disabled={!!userProfile?.username}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[9px] font-bold tracking-widest uppercase block text-slate-500">CURRENT PHYSICAL LOCATION</label>
              <input
                type="text"
                value={reportedLocation}
                onChange={(e) => setReportedLocation(e.target.value)}
                placeholder="e.g. DAPHNE, AL"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 focus:outline-none focus:border-blue-500 uppercase"
                required
                disabled={submitting}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[9px] font-bold tracking-widest uppercase block text-slate-500">CAPTURE VERIFICATION ASSET</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-[11px] file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-[10px] file:font-bold file:uppercase file:bg-slate-900 file:text-slate-300 hover:file:bg-slate-800 file:cursor-pointer"
                disabled={submitting}
              />
            </div>

            <button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold uppercase tracking-widest py-3.5 px-4 rounded-xl transition-all disabled:opacity-40 mt-2"
              disabled={submitting}
            >
              {submitting ? 'BROADCASTING...' : 'TRANSMIT TELEMETRY LOG'}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}