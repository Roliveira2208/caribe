import { notFound } from "next/navigation";

/** Atraparutas dentro de un idioma: cualquier ruta sin pagina es 404. */
export default function CatchAllPage() {
  notFound();
}
