import { requireOptionalNativeModule } from 'expo';
import { PreparationError, type Dimensions } from './preparation-policy';

export type RenderRequest = {
  source: string;
  target: string;
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
  format: 'jpeg' | 'png' | 'webp';
  matrix: readonly number[];
  quality: number;
};
export interface NativePixelRenderer {
  render(request: RenderRequest): Promise<void>;
  verify(uri: string, width: number, height: number): Promise<Dimensions>;
}
export function pixelRenderer(): NativePixelRenderer {
  const module = requireOptionalNativeModule<NativePixelRenderer>('KitchenCamImage');
  if (!module) throw new PreparationError('UNAVAILABLE');
  return module;
}
