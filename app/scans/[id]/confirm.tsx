import { useLocalSearchParams } from 'expo-router';
import { ScanConfirmScreen } from '@/features/scans/scan-confirm-screen';
export default function ConfirmRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ScanConfirmScreen id={typeof id === 'string' ? id : ''} />;
}
