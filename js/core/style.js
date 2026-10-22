/*
 * 默认样式。教科书风格：黑色线条，被遮挡部分自动画成虚线。
 */
(function (SG) {
  'use strict';

  const PALETTE = ['#1a1a1a', '#d0451b', '#1f6fd1', '#1a8f3c', '#8e44ad', '#e08e0b', '#c2185b', '#00838f', '#6d4c41', '#7f8c8d'];
  const FILLS = ['#4a90d9', '#f5a623', '#7ed321', '#bd10e0', '#e74c3c', '#50e3c2', '#f8e71c', '#9b9b9b'];

  function defaults(o) {
    switch (o.type) {
      case 'point': return { color: '#1a1a1a', size: 3, label: false, dot: true };
      case 'segment': return { color: '#1a1a1a', width: 1.6, dash: 'auto' };
      case 'line': return { color: '#1a1a1a', width: 1.4, dash: 'auto', ext: 0.5 };
      case 'ray': return { color: '#1a1a1a', width: 1.4, dash: 'auto', ext: 1 };
      case 'polygon': return { fill: false, fillColor: '#4a90d9', fillOpacity: 0.18, occlude: false };
      case 'plane': return { color: '#3d6fa8', width: 1.2, fillColor: '#a9cdf2', fillOpacity: 0.22, size: 1, label: true, occlude: false };
      case 'circle': return { color: '#1a1a1a', width: 1.5, dash: 'auto', label: false };
      case 'sphere': return { mode: 'shaded', color: '#5b9be0', opacity: 0.32, density: 8, equator: true, lineColor: '#1a1a1a', width: 1.4, occlude: false, label: false };
      case 'solid': return { color: '#1a1a1a', width: 1.6, label: false };
      case 'trace': return { color: '#e0218a', width: 1.6 };
      case 'measure': return { show: true, color: '#0b7a35' };
      case 'mark': return { color: '#1a1a1a', width: 1.2, size: 0.25 };
      default: return {};
    }
  }

  SG.Style = { defaults, PALETTE, FILLS };
})(globalThis.SG = globalThis.SG || {});
