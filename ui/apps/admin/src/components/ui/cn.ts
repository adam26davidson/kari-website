import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn/ui's class helper, vendored here rather than at `lib/utils.ts`
 * because this repo names files after what they hold (#592).
 *
 * `clsx` flattens the conditional forms; `twMerge` then resolves conflicts
 * between Tailwind classes so a caller's `className` wins over a
 * component's default without either side having to know the other's
 * ordering — `cn("px-4", "px-6")` is `px-6`, not both.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
