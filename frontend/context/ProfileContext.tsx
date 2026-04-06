import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useProfiles } from '../hooks/useProfiles';
import { useUser } from '../hooks/useUser';

interface ProfileContextType {
  activeProfileId: string | undefined;
  setActiveProfileId: (id: string) => void;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const { data: myProfiles } = useProfiles(user?.uid);
  const [activeProfileId, setActiveProfileIdInternal] = useState<string | undefined>(undefined);

  // Default to the first profile if none is selected and profiles are loaded
  useEffect(() => {
    if (!activeProfileId && myProfiles && myProfiles.length > 0) {
      setActiveProfileIdInternal(myProfiles[0].profile_id);
    }
  }, [myProfiles, activeProfileId]);

  const setActiveProfileId = (id: string) => {
    setActiveProfileIdInternal(id);
  };

  return (
    <ProfileContext.Provider value={{ activeProfileId, setActiveProfileId }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfileContext() {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error('useProfileContext must be used within a ProfileProvider');
  }
  return context;
}
