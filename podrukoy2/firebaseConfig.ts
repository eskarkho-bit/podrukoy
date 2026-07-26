import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyA5GJjfbItpgEKS1TArXVyrcPWLoH3AGX8",
  authDomain: "domio-7ad1c.firebaseapp.com",
  projectId: "domio-7ad1c",
  storageBucket: "domio-7ad1c.firebasestorage.app",
  messagingSenderId: "380253738862",
  appId: "1:380253738862:web:0f255925da3ed50775137f",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);