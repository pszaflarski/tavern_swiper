import CharacterProfile from '../../components/CharacterProfile';
import { auth } from '../../lib/firebase';
import { useUser } from '../../hooks/useUser';

export default function ProfileScreen() {
  const { user } = useUser();

  const handleLogout = () => {
    auth.signOut();
  };

  return (
    <CharacterProfile
      profile={{
        profile_id: 'me',
        user_id: user?.uid || 'user-1',
        display_name: user?.full_name || 'Your Hero',
        tagline: 'Ready for the next quest.',
        character_class: 'Adventurer',
        realm: 'Fort Tavern',
        bio: 'A traveler of vast lands and taster of fine ales. Looking for a companion to share the road.',
        talents: ['Cooking', 'Swordsmanship', 'Poetry', 'Navigation'],
        attributes: { strength: 7, charisma: 8, spark: 9 },
      }}
      isOwnProfile
      onEdit={() => console.log('Edit pressed')}
      onLogout={handleLogout}
    />
  );
}
