import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="w-full border-t">
      <div className="mx-auto flex w-full max-w-6xl px-5">
        <div className="flex w-full flex-col items-center justify-between gap-4 py-10 text-center text-xs text-secondary sm:flex-row sm:text-left">
          <p>
            © DigitalTwin. Powered by{" "}
            <a
              href="https://supabase.com/?utm_source=create-next-app&utm_medium=template&utm_term=nextjs"
              target="_blank"
              className="font-semibold hover:underline"
              rel="noreferrer"
            >
              Supabase
            </a>
            .
          </p>
          <div className="flex items-center gap-3">
            <Link href="/#produkt" className="hover:underline">
              Produkt
            </Link>
            <Link href="/#so-funktionierts" className="hover:underline">
              So funktioniert’s
            </Link>
            <Link href="/#zugang" className="hover:underline">
              Zugang
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
