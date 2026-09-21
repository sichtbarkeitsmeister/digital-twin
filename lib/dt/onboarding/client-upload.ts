export async function uploadOnboardingFileToSignedUrl(input: {
  file: File;
  signedUrl: string;
  mimeType: string;
}): Promise<void> {
  const res = await fetch(input.signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": input.mimeType || input.file.type || "application/octet-stream",
    },
    body: input.file,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || "Die Datei konnte nicht in die Cloud geladen werden.");
  }
}
