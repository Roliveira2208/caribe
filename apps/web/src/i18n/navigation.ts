import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Navegacion localizada: Link y hooks que prefijan el idioma automaticamente.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
