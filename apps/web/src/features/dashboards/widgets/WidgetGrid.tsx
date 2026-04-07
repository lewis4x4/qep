/**
 * WidgetGrid — pure layout component.
 *
 * Resolves widget IDs against the registry, drops anything the registry
 * doesn't recognise (forward-compat for stale stored layouts), and renders
 * each widget's React component in a responsive CSS grid. Drag-and-drop
 * reordering is an explicit non-goal of this slice — the widget order comes
 * from the role defaults until per-user customization ships.
 */
import { Fragment } from "react";
import { resolveWidgets } from "./registry";

interface WidgetGridProps {
  widgetIds: string[];
}

export function WidgetGrid({ widgetIds }: WidgetGridProps) {
  const resolved = resolveWidgets(widgetIds);

  if (resolved.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
      {resolved.map((descriptor) => {
        const Component = descriptor.component;
        return (
          <Fragment key={descriptor.id}>
            <Component />
          </Fragment>
        );
      })}
    </div>
  );
}
