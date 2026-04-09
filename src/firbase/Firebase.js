// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDfyZEwl2AIq8MFweA4aAPKKs-7WxynMRM",
  authDomain: "rita-ede4f.firebaseapp.com",
  projectId: "rita-ede4f",
  storageBucket: "rita-ede4f.firebasestorage.app",
  messagingSenderId: "460746408608",
  appId: "1:460746408608:web:a263f0cc84578f8b00bfc5",
  measurementId: "G-BG6Y24WSWF",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

export const db = getFirestore(app);
