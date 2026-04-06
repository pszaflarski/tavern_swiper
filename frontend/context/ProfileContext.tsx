import React, { createContext, useContext, ReactNode } from 'react';
import { useProfiles, useUpdateProfile, useActiveProfile } from '../hooks/useProfiles';
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
  const updateProfileMutation = useUpdateProfile();

  const activeProfileId = React.useMemo(() => {
    return activeProfile?.profile_id;
  }, [activeProfile]);

  const setActiveProfileId = (id: string) => {
    updateProfileMutation.mutate({ profileId: id, data: { is_active: true } });
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
