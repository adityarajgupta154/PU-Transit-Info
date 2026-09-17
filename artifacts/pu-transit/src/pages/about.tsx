import { Headline } from '@/components/metro/tile';

export default function About() {
  return (
    <div className="metro-turnstile flex flex-1 flex-col gap-8 px-5 py-6 md:px-8 md:py-12 lg:px-12 max-w-3xl">
      <Headline>about pu transit</Headline>
      <p className="text-xl font-light text-muted-foreground -mt-4">
        Find your bus. Every day.
      </p>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-light">using the app</h2>
        <div className="flex flex-col gap-3 text-lg">
          <p>
            <strong>University accounts:</strong> Access requires a Parul University email. If you register with a personal email, you have a 30-day grace period to use the app before you must link a university address.
          </p>
          <p>
            <strong>Role approval:</strong> All driver and admin accounts must be manually verified and approved by the transport office. Requesting a role does not grant immediate access.
          </p>
          <p>
            <strong>Driver location:</strong> For drivers, the app must remain open on the screen to share live location. Browsers pause tracking if the phone sleeps or switches apps.
          </p>
          <p>
            <strong>No timing guarantees:</strong> Bus positions are derived from live GPS data, but we do not predict or guarantee exact arrival times. Always check the timestamp on a bus's location.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-4 pt-6 border-t-2 border-border/50">
        <h2 className="text-2xl font-light">transport office help</h2>
        <div className="flex flex-col gap-1 text-lg">
          <p>P.O. Limda, Ta. Waghodia 391760</p>
          <p>Transport Office TS / Pick & Drop P4</p>
          <p>
            Helpline:{' '}
            <a href="tel:18001231104" className="text-primary underline underline-offset-4 hover:text-foreground">
              1800-123-1104
            </a>
          </p>
          <p>
            <a href="mailto:info@paruluniversity.ac.in" className="text-primary underline underline-offset-4 hover:text-foreground">
              info@paruluniversity.ac.in
            </a>
          </p>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          PU Transit is a utility for the campus community. It makes no official claims regarding scheduling or liability.
        </p>
      </section>
    </div>
  );
}
