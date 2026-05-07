import React, { createContext, useContext, ReactNode } from 'react';
import { useProfiles, useActiveProfile, useActivateProfile, Profile } from '../hooks/useProfiles';
import { useUser } from '../hooks/useUser';

interface ProfileContextType {
  activeProfileId: string | undefined;
  setActiveProfileId: (id: string) => void;
  isLoadingActiveProfile: boolean;
  isLoadingProfiles: boolean;
  refetchActiveProfile: () => void;
  refetchProfiles: () => void;
  profiles: Profile[];
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { uid, isAuthenticated, isLoading: isAuthLoading } = useUser();
  
  // Wait for auth to be fully initialized AND for the backend user record
  // to be confirmed (or auto-created via our self-healing logic).
  // This prevents 404s on downstream profile calls during registration.
  const authReady = isAuthenticated && !isAuthLoading && !!uid;
  
  const { data: activeProfile, isLoading: isLoadingActiveProfile, refetch: refetchActiveProfile } = useActiveProfile(uid, authReady);
  
  // Pre-fetch all profiles for the user as soon as auth is ready.
  // This populates the React Query cache globally and instantly.
  const { data: profiles = [], isLoading: isLoadingProfiles, refetch: refetchProfiles } = useProfiles(authReady ? uid : undefined);
  
  const activateProfileMutation = useActivateProfile(uid);

  const activeProfileId = React.useMemo(() => {
    return activeProfile?.profile_id;
  }, [activeProfile]);

  const setActiveProfileId = (id: string) => {
    if (!id) return;
    activateProfileMutation.mutate(id);
  };

  return (
    <ProfileContext.Provider value={{ 
      activeProfileId, 
      setActiveProfileId, 
      isLoadingActiveProfile,
      isLoadingProfiles,
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
