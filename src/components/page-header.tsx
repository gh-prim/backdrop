/**
 * En-tête de page.
 *
 * Un seul composant pour tous les écrans: c'est ce qui donne le rythme
 * vertical commun, sans lequel chaque page dérive de quelques pixels et
 * l'ensemble paraît bricolé.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-1">
      <div className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
