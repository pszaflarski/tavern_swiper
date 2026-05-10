import '@testing-library/jest-native/extend-expect';

// Mock react-query
const mockQueryClient = {
  invalidateQueries: jest.fn(),
  setQueryData: jest.fn(),
  getQueryData: jest.fn(),
};

jest.mock('@tanstack/react-query', () => {
  const actual = jest.requireActual('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: jest.fn(() => mockQueryClient),
  };
});

// Disable React Query default listeners to prevent open handles during tests
import { focusManager, onlineManager } from '@tanstack/react-query';
focusManager.setEventListener(() => () => {});
onlineManager.setEventListener(() => () => {});

// Mock Async Storage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mock expo-router
jest.mock('expo-router', () => {
  const mockRouter = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  };
  return {
    router: mockRouter,
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({}),
    usePathname: () => '/',
    useFocusEffect: jest.fn((cb) => {
      require('react').useEffect(cb, []);
    }),
    Stack: {
      Screen: jest.fn(() => null),
    },
    Tabs: {
      Screen: jest.fn(() => null),
    },
    Link: jest.fn(({ children }) => children),
  };
});

jest.mock('./hooks/useProfiles', () => ({
  useProfiles: jest.fn(() => ({ 
    data: [
        { profile_id: 'p1', display_name: 'Hero 1', bio: 'Bio 1' },
        { profile_id: 'p2', display_name: 'Hero 2', bio: 'Bio 2' },
    ], 
    isLoading: false 
  })),
  useDiscoveryFeed: jest.fn(() => ({
    data: [{ profile_id: 'p1', display_name: 'Hero 1' }],
    isLoading: false,
  })),
  useActiveProfile: jest.fn(() => ({
    data: { profile_id: 'p1', display_name: 'Hero 1' },
    isLoading: false,
  })),
  useActivateProfile: jest.fn(() => ({
    mutate: jest.fn(),
    isLoading: false,
  })),
  useDeleteProfile: jest.fn(() => ({ mutate: jest.fn() })),
  useCreateProfile: jest.fn(() => ({ mutate: jest.fn() })),
  useUpdateProfile: jest.fn(() => ({ mutate: jest.fn() })),
}));

// Mock axios globally to prevent stream reader errors in tests
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
    get: jest.fn(() => Promise.resolve({ data: {} })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
  })),
  get: jest.fn(() => Promise.resolve({ data: {} })),
  post: jest.fn(() => Promise.resolve({ data: {} })),
  put: jest.fn(() => Promise.resolve({ data: {} })),
  delete: jest.fn(() => Promise.resolve({ data: {} })),
}));


// Mock Firebase
jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(() => ({
    currentUser: { uid: 'test-uid' },
  })),
  initializeAuth: jest.fn(() => ({
    currentUser: { uid: 'test-uid' },
  })),
  getReactNativePersistence: jest.fn(),
  browserLocalPersistence: 'browserLocalPersistence',
  signInWithEmailAndPassword: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  signInWithCredential: jest.fn(),
  signInWithPopup: jest.fn(),
  linkWithCredential: jest.fn(),
  GoogleAuthProvider: Object.assign(
    jest.fn(),
    { credential: jest.fn(() => ({ providerId: 'google.com' })) }
  ),
  signOut: jest.fn(),
  getAdditionalUserInfo: jest.fn((userCred) => userCred?.additionalUserInfo ?? null),
  onAuthStateChanged: jest.fn((auth, callback) => {
    callback({ uid: 'test-uid' });
    return jest.fn(); // Unsubscribe
  }),
}));

// Mock @react-native-google-signin/google-signin
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn().mockResolvedValue({ data: { idToken: 'mock-id-token' } }),
    signOut: jest.fn().mockResolvedValue(null),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  },
}));

jest.mock('firebase/firestore', () => ({
  getFirestore: jest.fn(),
  collection: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  onSnapshot: jest.fn(() => jest.fn()),
}));

// Mock Reanimated
require('react-native-reanimated').default;
jest.mock('react-native-reanimated', () => {
    const Reanimated = require('react-native-reanimated/mock');
    Reanimated.default.call = () => {};
    return Reanimated;
});

// Mock Gesture Handler
jest.mock('react-native-gesture-handler', () => {
    return {
        State: {},
        PanGestureHandler: 'PanGestureHandler',
        BaseButton: 'BaseButton',
        RectButton: 'RectButton',
        GestureHandlerRootView: 'GestureHandlerRootView',
        GestureDetector: ({ children }) => children,
        Gesture: {
            Pan: () => ({
                onBegin: jest.fn().mockReturnThis(),
                onUpdate: jest.fn().mockReturnThis(),
                onEnd: jest.fn().mockReturnThis(),
                onFinalize: jest.fn().mockReturnThis(),
                enabled: jest.fn().mockReturnThis(),
                minDistance: jest.fn().mockReturnThis(),
            }),
            Pinch: () => ({
                onBegin: jest.fn().mockReturnThis(),
                onUpdate: jest.fn().mockReturnThis(),
                onEnd: jest.fn().mockReturnThis(),
                onFinalize: jest.fn().mockReturnThis(),
                enabled: jest.fn().mockReturnThis(),
            }),
            Tap: () => ({
                onFinalize: jest.fn().mockReturnThis(),
                enabled: jest.fn().mockReturnThis(),
            }),
            Simultaneous: jest.fn((...gestures) => gestures[0]),
            Exclusive: jest.fn((...gestures) => gestures[0]),
        },
    };
});

// Mock expo-image-picker
jest.mock('expo-image-picker', () => ({
    launchImageLibraryAsync: jest.fn(),
    MediaTypeOptions: {
        Images: 'Images',
    },
}));

// Mock @expo/vector-icons
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
  MaterialIcons: 'MaterialIcons',
  MaterialCommunityIcons: 'MaterialCommunityIcons',
  FontAwesome: 'FontAwesome',
  Feather: 'Feather',
}));

// Mock expo-font
jest.mock('expo-font', () => ({
  isLoaded: jest.fn(() => true),
  loadAsync: jest.fn(() => Promise.resolve()),
}));

// Mock react-native-keyboard-controller
jest.mock('react-native-keyboard-controller', () => {
  return {
    KeyboardProvider: ({ children }) => children,
    KeyboardAvoidingView: ({ children }) => children,
    KeyboardAwareScrollView: ({ children }) => children,
    useKeyboardHandler: jest.fn(),
    useReanimatedKeyboardAnimation: jest.fn(() => ({
      height: { value: 0 },
    })),
    KeyboardController: {
      setInputMode: jest.fn(),
      setDefaultMode: jest.fn(),
    },
  };
});

// Mock react-native-safe-area-context
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  SafeAreaProvider: ({ children }) => children,
  SafeAreaView: ({ children }) => children,
}));

// Silence the warning: Animated: `useNativeDriver` is not supported because the native animated module is missing
// jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');

import { deleteApp, getApps } from 'firebase/app';
afterAll(async () => {
  await Promise.all(getApps().map(app => deleteApp(app)));
});

afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});
