import { IRacingProvider } from './src/main/iracing/provider.ts';
const provider1 = new IRacingProvider();
provider1.start();
console.log("P1 native loaded:", provider1.diagnose().mmf.nativeLoaded);
const provider2 = new IRacingProvider();
provider2.start();
console.log("P2 native loaded:", provider2.diagnose().mmf.nativeLoaded);
