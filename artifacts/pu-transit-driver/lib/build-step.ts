import type { Step } from '@/lib/permissions';
import { none } from '@/lib/account-steps';

// The build half of the native preflight, kept free of React Native imports so it is
// tested under node. Expo Go (executionEnvironment "storeClient") and the browser cannot
// run the background location service, so Start stays locked there — and the row says so
// in the Trip line instead of a silent grey button under a "Ready" sentence.

export function buildStep(executionEnvironment: string, platform: string): Step {
  if (platform === 'web') {
    return none(false, 'browser', 'Background tracking needs the installed PU Transit Driver app on the phone; the browser cannot run it.');
  }
  if (executionEnvironment === 'storeClient') {
    return none(false, 'Expo Go', 'Expo Go is only a preview and cannot track in the background. Install the PU Transit Driver app on this phone and sign in there.');
  }
  return none(true, 'installed app');
}
