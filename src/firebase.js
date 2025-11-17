// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Your existing Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBxM_g1JyOJwjvdW46ibQnRoeCHoGj6_qw",
  authDomain: "image-analysis-website.firebaseapp.com",
  projectId: "image-analysis-website",
  storageBucket: "image-analysis-website.firebasestorage.app",
  messagingSenderId: "180465389072",
  appId: "1:180465389072:web:e8a0b580ca550808590495"
};

// ✅ FIRST initialize the app
const app = initializeApp(firebaseConfig);

// ✅ THEN export services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
