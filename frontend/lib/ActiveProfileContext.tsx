import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

  // Load from storage on mount
  useEffect(() => {
    const loadProfile = async () => {
      try {
        const savedId = await AsyncStorage.getItem(STORAGE_KEY);
        if (savedId) {
          setActiveProfileIdState(savedId);
        }
      } catch (e) {
        console.error('Failed to load active profile from storage', e);
      } finally {
        setIsLoadingProfile(false);
      }
    };
    loadProfile();
  }, []);

  const setActiveProfileId = async (id: string | null) => {
    try {
      if (id) {
        await AsyncStorage.setItem(STORAGE_KEY, id);
      } else {
        await AsyncStorage.removeItem(STORAGE_KEY);
      }
      setActiveProfileIdState(id);
    } catch (e) {
      console.error('Failed to save active profile to storage', e);
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
