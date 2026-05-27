import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
import { db, storage } from '../../../../firebase/config';
import { doc, getDoc, addDoc, collection, serverTimestamp, updateDoc, arrayUnion, query, where, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import Link from 'next/link';

export default function HandlerCheckin() {
  const router = useRouter();
  const { id } = router.query; 

  const [mission, setMission] = useState(null);
  const [voyagerDocId, setVoyagerDocId] = useState(''); 
  const [loading, setLoading] = useState(true);
  const [handlerName, setHandlerName] = useState('');
  const [reportedLocation, setReportedLocation] = useState('');

  const [enlistInCrew, setEnlistInCrew] = useState(false);
  const [crewEmail, setCrewEmail] = useState('');
  const [crewPassword, setCrewPassword] = useState('');

  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;

    const missionsCollection = collection(db, 'voyagerMissions');
    const qToken = query(missionsCollection, where('secretToken', '==', id.toString()));

    getDocs(qToken).then((snap) => {
      if (!snap.empty) {
        const targetDoc = snap.docs[0];
        setMission(targetDoc.data());
        setVoyagerDocId(targetDoc.id); 
      }
      setLoading(false);
    }).catch((err) => {
      console.error("Token lookup fault:", err);
      setLoading(false);
    });
  }, [id]);

  const determineUniqueUsername = async (baseName) => {
    let candidateName = baseName.trim().replace(/\s+/g, '_');
    let counter = 0;
    let nameAvailable = false;
    const usersCollection = collection(db, 'users');

    while (!nameAvailable) {
      const testName = counter === 0 ? candidateName : `${candidateName}_${counter}`;
      const q = query(usersCollection, where('username', '==', testName));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        candidateName = testName;
        nameAvailable = true;
      } else {
        counter++;
      }
    }
    return candidateName;
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const handleSubmitCheckin = async (e) => {
    e.preventDefault();
    if (!handlerName || !reportedLocation) {
      alert("Please provide your Name and a Location Description.");
      return;
    }

    if (!imageFile) {
      alert("REQUIRED: You must snap a landmark photo of the book out in the environment to proceed.");
      return;
    }

    setIsSubmitting(true);
    let uploadedImageUrl = '';
    const auth = getAuth(); // Fixed auth context scope variable definition

    try {
      if (imageFile) {
        const imageRef = ref(storage, `telemetry/${voyagerDocId}-${Date.now()}-${imageFile.name}`);
        const snapshot = await uploadBytes(imageRef, imageFile);
        uploadedImageUrl = await getDownloadURL(snapshot.ref);
      }

      // Transmits cleanly to Firestore; coordinates are left out so admin can map them manually later
      await addDoc(collection(db, 'telemetryLogs'), {
        voyagerId: voyagerDocId, 
        handlerName: handlerName.trim(),
        reportedLocation: reportedLocation.trim(),
        cargoAdded: 'Location Verification Photo Transmitted',
        imageUrl: uploadedImageUrl,
        timestamp: serverTimestamp(),
        approved: false 
      });

      if (enlistInCrew) {
        const finalUsername = await determineUniqueUsername(handlerName);
        const userCredential = await createUserWithEmailAndPassword(auth, crewEmail.trim(), crewPassword);
        const user = userCredential.user;

        await addDoc(collection(db, 'users'), {
          uid: user.uid,
          email: user.email,
          username: finalUsername,
          role: 'crew',
          enlistedUnit: voyagerDocId,
          createdAt: new Date().toISOString()
        });

        const voyagerDocRef = doc(db, 'voyagerMissions', voyagerDocId);
        await updateDoc(voyagerDocRef, {
          crewRoster: arrayUnion(finalUsername)
        });
      }

      router.push(`/mission/${voyagerDocId.toLowerCase()}?fromCheckin=true`);
    } catch (error) {
      console.error("Comms Transmission Fault:", error);
      alert(`System Error: ${error.message}`);
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center font-mono text-xs text-slate-500">
        CONNECTING TO LOGBOOK REGISTRY NETWORK...
      </div>
    );
  }

  if (!mission) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center font-mono p-4 text-center space-y-4">
        <div className="text-rose-500 border border-rose-900/40 bg-rose-950/20 px-4 py-3 rounded-xl text-xs max-w-sm font-bold uppercase tracking-wider">
          ⚠️ INVALID ACCESS TOKEN: This URL token hash does not match any active deployed book sequence.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-4 flex flex-col items-center justify-center space-y-4">
      
      <Link href={`/mission/${voyagerDocId.toLowerCase()}`} className="text-[10px] font-mono uppercase bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 px-4 py-2 rounded-xl transition-all shadow-xl tracking-wider">
        🔎 Open Mission Control Deck for {voyagerDocId}
      </Link>

      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
        <header className="text-center border-b border-slate-800/80 pb-4">
          <span className="text-[10px] bg-blue-950 text-blue-400 font-mono px-2.5 py-1 rounded-md font-bold uppercase tracking-widest border border-blue-900/30">
            RECORD BOOK FIELD PORTAL
          </span>
          <h1 className="text-xl font-black font-mono tracking-wider text-slate-200 uppercase mt-3">LOGBOOK ID: {voyagerDocId}</h1>
        </header>

        <form onSubmit={handleSubmitCheckin} className="space-y-4">
          
          <div className="text-xs bg-slate-950 border border-slate-800/60 p-3 rounded-xl text-slate-400 leading-relaxed font-mono">
            <span className="text-blue-400 font-bold block mb-1">📋 CHECK-IN PROTOCOL:</span>
            Write your sign-off entry inside the book, then photograph the book out in the environment framed next to a notable storefront, sign, or landmark.
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase font-bold tracking-wider text-slate-400 mb-1.5">Your Name / Sign-off Initials</label>
            <input type="text" required placeholder="Match your signature in the book" value={handlerName} onChange={(e) => setHandlerName(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500" />
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase font-bold tracking-wider text-slate-400 mb-1.5">Current Location Description</label>
            <input type="text" required placeholder="e.g. Pensacola, FL (Local Shop)" value={reportedLocation} onChange={(e) => setReportedLocation(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500" />
          </div>

          {/* Crew Enlistment Section */}
          <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-xl space-y-4 mt-2">
            <div className="flex items-start space-x-3">
              <input type="checkbox" id="crew-checkbox" checked={enlistInCrew} onChange={(e) => setEnlistInCrew(e.target.checked)} className="mt-1 w-4 h-4 rounded bg-slate-950 border-slate-800 text-blue-500 focus:ring-0 cursor-pointer" />
              <label htmlFor="crew-checkbox" className="text-xs cursor-pointer select-none space-y-1.5">
                <span className="block font-bold text-slate-200 uppercase tracking-wide">Enlist into Crew Comms</span>
                <span className="block text-rose-500/90 font-mono text-[10px] bg-rose-950/20 border border-rose-900/30 p-2 rounded-lg font-bold leading-normal uppercase tracking-wide">
                  ⚠️ NOTICE: You must check this box and sign up if you wish to be part of the mission control team. You cannot join after this check-in process completes.
                </span>
              </label>
            </div>
            {enlistInCrew && (
              <div className="pt-3 border-t border-slate-900 grid grid-cols-1 gap-3 animate-fadeIn">
                <div>
                  <label className="block text-[9px] font-mono uppercase tracking-wider text-slate-500 mb-1">Account Contact Email</label>
                  <input type="email" required={enlistInCrew} placeholder="handler@domain.com" value={crewEmail} onChange={(e) => setCrewEmail(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-[9px] font-mono uppercase tracking-wider text-slate-500 mb-1">Create Secure Password</label>
                  <input type="password" required={enlistInCrew} placeholder="Min 6 characters" value={crewPassword} onChange={(e) => setCrewPassword(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500" />
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase font-bold tracking-wider text-slate-400 mb-1.5">Landmark Verification Photo (Required)</label>
            {imagePreview ? (
              <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="Landmark Preview" className="w-full h-52 object-cover rounded-lg" />
              </div>
            ) : (
              <div className="relative border border-dashed border-slate-800 rounded-xl bg-slate-950">
                <input type="file" accept="image/*" capture="environment" required onChange={handleImageChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20" />
                <div className="p-8 text-center space-y-2">
                  <span className="text-2xl block">📸</span>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-black block">Capture Book & Landmark</span>
                </div>
              </div>
            )}
          </div>

          <button type="submit" disabled={isSubmitting} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 text-white font-mono font-black py-3.5 px-4 rounded-xl uppercase tracking-widest text-xs transition-all shadow-xl">
            {isSubmitting ? 'TRANSMITTING...' : '⚡ TRANSMIT LOGBOOK CHECK-IN'}
          </button>
        </form>
      </div>
    </div>
  );
}