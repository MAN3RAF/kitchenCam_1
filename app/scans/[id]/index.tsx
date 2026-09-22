import { useLocalSearchParams } from 'expo-router';
import { ScanEditorScreen } from '@/features/scans/scan-editor-screen';
export default function ScanRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ScanEditorScreen id={typeof id === 'string' ? id : ''} />;
}
