import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { profilesApi } from '../lib/api';

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
  image_url?: string;
  image_urls?: string[];
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
      const formData = new FormData();
      formData.append('file', {
        uri,
        type: mimeType,
        name: `profile-${profileId}-${index}.jpg`,
      } as unknown as Blob);
      const res = await profilesApi.post(`/profiles/${profileId}/image?index=${index}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['profiles', data.profile_id] });
    },
  });
}
