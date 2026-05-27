import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";

// Paste your exact Web App configuration object from your Firebase Console here:
const firebaseConfig = {
  apiKey: "AIzaSyCfBJYIXApS9oab1qVV67pzvYKU0DefHNM",
  authDomain: "terra-voyager26.firebaseapp.com",
  projectId: "terra-voyager26",
  storageBucket: "terra-voyager26.firebasestorage.app",
  messagingSenderId: "789449097431",
  appId: "1:789449097431:web:54cb4470f1a3e119317092",
  measurementId: "G-X172G9M9PP"
};

// Initialize Firebase safely for Next.js server-side vs client-side environments
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Export the specific service connections for use throughout our app routes
const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);

export { db, storage, auth };