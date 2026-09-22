import { useLocalSearchParams } from 'expo-router';
import { ScanReadyScreen } from '@/features/scans/scan-ready-screen';
export default function ReadyRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ScanReadyScreen id={typeof id === 'string' ? id : ''} />;
}
