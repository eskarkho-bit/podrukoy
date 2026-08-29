// Знак domio в SVG — та же геометрия, что в приложении.
import React from 'react';
import { TOWER_POLYGONS, TOWER_VIEWBOX, TOWER_WINDOWS } from '../tower';

export const Tower: React.FC<{
  height: number;
  color: string;
  windowColor: string;
  style?: React.CSSProperties;
}> = ({ height, color, windowColor, style }) => {
  const { width: vw, height: vh } = TOWER_VIEWBOX;
  return (
    <svg viewBox={`0 0 ${vw} ${vh}`} width={(height * vw) / vh} height={height} style={style}>
      {TOWER_POLYGONS.map((points) => (
        <polygon key={points} points={points} fill={color} />
      ))}
      {TOWER_WINDOWS.map((w) => (
        <rect key={w.y} {...w} fill={windowColor} />
      ))}
    </svg>
  );
};
