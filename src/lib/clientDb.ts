import { 
  collection, 
  doc, 
  setDoc, 
  getDocs, 
  getDocFromServer, 
  query, 
  where, 
  deleteDoc, 
  serverTimestamp, 
  Timestamp 
} from 'firebase/firestore';
import { db, auth } from './firebase';

const DB_NAME = "radio_gemini_db";
const STORE_NAME = "user_shows";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("IndexedDB failed to open:", request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "title" });
      }
    };
  });

  return dbPromise;
}

// --- FIRESTORE CONNECTION VALIDATION ---
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

// --- ERROR HANDLING SPECIFICATION ---
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Helper to make a secure, clean document ID for a show
function getShowId(title: string): string {
  return title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}

// --- MAIN DATABASE OPERATIONS ---

export async function saveUserShow(show: any): Promise<void> {
  // Always save to IndexedDB as a resilient offline/guest fallback
  try {
    const dbInst = await getDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = dbInst.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(show);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("IndexedDB saveUserShow failed:", err);
  }

  // Save to Firestore when user is signed in
  if (auth.currentUser) {
    const userId = auth.currentUser.uid;
    const showId = getShowId(show.title);

    // 1. Enforce user profile existence / updates
    const userPath = `users/${userId}`;
    try {
      const userRef = doc(db, 'users', userId);
      await setDoc(userRef, {
        email: auth.currentUser.email || '',
        createdAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, userPath);
    }

    // 2. Write the show document
    const showPath = `shows/${showId}`;
    try {
      const showRef = doc(db, 'shows', showId);
      const showData = {
        userId,
        title: show.title,
        duration: typeof show.duration === 'number' ? show.duration : 0,
        summary: show.summary || '',
        date: show.date || new Date().toISOString().split('T')[0],
        host: show.host || 'Paul',
        coverImage: show.coverImage || 'https://www.gstatic.com/aistudio/starter-apps/assets/ai_radio/cover.jpg',
        audioUrl: show.audioUrl || '',
        transcript: Array.isArray(show.transcript) ? show.transcript : [],
        createdAt: show.createdAt ? Timestamp.fromDate(new Date(show.createdAt)) : serverTimestamp(),
        updatedAt: serverTimestamp()
      } as any;

      if (show.notesUrl) showData.notesUrl = show.notesUrl;
      if (show.shareId) showData.shareId = show.shareId;
      if (show.shareUrl) showData.shareUrl = show.shareUrl;
      if (show.isUserGenerated !== undefined) showData.isUserGenerated = show.isUserGenerated;

      await setDoc(showRef, showData);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, showPath);
    }
  }
}

export async function getUserShows(): Promise<any[]> {
  let shows: any[] = [];

  // Read from Firestore if signed in
  if (auth.currentUser) {
    const showsPath = 'shows';
    try {
      const q = query(collection(db, 'shows'), where('userId', '==', auth.currentUser.uid));
      const snapshot = await getDocs(q);
      shows = snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
          ...data,
          createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : data.createdAt,
          updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : data.updatedAt
        };
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, showsPath);
    }
  }

  // If shows list is empty (e.g. offline, guest, or empty profile), fallback to IndexedDB
  if (shows.length === 0) {
    try {
      const dbInst = await getDB();
      shows = await new Promise<any[]>((resolve, reject) => {
        const transaction = dbInst.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
          resolve(request.result || []);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error("IndexedDB getUserShows failed:", err);
    }
  }

  // Sort shows by date descending (newest first)
  shows.sort((a, b) => {
    const dateA = new Date(a.date || 0).getTime();
    const dateB = new Date(b.date || 0).getTime();
    return dateB - dateA;
  });

  return shows;
}

export async function deleteUserShow(title: string): Promise<void> {
  // Delete from IndexedDB
  try {
    const dbInst = await getDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = dbInst.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(title);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("IndexedDB deleteUserShow failed:", err);
  }

  // Delete from Firestore if signed in
  if (auth.currentUser) {
    const showId = getShowId(title);
    const showPath = `shows/${showId}`;
    try {
      const showRef = doc(db, 'shows', showId);
      await deleteDoc(showRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, showPath);
    }
  }
}
