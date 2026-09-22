import { router } from 'expo-router';
import { Button } from '@/components/button';
import { useScanSession } from '@/features/scans/scan-provider';
import { usePhotoSession } from './photo-provider';

export function ManualPhotoAction() {
  const photo = usePhotoSession();
  const manual = useScanSession();
  return (
    <Button
      label="Enter Ingredients Manually"
      variant="secondary"
      onPress={() => {
        photo.discard();
        manual?.newList();
        router.replace('/scans/manual');
      }}
    />
  );
}
