/**
 * Search dispatches by shape, on the server, so a pasted value goes where it
 * belongs without the user having to know which kind of thing it is.
 */
import { redirect } from "next/navigation";

export function SearchBox() {
  async function search(formData: FormData) {
    "use server";
    const raw = String(formData.get("q") ?? "").trim();
    if (!raw) redirect("/");

    if (/^\d+$/.test(raw)) redirect(`/block/${raw}`);
    if (/^[0-9A-Fa-f]{64}$/.test(raw)) redirect(`/tx/${raw.toUpperCase()}`);
    if (/^yzxvaloper1[a-z0-9]+$/.test(raw)) redirect(`/validator/${raw}`);
    if (/^yzx1[a-z0-9]+$/.test(raw)) redirect(`/account/${raw}`);
    if (/^[a-z0-9-]+\.yzx$/.test(raw)) redirect(`/account/${raw}`);
    redirect(`/search?q=${encodeURIComponent(raw)}`);
  }

  return (
    <form className="search" action={search}>
      <input
        name="q"
        placeholder="Block height, transaction hash, address, validator, or a YOZEXA ID like maria.yzx"
        aria-label="Search the chain"
        autoComplete="off"
      />
      <button type="submit">Search</button>
    </form>
  );
}
