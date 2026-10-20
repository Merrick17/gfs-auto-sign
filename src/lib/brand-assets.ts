import { existsSync } from "node:fs";
import { join } from "node:path";

// The owner's own logo, when one has been dropped into public/brand/. Without it the built-in GFS mark is used.
//   public/brand/logo.svg       full logo (mark + name), shown in the sidebar and on the sign-in page
//   public/brand/logo-mark.svg  square mark only, used where space is tight (mobile header, collapsed)
export type BrandAssets = { logo: string | null; mark: string | null };

export function brandAssets(): BrandAssets {
  const dir = join(process.cwd(), "public", "brand");
  const has = (f: string) => existsSync(join(dir, f));
  return { logo: has("logo.svg") ? "/brand/logo.svg" : null, mark: has("logo-mark.svg") ? "/brand/logo-mark.svg" : null };
}
