import { useState, useEffect } from 'react';
import { db, storage } from '../firebase/config';
import { collection, onSnapshot, doc, setDoc, query, where, getDocs, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import Link from 'next/link';

const MapContainer = dynamic(() => import('react-leaflet').then((mod) => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then((mod) => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then((mod) => mod.Marker), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then((mod) => mod.Popup), { ssr: false });

export default function Home() {
  const router = useRouter();
  const [activeVessels, setActiveVessels] = useState<Record<string, any>>({});
  const [telemetryLogs, setTelemetryLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // ENTRANCE HUB & HYDRATION STATES
  const [isEntranceModalOpen, setIsEntranceModalOpen] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  
  const [isCheckinLookupOpen, setIsCheckinLookupOpen] = useState(false);
  const [lookupVoyagerId, setLookupVoyagerId] = useState('');
  const [lookupPasscode, setLookupPasscode] = useState('');
  const [lookupError, setLookupError] = useState('');

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authUsername, setAuthUsername] = useState('');
  const [authActionLoading, setAuthActionLoading] = useState(false);
  const [authActionError, setAuthActionError] = useState('');

  const [isLaunchModalOpen, setIsLaunchModalOpen] = useState(false);
  const [launchVoyagerId, setLaunchVoyagerId] = useState('');
  const [launchOriginCity, setLaunchOriginCity] = useState('');
  const [launchLatitude, setLaunchLatitude] = useState('');
  const [launchLongitude, setLaunchLongitude] = useState('');
  const [launchPasscode, setLaunchPasscode] = useState('');
  const [launchImageFile, setLaunchImageFile] = useState<File | null>(null);
  const [launchingAction, setLaunchingAction] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const [isLaunchGpsActive, setIsLaunchGpsActive] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
    setIsEntranceModalOpen(true);
  }, []);

  useEffect(() => {
    const mCollection = collection(db, 'voyagerMissions');
    const unsubscribeVessels = onSnapshot(mCollection, (snapshot) => {
      const vesselMap: Record<string, any> = {};
      snapshot.forEach((doc) => {
        const data = doc.data();
        vesselMap[doc.id.toUpperCase()] = { id: doc.id, ...data };
      });
      setActiveVessels(vesselMap);
    });
    return () => unsubscribeVessels();
  }, []);

  useEffect(() => {
    const logsCollection = collection(db, 'telemetryLogs');
    const unsubscribeLogs = onSnapshot(logsCollection, (snapshot) => {
      const logsList: any[] = [];
      snapshot.forEach((doc) => {
        logsList.push({ id: doc.id, ...doc.data() });
      });
      setTelemetryLogs(logsList);
      setLoading(false);
    });
    return () => unsubscribeLogs();
  }, []);

  useEffect(() => {
    const auth = getAuth();
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        const usersCollection = collection(db, 'users');
        const qProfile = query(usersCollection, where('uid', '==', user.uid));
        getDocs(qProfile).then((snap) => {
          if (!snap.empty) setUserProfile(snap.docs[0].data());
          setAuthLoading(false);
        });
      } else {
        setCurrentUser(null);
        setUserProfile(null);
        setAuthLoading(false);
      }
    });
    return () => unsubscribeAuth();
  }, []);

  const fleetRegistryIds = Array.from({ length: 100 }, (_, i) => {
    return `TV-${String(i + 1).padStart(2, '0')}`;
  });

  const handleRequestLaunchLocation = () => {
    if (typeof window !== 'undefined' && navigator.geolocation) {
      setLaunchError('REQUESTING LAUNCH POSITION CODES...');
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLaunchLatitude(position.coords.latitude.toString());
          setLaunchLongitude(position.coords.longitude.toString());
          setIsLaunchGpsActive(true);
          setLaunchError('GPS LAUNCH COORDINATES CAPTURED.');
        },
        (error) => {
          setIsLaunchGpsActive(false);
          setLaunchError('⚠️ LOCATION DENIED. PLEASE ENTER ZIP OR CITY MANUALLY.');
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    }
  };

  const handleExecuteCheckinRedirect = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = lookupVoyagerId.trim().toUpperCase();
    const enteredPass = lookupPasscode.trim();
    if (!targetId || !enteredPass) return;

    const missionDocRef = doc(db, 'voyagerMissions', targetId);
    try {
      setLookupError('VERIFYING HAND-HELD SECURITY VALUES...');
      const docSnap = await getDoc(missionDocRef);

      if (docSnap.exists()) {
        const missionData = docSnap.data();
        if (missionData.passcode && missionData.passcode === enteredPass) {
          setLookupError('');
          setLookupPasscode('');
          setLookupVoyagerId('');
          setIsCheckinLookupOpen(false);
          setIsEntranceModalOpen(false);
          router.push(`/mission/${targetId.toLowerCase()}/checkin?passKey=${encodeURIComponent(enteredPass)}`);
        } else {
          setLookupError('⚠️ SECURITY PASSCODE REJECTED. CHECK THE COVER PAGE.');
        }
      } else {
        setLookupError(`⚠️ VOLUME ${targetId} IS NOT DEPLOYED IN THE EXPEDITION REGISTRY.`);
      }
    } catch (err) {
      setLookupError('⚠️ SERVER LOG CONTEXT DISCONNECT. PLEASE TRY AGAIN.');
    }
  };

  const handleAuthAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail.trim() || !authPassword.trim()) return;
    if (isSignUpMode && !authUsername.trim()) return;

    setAuthActionLoading(true);
    setAuthActionError('');
    const auth = getAuth();

    try {
      if (isSignUpMode) {
        const credential = await createUserWithEmailAndPassword(auth, authEmail.trim(), authPassword);
        const user = credential.user;
        const newProfile = {
          uid: user.uid,
          email: user.email,
          username: authUsername.trim().toUpperCase(),
          role: 'user'
        };
        await setDoc(doc(db, 'users', user.uid), newProfile);
        setUserProfile(newProfile);
      } else {
        await signInWithEmailAndPassword(auth, authEmail.trim(), authPassword);
      }
      setIsAuthModalOpen(false);
      setAuthEmail('');
      setAuthPassword('');
      setAuthUsername('');
    } catch (err: any) {
      setAuthActionError('Identification parameters rejected or invalid credentials.');
    } finally {
      setAuthActionLoading(false);
    }
  };

  const processVesselStats = (vesselId: string, baselineData: any) => {
    if (!baselineData) return { count: 0, lastPin: null };

    const vesselLogs = telemetryLogs
      .filter(log => log.voyagerId && log.voyagerId.toUpperCase() === vesselId.toUpperCase())
      .sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));

    const explicitPossessions = vesselLogs.filter(log => log.journalOptions?.tookPossession === true).length;
    
    let currentLat = parseFloat(baselineData.latitude);
    let currentLng = parseFloat(baselineData.longitude);
    let label = `LAUNCH LOCATION: ${baselineData.originCity}`;

    vesselLogs.forEach((log) => {
      const pLat = parseFloat(log.latitude);
      const pLng = parseFloat(log.longitude);
      if (!isNaN(pLat) && !isNaN(pLng)) {
        currentLat = pLat;
        currentLng = pLng;
        label = log.reportedLocation || 'JOURNAL ENTRY';
      }
    });

    // CRITICAL FIX: Ensure we only return a valid marker position object if numbers exist
    if (isNaN(currentLat) || isNaN(currentLng)) {
      return { count: explicitPossessions, lastPin: null };
    }

    return {
      count: explicitPossessions,
      lastPin: { lat: currentLat, lng: currentLng, label }
    };
  };

  const handleLaunchNewVessel = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetVesselId = launchVoyagerId.trim().toUpperCase();
    const finalPasscode = launchPasscode.trim();
    if (!targetVesselId || !launchOriginCity.trim() || !finalPasscode) {
      setLaunchError('⚠️ ALL PARAMS INCLUDING PASSCODE REQUIREMENTS SECURED.');
      return;
    }

    setLaunchingAction(true);
    let finalOriginText = launchOriginCity.trim().toUpperCase();
    let finalLat = launchLatitude.trim();
    let finalLng = launchLongitude.trim();
    let uploadedImageUrl = '';

    const isZipCode = /^\d{5}$/.test(launchOriginCity.trim());
    if (isZipCode && !isLaunchGpsActive) {
      try {
        const geoResponse = await fetch(`https://nominatim.openstreetmap.org/search?postalcode=${launchOriginCity.trim()}&country=USA&format=json&addressdetails=1`);
        const geoData = await geoResponse.json();
        if (geoData && geoData.length > 0) {
          finalLat = geoData[0].lat;
          finalLng = geoData[0].lon;
          const addr = geoData[0].address;
          finalOriginText = `${(addr.city || addr.town || addr.county).toUpperCase()}, ${addr.state ? addr.state.toUpperCase() : 'USA'}`;
        }
      } catch (err) { console.error(err); }
    }

    try {
      if (launchImageFile) {
        const storageRef = ref(storage, `launches/${targetVesselId}_${launchImageFile.name}`);
        const uploadSnapshot = await uploadBytes(storageRef, launchImageFile);
        uploadedImageUrl = await getDownloadURL(uploadSnapshot.ref);
      }

      await setDoc(doc(db, 'voyagerMissions', targetVesselId), {
        missionId: targetVesselId,
        originCity: finalOriginText,
        latitude: finalLat || '30.6035', // Fallback safety numbers
        longitude: finalLng || '-87.9011',
        launchImageUrl: uploadedImageUrl,
        launchDate: new Date().toISOString(),
        passcode: finalPasscode
      });

      await setDoc(doc(collection(db, 'telemetryLogs')), {
        voyagerId: targetVesselId,
        handlerName: 'LAUNCH BASE',
        reportedLocation: `LAUNCH LOCATION: ${finalOriginText}`,
        latitude: finalLat || '30.6035',
        longitude: finalLng || '-87.9011',
        imageUrl: uploadedImageUrl,
        timestamp: new Date(),
        verified: true,
        isLaunchPad: true,
        displayActionContext: `${targetVesselId} LAUNCHED`
      });

      setLaunchOriginCity('');
      setLaunchLatitude('');
      setLaunchLongitude('');
      setLaunchPasscode('');
      setLaunchImageFile(null);
      setIsLaunchGpsActive(false);
      setLaunchError('');
      setIsLaunchModalOpen(false);
    } catch (err) { console.error(err); }
    setLaunchingAction(false);
  };

  // SAFELY FILTER OUT NULL PINS TO PREVENT MAP INSTANCE CRASHES
  const activeMapMarkers = Object.keys(activeVessels).map((id) => {
    const stats = processVesselStats(id, activeVessels[id]);
    return stats.lastPin ? { vesselId: id, ...stats.lastPin } :