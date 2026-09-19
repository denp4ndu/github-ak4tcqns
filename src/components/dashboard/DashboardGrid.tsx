import React, { useMemo } from 'react';
import GridLayout, { useContainerWidth } from 'react-grid-layout';
import { SingleWidgetCard } from './SingleWidgetCard.tsx';
import type { Device, Datastream, Widget } from '../../types/index.ts';

interface DashboardGridProps {
  device: Device;
  datastreams: Datastream[];
  widgets: Widget[];
  isEditMode: boolean;
  onLayoutChange: (updatedWidgets: Widget[]) => void;
  onDeleteWidget: (widgetId: string) => void;
  isDeviceOffline: boolean;
}

export const DashboardGrid: React.FC<DashboardGridProps> = ({
  device,
  datastreams,
  widgets,
  isEditMode,
  onLayoutChange,
  onDeleteWidget,
  isDeviceOffline,
}) => {
  const { width, containerRef } = useContainerWidth();

  // Create lookup map for device datastreams
  const datastreamMap = useMemo(() => {
    return new Map(datastreams.map((d) => [d.id, d]));
  }, [datastreams]);

  // Construct layout configuration for react-grid-layout v2
  const layout = useMemo(() => {
    return widgets.map((w) => ({
      i: w.id,
      x: w.x,
      y: w.y,
      w: w.w,
      h: w.h,
      minW: w.type === 'LIVE_CHART' ? 4 : 2,
      minH: w.type === 'LIVE_CHART' ? 3 : 2,
      maxW: 12,
      maxH: 8,
      static: !isEditMode,
    }));
  }, [widgets, isEditMode]);

  const handleLayoutChange = (newLayout: readonly { i: string; x: number; y: number; w: number; h: number }[]) => {
    if (!isEditMode) return;

    const layoutMap = new Map(newLayout.map((item) => [item.i, item]));
    let hasChanged = false;

    const updatedWidgets = widgets.map((w) => {
      const match = layoutMap.get(w.id);
      if (match && (w.x !== match.x || w.y !== match.y || w.w !== match.w || w.h !== match.h)) {
        hasChanged = true;
        return {
          ...w,
          x: match.x,
          y: match.y,
          w: match.w,
          h: match.h,
        };
      }
      return w;
    });

    if (hasChanged) {
      onLayoutChange(updatedWidgets);
    }
  };

  return (
    <div ref={containerRef} className="w-full relative min-h-[300px]">
      <GridLayout
        className="layout select-none"
        layout={layout}
        width={width || 1200}
        gridConfig={{
          cols: 12,
          rowHeight: 85,
          margin: [16, 16],
        }}
        dragConfig={{
          enabled: isEditMode,
          handle: '.widget-drag-handle',
        }}
        resizeConfig={{
          enabled: isEditMode,
        }}
        onLayoutChange={handleLayoutChange}
      >
        {widgets.map((widget) => {
          const ds = datastreamMap.get(widget.datastreamId);
          return (
            <div key={widget.id} className="relative h-full">
              <SingleWidgetCard
                widget={widget}
                device={device}
                datastream={ds}
                allDatastreams={datastreams}
                isEditMode={isEditMode}
                isDeviceOffline={isDeviceOffline}
                onDelete={onDeleteWidget}
              />
            </div>
          );
        })}
      </GridLayout>
    </div>
  );
};
