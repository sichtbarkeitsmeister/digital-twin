export function SiteFooter() {
  return (
    <footer className="w-full border-t">
      <div className="mx-auto flex w-full max-w-6xl px-5">
        <div className="flex w-full flex-col items-center justify-between gap-4 py-10 text-center text-xs text-secondary sm:flex-row sm:text-left">
          <p>
            © DigitalTwin. Powered by{" "}
            <a
              href="https://www.sichtbarkeitsmeister.de/"
              target="_blank"
              className="font-semibold hover:underline"
              rel="noreferrer"
            >
              sbkm
            </a>
            .
          </p>
        </div>
      </div>
    </footer>
  );
}
