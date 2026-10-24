import { FicheScreen } from "@/components/relations/fiche-screen";

type Props = { params: Promise<{ locale: string; id: string }> };

/** A Bad's Fiche opened from the Découverte: the same data and checks, as a folder over the list. */
export default async function DossierPage({ params }: Props) {
  const { id } = await params;
  return <FicheScreen id={id} dossier />;
}
