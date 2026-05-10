export interface ProfileTag {
  id: string;
  category: string;
  name: string;
  slug: string;
  status: string;
}

export interface Profile {
  profile_id: string;
  user_id: string;
  display_name: string;
  tagline?: string;
  bio?: string;
  image_urls: string[];
  gender: ProfileTag[];
  fandom: ProfileTag[];
  interests: ProfileTag[];
  race: ProfileTag[];
  events: ProfileTag[];
  age?: number;
  is_oc?: boolean;
  is_active: boolean;
}
