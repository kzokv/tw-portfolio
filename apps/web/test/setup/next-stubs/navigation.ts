/** Stub for next/navigation. */
export const useRouter = () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} });
export const usePathname = () => "/";
export const useSearchParams = () => new URLSearchParams();
export const redirect = () => {};
export const notFound = () => {
  const error = new Error("NEXT_NOT_FOUND");
  (error as Error & { digest?: string }).digest = "NEXT_NOT_FOUND";
  throw error;
};
