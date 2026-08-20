// ================================================================
// FIREBASE CONFIG — Inicialización del SDK v9+ (módulos ES)
// Proyecto: sistema-biblioteca-usm
// ================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Configuración del proyecto Firebase
const firebaseConfig = {
    apiKey: "AIzaSyDgDx7_6SEgR-s0J3ZcN6jnytQmS07oeEw",
    authDomain: "sistema-biblioteca-usm.firebaseapp.com",
    projectId: "sistema-biblioteca-usm",
    storageBucket: "sistema-biblioteca-usm.firebasestorage.app",
    messagingSenderId: "1017689286626",
    appId: "1:1017689286626:web:953b6d449475178f19fbbb",
    measurementId: "G-87T0JCTW7X"
};

// Inicializar Firebase App
const app = initializeApp(firebaseConfig);

// Inicializar Firestore Database
const db = getFirestore(app);

// Exportar la instancia de Firestore para uso en app.js
export { db };
