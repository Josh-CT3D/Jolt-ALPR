import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User 
} from "firebase/auth";
import firebaseConfig from "../firebase-applet-config.json";

// Initialize the Firebase app with the loaded config
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Configure the Google Auth Provider with the Google Drive file scope
export const provider = new GoogleAuthProvider();
provider.addScope("https://www.googleapis.com/auth/drive.file");

let isSigningIn = false;
let cachedAccessToken: string | null = null;

/**
 * Initializes the Auth observer and listens to changes of authentication state.
 * Syncs the authentication with our client-side state.
 */
export const initAuth = (
  onAuthSuccess: (user: User, token: string) => void,
  onAuthFailure: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure();
    }
  });
};

/**
 * Signs in using Firebase web SDK Google popups.
 * Stores the retrieved access token in transient memory.
 */
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Failed to capture a valid Google Drive OAuth access token.");
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error("Firebase authentication error:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

/**
 * Retrieves the currently active OAuth token from local memory.
 */
export const getAccessToken = (): string | null => {
  return cachedAccessToken;
};

/**
 * Logs the current driver profile session out of Google Workspace.
 */
export const logoutGoogle = async () => {
  await signOut(auth);
  cachedAccessToken = null;
};
