import { ArrowLeft } from 'lucide-react';
import { Headline, TileButton } from '@/components/metro/tile';

export default function NotFound() {
  return (
    <div className="metro-turnstile flex flex-1 flex-col gap-6 px-5 py-6 md:px-8 md:py-12 lg:px-12">
      <Headline>no such page</Headline>
      <p className="max-w-xl text-xl">nothing lives at this address. the bus search is on the home page.</p>
      <TileButton tone="blue" href="/" className="min-h-20 w-full max-w-xl text-2xl">
        <ArrowLeft className="h-7 w-7" strokeWidth={1.5} aria-hidden />
        <span>home</span>
      </TileButton>
    </div>
  );
}
