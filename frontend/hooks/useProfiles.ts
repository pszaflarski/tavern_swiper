import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { profilesApi, getIdToken } from '../lib/api';

export interface CoreAttributes {
  strength: number;
  charisma: number;
  spark: number;
}

export interface Profile {
  profile_id: string;
  user_id: string;
  display_name: string;
  tagline?: string;
  bio?: string;
  character_class?: string;
  realm?: string;
  talents: string[];
  attributes: CoreAttributes;
  image_urls: string[];
  gender?: string;
}

export function useProfiles(userId: string | undefined) {
  return useQuery<Profile[]>({
    queryKey: ['profiles', 'user', userId],
    queryFn: async () => {
      const res = await profilesApi.get(`/profiles/user/${userId}`);
      return res.data;
    },
    enabled: !!userId,
  });
}

export function useProfile(profileId: string | undefined) {
  return useQuery<Profile>({
    queryKey: ['profiles', profileId],
    queryFn: async () => {
      const res = await profilesApi.get(`/profiles/${profileId}`);
      return res.data;
    },
    enabled: !!profileId,
  });
}

export function useCreateProfile() {
  const queryClient = useQueryClient();
  return useMutation<Profile, Error, Omit<Profile, 'profile_id'>>({
    mutationFn: async (data) => {
      const res = await profilesApi.post('/profiles/', data);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['profiles', 'user', data.user_id] });
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation<Profile, Error, { profileId: string; data: Partial<Omit<Profile, 'profile_id' | 'user_id'>> }>({
    mutationFn: async ({ profileId, data }) => {
      const res = await profilesApi.put(`/profiles/${profileId}`, data);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['profiles', data.profile_id] });
      queryClient.invalidateQueries({ queryKey: ['profiles', 'user', data.user_id] });
    },
  });
}

export function useUploadProfileImage() {
  const queryClient = useQueryClient();
  return useMutation<Profile, Error, { profileId: string; uri: string; index?: number; mimeType?: string }>({
    mutationFn: async ({ profileId, uri, index = 0, mimeType = 'image/jpeg' }) => {
      // Use the browser's native FormData on web to ensure correct binary encoding
      const FormDataClass = (Platform.OS === 'web' && typeof window !== 'undefined') ? window.FormData : FormData;
      const formData = new FormDataClass();
      
      // On web, we must fetch the local URI (blob:, data:, or local path) to get a real Blob object
      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        const blob = await response.blob();
        formData.append('file', blob, `profile-${profileId}-${index}.jpg`);
      } else {
        // Standard React Native / non-web approach (using { uri, type, name } object)
        formData.append('file', {
          uri,
          type: mimeType,
          name: `profile-${profileId}-${index}.jpg`,
        } as unknown as Blob);
      }

      // Manually fetch the ID token for the direct fetch call
      const token = await getIdToken();
      
      // We use native fetch here instead of profilesApi (Axios) because 
      // some hybrid environments (Web + Expo) interfere with Axios's 
      // automatic multipart/form-data detection, resulting in 422 errors.
      const baseUrl = profilesApi.defaults.baseURL;
      const response = await fetch(`${baseUrl}/profiles/${profileId}/image?index=${index}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          // DO NOT set 'Content-Type': 'multipart/form-data' manually here, 
          // letting the browser set it with the correct boundary.
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const axiosError = new Error(`Request failed with status code ${response.status}`) as any;
        axiosError.response = { data: errorData, status: response.status };
        throw axiosError;
      }

      return await response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['profiles', data.profile_id] });
    },
  });
}
