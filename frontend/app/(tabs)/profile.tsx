import React from 'react';
import CharacterProfile from '../../components/CharacterProfile';

export default function ProfileScreen() {
  return (
    <CharacterProfile
      profile={{
        profile_id: 'me',
        user_id: 'user-1',
        display_name: 'Your Hero',
        tagline: 'Ready for the next quest.',
        character_class: 'Adventurer',
        realm: 'Fort Tavern',
        bio: 'A traveler of vast lands and taster of fine ales. Looking for a companion to share the road.',
        talents: ['Cooking', 'Swordsmanship', 'Poetry', 'Navigation'],
        attributes: { strength: 7, charisma: 8, spark: 9 },
      }}
      isOwnProfile
      onEdit={() => console.log('Edit pressed')}
    />
  );
}
