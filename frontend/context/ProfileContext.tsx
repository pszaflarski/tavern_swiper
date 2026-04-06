import React, { createContext, useContext, ReactNode } from 'react';
import { useProfiles, useUpdateProfile } from '../hooks/useProfiles';
import { useUser } from '../hooks/useUser';

interface ProfileContextType {
  activeProfileId: string | undefined;
  setActiveProfileId: (id: string) => void;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const { data: myProfiles } = useProfiles(user?.uid);
  const updateProfileMutation = useUpdateProfile();

  // Derive activeProfileId from boolean flag on Profile
  const activeProfileId = React.useMemo(() => {
    return myProfiles?.find(p => p.is_active)?.profile_id;
  }, [myProfiles]);

  const setActiveProfileId = (id: string) => {
    updateProfileMutation.mutate({ profileId: id, data: { is_active: true } });
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
