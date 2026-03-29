import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usersApi } from './api';
import { auth } from './firebase';
import { onAuthStateChanged } from '@firebase/auth';

interface ActiveProfileContextType {
  activeProfileId: string | null;
  setActiveProfileId: (id: string | null) => void;
  isLoadingProfile: boolean;
}

const ActiveProfileContext = createContext<ActiveProfileContextType | undefined>(undefined);

const STORAGE_KEY = '@tavern_swiper_active_profile';

export const ActiveProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeProfileId, setActiveProfileIdState] = useState<string | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  // Load from API (Source of Truth) or Fallback to storage
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setIsLoadingProfile(true);
        try {
          // 1. Try fetching from Users service
          const { data } = await usersApi.get('/users/me');
          if (data.active_profile_id) {
            setActiveProfileIdState(data.active_profile_id);
            await AsyncStorage.setItem(STORAGE_KEY, data.active_profile_id);
          } else {
            // 2. Fallback to local storage if not in DB yet
            const savedId = await AsyncStorage.getItem(STORAGE_KEY);
            if (savedId) {
              setActiveProfileIdState(savedId);
              // Update DB with the local preference
              await usersApi.put('/users/me', { active_profile_id: savedId });
            }
          }
        } catch (e) {
          console.warn('Failed to sync active profile from API, falling back to local storage', e);
          const savedId = await AsyncStorage.getItem(STORAGE_KEY);
          if (savedId) setActiveProfileIdState(savedId);
        } finally {
          setIsLoadingProfile(false);
        }
      } else {
        // Logged out
        setActiveProfileIdState(null);
        setIsLoadingProfile(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const setActiveProfileId = async (id: string | null) => {
    try {
      setActiveProfileIdState(id);
      
      // Update local storage
      if (id) {
        await AsyncStorage.setItem(STORAGE_KEY, id);
      } else {
        await AsyncStorage.removeItem(STORAGE_KEY);
      }

      // Sync with API if logged in
      if (auth.currentUser) {
        await usersApi.put('/users/me', { active_profile_id: id });
      }
    } catch (e) {
      console.error('Failed to save active profile', e);
    }
  };

  return (
    <ActiveProfileContext.Provider value={{ activeProfileId, setActiveProfileId, isLoadingProfile }}>
      {children}
    </ActiveProfileContext.Provider>
  );
};

export const useActiveProfile = () => {
  const context = useContext(ActiveProfileContext);
  if (context === undefined) {
    throw new Error('useActiveProfile must be used within an ActiveProfileProvider');
  }
  return context;
};
