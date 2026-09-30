import type React from 'react';
import { AuthProvider } from './auth/AuthProvider';
import { StudioShell } from './components/StudioShell';

const App: React.FC = () => {
  return (
    <AuthProvider>
      <StudioShell />
    </AuthProvider>
  );
};

export default App;
