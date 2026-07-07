// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";

import {
    getDatabase,
    ref,
    set,
    onValue,
    get,
    update,
    remove,
    push
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";

import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    onAuthStateChanged,
    signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyAOLryNgT5VB6eeQpGc3XXMmeayWTX3mSU",
    authDomain: "competition-scoring-af96a.firebaseapp.com",
    databaseURL: "https://competition-scoring-af96a-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "competition-scoring-af96a",
    storageBucket: "competition-scoring-af96a.firebasestorage.app",
    messagingSenderId: "602390733467",
    appId: "1:602390733467:web:1fb3f08fba9587d6a11c3e"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Replace this with your own Google account email before sharing the app publicly.
const ALLOWED_ADMIN_EMAILS = ["kubakristan@gmail.com"];
const allowAnyGoogleUserOnLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

let authState = {
    user: null,
    isAdmin: false,
    loading: true,
    error: null
};

const authListeners = new Set();

function normalizeEmail(email) {
    return (email || "").trim().toLowerCase();
}

function isAllowedAdmin(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return false;

    if (ALLOWED_ADMIN_EMAILS.some((allowed) => normalizeEmail(allowed) === normalizedEmail)) {
        return true;
    }

    return allowAnyGoogleUserOnLocalhost && normalizedEmail.endsWith("@gmail.com");
}

function emitAuthState(nextState) {
    authState = nextState;
    authListeners.forEach((listener) => listener(authState));
}

function getCurrentOrigin() {
    const { hostname, port } = window.location;
    return port ? `${hostname}:${port}` : hostname;
}

function getFriendlyAuthError(error) {
    if (error?.code === "auth/unauthorized-domain") {
        const currentOrigin = getCurrentOrigin();
        return `Firebase rejected this domain: ${currentOrigin}. Open Firebase Console → Authentication → Settings → Authorized domains and add "${currentOrigin}". If you are opening the page directly from a file, run it from a local web server such as http://localhost:5500 instead.`;
    }

    if (error?.code === "ACCESS_DENIED") {
        return "Only the configured admin Google account can access this panel.";
    }

    if (error?.code === "auth/admin-restricted-operation" || error?.code === "auth/operation-not-allowed") {
        return "Anonymous sign-in is not enabled for this Firebase project. Open Firebase Console → Authentication → Sign-in method and turn on Anonymous.";
    }

    return error?.message || "Google sign-in failed.";
}

export function onAuthStateChange(callback) {
    if (typeof callback !== "function") return;

    authListeners.add(callback);
    callback(authState);

    return () => authListeners.delete(callback);
}

export function getAuthState() {
    return authState;
}

export async function signInWithGoogle() {
    try {
        if (auth.currentUser?.isAnonymous) {
            await signOut(auth);
        }

        if (auth.currentUser && !auth.currentUser.isAnonymous) {
            const isAdmin = isAllowedAdmin(auth.currentUser.email);
            if (isAdmin) {
                emitAuthState({ user: auth.currentUser, isAdmin: true, loading: false, error: null });
                return { user: auth.currentUser, isAdmin: true };
            }

            await signOut(auth);
        }

        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;
        const isAdmin = isAllowedAdmin(user?.email);

        if (!isAdmin) {
            await signOut(auth);
            const error = new Error("ACCESS_DENIED");
            error.code = "ACCESS_DENIED";
            throw error;
        }

        emitAuthState({ user, isAdmin: true, loading: false, error: null });
        return { user, isAdmin: true };
    }
    catch (error) {
        const friendlyMessage = getFriendlyAuthError(error);
        const wrappedError = new Error(friendlyMessage);
        wrappedError.code = error?.code || "AUTH_ERROR";
        wrappedError.originalError = error;
        throw wrappedError;
    }
}

export async function ensureAnonymousAuth() {
    try {
        await auth.authStateReady();

        if (auth.currentUser) {
            return auth.currentUser;
        }

        const result = await signInAnonymously(auth);
        return result.user;
    }
    catch (error) {
        const friendlyMessage = getFriendlyAuthError(error);
        const wrappedError = new Error(friendlyMessage);
        wrappedError.code = error?.code || "AUTH_ERROR";
        wrappedError.originalError = error;
        throw wrappedError;
    }
}

export async function signOutAdmin() {
    await signOut(auth);
    emitAuthState({ user: null, isAdmin: false, loading: false, error: null });
}

onAuthStateChanged(auth, (user) => {
    if (!user) {
        emitAuthState({ user: null, isAdmin: false, loading: false, error: null });
        return;
    }

    const isAdmin = isAllowedAdmin(user.email);
    emitAuthState({
        user,
        isAdmin,
        loading: false,
        error: isAdmin ? null : "Please sign in with the configured admin Google account."
    });
});

export { db, auth };