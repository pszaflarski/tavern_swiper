import React, { createContext, useContext, ReactNode } from 'react';
import { useProfiles, useActiveProfile, useActivateProfile, Profile } from '../hooks/useProfiles';
import { useUser } from '../hooks/useUser';

interface ProfileContextType {
  activeProfileId: string | undefined;
  setActiveProfileId: (id: string) => void;
  isLoadingActiveProfile: boolean;
  refetchActiveProfile: () => void;
  refetchProfiles: () => void;
  profiles: Profile[];
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { uid, isAuthenticated } = useUser();
  const { data: activeProfile, isLoading: isLoadingActiveProfile, refetch: refetchActiveProfile } = useActiveProfile(uid, isAuthenticated);
  
  // Pre-fetch all profiles for the user as soon as they are identified (even from storage).
  // This populates the React Query cache globally and instantly.
  const { data: profiles = [], isFetching: isFetchingProfiles, refetch: refetchProfiles } = useProfiles(uid);
  
  const activateProfileMutation = useActivateProfile(uid);

  const activeProfileId = React.useMemo(() => {
    return activeProfile?.profile_id;
  }, [activeProfile]);

  const setActiveProfileId = (id: string) => {
    activateProfileMutation.mutate(id);
  };

  return (
    <ProfileContext.Provider value={{ 
      activeProfileId, 
      setActiveProfileId, 
      isLoadingActiveProfile,
      refetchActiveProfile,
      refetchProfiles,
      profiles
    }}>
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
