import React, { createContext, useContext, useState, ReactNode } from 'react';

interface MatchedProfile {
  profile_id: string;
  display_name: string;
  image_url: string;
}

interface MatchContextType {
  showMatch: (profile: MatchedProfile) => void;
  hideMatch: () => void;
  clearMatchedProfile: () => void;
  isMatchVisible: boolean;
  matchedProfile: MatchedProfile | null;
}

const MatchContext = createContext<MatchContextType | undefined>(undefined);

export function MatchProvider({ children }: { children: ReactNode }) {
  const [isMatchVisible, setIsMatchVisible] = useState(false);
  const [matchedProfile, setMatchedProfile] = useState<MatchedProfile | null>(null);

  const showMatch = (profile: MatchedProfile) => {
    setMatchedProfile(profile);
    setIsMatchVisible(true);
  };

  const hideMatch = () => {
    setIsMatchVisible(false);
  };

  const clearMatchedProfile = () => {
    setMatchedProfile(null);
  };

  return (
    <MatchContext.Provider value={{ showMatch, hideMatch, clearMatchedProfile, isMatchVisible, matchedProfile }}>
      {children}
    </MatchContext.Provider>
  );
}

export function useMatch() {
  const context = useContext(MatchContext);
  if (context === undefined) {
    throw new Error('useMatch must be used within a MatchProvider');
  }
  return context;
}
