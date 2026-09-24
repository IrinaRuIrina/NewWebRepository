// Gemeinsame Firebase-Verbindung für Tagebuch und Notizen.
// Die Konfiguration ist öffentlich (Firebase-Web-Konfiguration); der Zugriff wird
// über die Firestore-Sicherheitsregeln und die Anmeldung geschützt.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyAwpQ5RJhmg3EclFhCDxsvw7O8ExuA1jbs",
    authDomain: "camino-tagebuch.firebaseapp.com",
    projectId: "camino-tagebuch",
    storageBucket: "camino-tagebuch.firebasestorage.app",
    messagingSenderId: "496232405910",
    appId: "1:496232405910:web:e8eca9a786b91a67f59bb7"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
