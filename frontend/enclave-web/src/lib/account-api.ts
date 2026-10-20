import { apiRequest, ApiError } from './api';
export type AccountProfile = { avatar_url: string | null };
// Proposed backend contract. Do not substitute localStorage or fake success.
export async function getAccountProfile() {
  return apiRequest<AccountProfile>('/api/v1/account/profile');
}
export async function uploadAccountPhoto(file: File) {
  const body = new FormData(); body.append('photo', file);
  try {
    const result = await apiRequest<AccountProfile>('/api/v1/account/avatar', { method: 'POST', body });
    if (!result.avatar_url || !/^https:\/\//i.test(result.avatar_url)) throw new Error('The server did not return a valid photo URL.');
    return result;
  } catch (error) {
    if (error instanceof ApiError && [404, 405, 501].includes(error.status)) throw new Error('Photo upload is not available yet. Please try again later.');
    throw error;
  }
}
