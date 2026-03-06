import { useContext } from 'react';
import { ProfileContext } from '@/features/settings/context/ProfileContext';

export function useProfile() {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return context;
}
