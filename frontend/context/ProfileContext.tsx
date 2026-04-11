import React, { createContext, useContext, ReactNode } from 'react';
import { useProfiles, useActiveProfile, useActivateProfile } from '../hooks/useProfiles';
import { useUser } from '../hooks/useUser';

interface ProfileContextType {
  activeProfileId: string | undefined;
  setActiveProfileId: (id: string) => void;
  isLoadingActiveProfile: boolean;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useUser();
  const { data: activeProfile, isLoading: isLoadingActiveProfile } = useActiveProfile(isAuthenticated);
  
  // Pre-fetch all profiles for the user as soon as they are identified.
  // This populates the React Query cache globaly.
  const { isFetching: isFetchingProfiles } = useProfiles(user?.uid);
  
  const activateProfileMutation = useActivateProfile(user?.uid);

  const activeProfileId = React.useMemo(() => {
    return activeProfile?.profile_id;
  }, [activeProfile]);

  const setActiveProfileId = (id: string) => {
    activateProfileMutation.mutate(id);
  };

  return (
    <ProfileContext.Provider value={{ activeProfileId, setActiveProfileId, isLoadingActiveProfile }}>
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
