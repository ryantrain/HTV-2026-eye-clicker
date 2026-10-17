import { createRoot } from 'react-dom/client';
import { CareApp } from './CareApp';
import { DesktopOverlay } from './DesktopOverlay';
import './index.css';
createRoot(document.getElementById('root')!).render(
  window.desktop ? <DesktopOverlay /> : <CareApp />,
);
