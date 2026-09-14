import { createContext, useContext } from "react";
import { PreviewOverrides } from "@kari/shared/utils/preview-channel";

/**
 * The unsaved editor state this document has been handed, or `{}` — which is
 * what every ordinary visit sees, and what a public page therefore has to
 * treat as "show the deployed data".
 *
 * Split from the provider so the provider module exports nothing but a
 * component: `react-refresh/only-export-components` runs at
 * `--max-warnings 0` here, the same reason `button-variants.ts` sits beside
 * `button.tsx`.
 */
export const PreviewOverridesContext = createContext<PreviewOverrides>({});

/**
 * The draft overrides for this render. Deliberately does NOT throw without a
 * provider, unlike `useAdminUi`: a public page calling this must work when
 * nothing is previewing it, which is nearly always.
 */
export const usePreviewOverrides = (): PreviewOverrides =>
  useContext(PreviewOverridesContext);
