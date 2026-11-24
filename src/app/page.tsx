/**
 * Landing page: the name, a company search box and a year slider. Bare-bones
 * on purpose (milestone 2.5); design comes in milestone 4.
 */
import { Suspense } from "react";
import { SearchForm } from "@/components/search-form";
import { listCompanies } from "@/lib/web/queries";

// Reads the database at request time, so it streams inside <Suspense>.
async function CompanySearch() {
  const companies = await listCompanies();
  return <SearchForm companies={companies} />;
}

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-24">
      <h1 className="text-5xl font-semibold tracking-tight">Filer</h1>
      <Suspense fallback={<p className="text-sm text-gray-500">Loading companies…</p>}>
        <CompanySearch />
      </Suspense>
    </main>
  );
}
