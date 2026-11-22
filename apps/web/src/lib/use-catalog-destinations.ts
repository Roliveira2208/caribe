"use client";

import { useEffect, useState } from "react";
import { parseCatalogPageView, extractDestinations, type CatalogDestinationView } from "./search-view";
import { searchApiUrl } from "@/components/search-view";

/**
 * Carga única de destinos para las dos instancias del buscador compartido.
 * No hay endpoint de destinos en F1: se derivan de una lectura acotada del
 * catálogo (design.md, decisión 4).
 */
export function useCatalogDestinations(): CatalogDestinationView[] {
  const [destinations, setDestinations] = useState<CatalogDestinationView[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(searchApiUrl({ type: "hotel", limit: 50 }, 50), { signal: controller.signal })
      .then(async (response) => (response.ok ? parseCatalogPageView(await response.json()) : null))
      .then((catalog) => {
        if (controller.signal.aborted || !catalog) return;
        setDestinations(extractDestinations(catalog.items));
      })
      .catch(() => {
        // El selector sigue siendo usable con la opción "todos los destinos".
      });
    return () => controller.abort();
  }, []);

  return destinations;
}
