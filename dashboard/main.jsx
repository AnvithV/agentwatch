import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import AgentWatchDashboard from './AgentWatchDashboard';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AgentWatchDashboard />
  </React.StrictMode>
);
